
# SAM 3 (Segment Anything Model 3) detection service.
# Uses Hugging Face transformers for promptable concept segmentation.
import os
import io
import time
import logging
from typing import Any

import cv2
import numpy as np
from PIL import Image

logger = logging.getLogger("uvicorn.error")

# Entrance-focused prompts for street view mode.

# SAM 3 is promptable: for each text prompt, the model returns instance segmentation
# masks for any regions matching the prompt.

# Street-level imagery contains many “door-like”/“entrance-like” visual patterns
# (including reflective glass storefronts), so we use multiple entrance synonyms.
STREETVIEW_PROMPTS = [
    "solar panel",
    "photovoltaic array",
    "solar array",
]

# Building-focused prompts for satellite/aerial view mode.

# Satellite imagery varies (roofs, houses, outlines). Using a small prompt set of
# synonyms improves recall without multiplying compute too much.
SATELLITE_PROMPTS = [
    "solar panel",
    "photovoltaic array",
    "solar array",
]

# Batch multiple prompts together can sometimes increase throughput, but on
# some hardware it may increase latency/memory pressure.
# Defaulting back to 1 matches the previous (older) behavior.
_BATCH_SIZE = 1
# Max dimension for inference — larger images are downscaled to reduce compute and RAM
_MAX_INFER_DIM = 768

_model: Any = None
_processor: Any = None

# Device selection impacts both speed and memory usage.
_device: str = "cpu"
_dtype: Any = None


def _get_device() -> str:
    # Choose where Torch runs inference. SAM3_DEVICE=cpu|cuda|mps forces a choice;
    # unset (default) keeps auto-detection: CUDA, then MPS, then CPU fallback.
    raw = (os.environ.get("SAM3_DEVICE") or "auto").strip().lower()
    try:
        import torch
        if raw == "cpu":
            return "cpu"
        if raw == "cuda":
            return "cuda" if torch.cuda.is_available() else "cpu"
        if raw == "mps":
            return "mps" if hasattr(torch.backends, "mps") and torch.backends.mps.is_available() else "cpu"
        # auto (default)
        if torch.cuda.is_available():
            return "cuda"
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


def is_sam3_loaded() -> bool:
    return _model is not None


def load_sam3() -> bool:
    # Load SAM 3 model and processor. Returns True on success.
    global _model, _processor, _device, _dtype
    if _model is not None:
        return True

    try:
        import torch
        from transformers import Sam3Model, Sam3Processor

        # Load/cached initialization: we only do this once and then reuse
        # the same model+processor objects for subsequent requests.
        _device = _get_device()
        _dtype = torch.float32

        logger.info(f"Loading SAM 3 on {_device}…")

        # SAM 3 is gated on Hugging Face. If you have access, provide a token
        # via env vars so `from_pretrained()` can download weights. `or None`
        # matters here: a blank HF_TOKEN="" line in .env (loaded via
        # python-dotenv) makes os.environ.get return "" rather than None, and
        # passing token="" to from_pretrained sends a malformed empty
        # "Authorization: Bearer " header instead of omitting auth entirely.
        token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN") or None
        if token:
            os.environ["HF_TOKEN"] = token

        _processor = Sam3Processor.from_pretrained(
            "facebook/sam3",
            token=token,
        )
        _model = Sam3Model.from_pretrained(
            "facebook/sam3",
            token=token,
        ).to(_device)
        _model.eval()

        logger.info("SAM 3 ready.")
        return True
    except Exception as e:
        logger.error(f"SAM 3 failed to load: {e}")
        return False


def _iou(box_a: dict, box_b: dict) -> float:
    # Compute IoU between two boxes (xmin, ymin, xmax, ymax).
    ix1 = max(box_a["xmin"], box_b["xmin"])
    iy1 = max(box_a["ymin"], box_b["ymin"])
    ix2 = min(box_a["xmax"], box_b["xmax"])
    iy2 = min(box_a["ymax"], box_b["ymax"])
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    inter = (ix2 - ix1) * (iy2 - iy1)
    area_a = (box_a["xmax"] - box_a["xmin"]) * (box_a["ymax"] - box_a["ymin"])
    area_b = (box_b["xmax"] - box_b["xmin"]) * (box_b["ymax"] - box_b["ymin"])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _nms(
    detections: list[dict],
    iou_threshold: float = 0.5,
    *,
    entrance_suppress_iou: float | None = None,
) -> list[dict]:
    # Non-maximum suppression (NMS) by confidence.
    
    # Why this is customized:
    # - Urban imagery generates many *overlapping* boxes for the same physical structure.
    # - However, adjacent structures (e.g., two neighboring buildings) may also overlap
    # slightly in the model's bbox space.
    
    # To avoid deleting legitimate neighboring buildings, we use:
    # - a higher threshold for "road"/"sidewalk" to keep continuous surface regions
    # - a more lenient threshold for "building" so neighbors survive
    # - a stricter threshold for other same-class labels
    #
    # entrance_suppress_iou: optional higher IoU bar for two "entrance" boxes
    # (door vs adjacent window on the same porch).
    if not detections:
        return []
    sorted_dets = sorted(detections, key=lambda d: d["confidence"], reverse=True)
    keep: list[dict] = []
    for det in sorted_dets:
        keep_it = True
        for k in keep:
            iou = _iou(det["bbox"], k["bbox"])
            thresh = iou_threshold
            if {det["label"], k["label"]} <= {"road", "sidewalk"}:
                thresh = 0.85
            elif det["label"] == k["label"]:
                # Buildings need lenient NMS — adjacent buildings have slight overlap
                if det["label"] == "building":
                    thresh = 0.55
                elif det["label"] == "entrance" and entrance_suppress_iou is not None:
                    thresh = entrance_suppress_iou
                else:
                    thresh = 0.35
            if iou > thresh:
                keep_it = False
                break
        if keep_it:
            keep.append(det)
    return keep


_SOLAR_PANEL_LABELS = {
    "solar panel",
    "photovoltaic array",
    "solar array",
}


# Max detections per class - keeps only highest-confidence to reduce noise
_MAX_PER_CLASS: dict[str, int] = {
    "road": 1,
    "sidewalk": 1,
    "solar panel": 300,
    "door": 3,
    "entrance": 8,
    "car": 5,
    "truck": 2,
    "person": 2,
    "bicycle": 2,
    "tree": 4,
    "vegetation": 2,
    "grass": 2,
    "pole": 4,
    "sign": 3,
    "street light": 3,
    "trash can": 1,
    "bench": 1,
    "fire hydrant": 1,
    "mailbox": 1,
    "traffic light": 2,
    "bus": 2,
    "motorcycle": 1,
}


def _env_truthy(name: str) -> bool:
    return (os.environ.get(name) or "").strip().lower() in ("1", "true", "yes")


def _env_bool(name: str, default: bool) -> bool:
    # Like _env_truthy but honours a default when the var is unset, so a feature
    # can ship enabled while still being switchable off (SAM3_SAT_TILING=0).
    raw = (os.environ.get(name) or "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes")


def _cap_per_class(detections: list[dict]) -> list[dict]:
    # Keep only top N detections per class by confidence.
    # SAM3_MAX_SOLAR_PANELS raises the "solar panel" cap without touching other classes.
    try:
        solar_cap_override = int(os.environ.get("SAM3_MAX_SOLAR_PANELS", "0"))
    except ValueError:
        solar_cap_override = 0

    by_label: dict[str, list[dict]] = {}
    for d in detections:
        lbl = d["label"]
        by_label.setdefault(lbl, []).append(d)

    result: list[dict] = []
    for lbl, dets in by_label.items():
        cap = _MAX_PER_CLASS.get(lbl, 4)  # default 4 for unlisted
        if lbl == "solar panel" and solar_cap_override > 0:
            cap = solar_cap_override
        sorted_dets = sorted(dets, key=lambda x: x["confidence"], reverse=True)
        result.extend(sorted_dets[:cap])
    return result


_MIN_AREA_BY_LABEL: dict[str, int] = {
    "door": 400,
    "revolving door": 400,
    "glass entrance": 400,
    "storefront entrance": 400,
    "building entrance": 400,
    "person": 500,
    # Allow smaller building footprints so small houses and sheds are kept.
    "building": 70,
    "house": 70,
    "structure": 70,
    "building footprint": 70,
}


def _min_area(bbox: dict, label: str = "", min_pixels: int = 1500) -> bool:
    w = bbox["xmax"] - bbox["xmin"]
    h = bbox["ymax"] - bbox["ymin"]
    threshold = _MIN_AREA_BY_LABEL.get(label, min_pixels)
    return w * h >= threshold


def _tensor_batch_len(x: Any) -> int:
    # Number of instances along dim 0 (boxes/scores/masks from SAM3 post-process).
    if x is None:
        return 0
    if hasattr(x, "shape") and len(getattr(x, "shape", ())) > 0:
        return int(x.shape[0])
    return len(x)


def _to_float_score(x: Any) -> float:
    if hasattr(x, "detach"):
        return float(x.detach().cpu().item())
    return float(x)


def _xyxy_from_box(box: Any) -> tuple[float, float, float, float]:
    # Normalize box to 4 floats whether it is a tensor slice, ndarray, or nested list.
    if hasattr(box, "detach"):
        flat = box.detach().cpu().flatten().tolist()
    elif hasattr(box, "tolist"):
        flat = box.tolist()
    else:
        flat = list(box)  # type: ignore[arg-type]
    while len(flat) == 1 and isinstance(flat[0], (list, tuple)):
        flat = list(flat[0])
    if len(flat) != 4:
        raise ValueError(f"expected 4 box coordinates, got {flat!r}")
    return float(flat[0]), float(flat[1]), float(flat[2]), float(flat[3])


def _clip_polygon_to_bounds(pts: list[list[float]], img_w: int, img_h: int) -> list[list[float]] | None:
    # Clip polygon points to image bounds so outlines stay inside the frame.
    if not pts:
        return None
    clipped = []
    for x, y in pts:
        cx = max(0.0, min(float(img_w), x))
        cy = max(0.0, min(float(img_h), y))
        clipped.append([cx, cy])
    # Remove consecutive duplicates
    deduped = [clipped[0]]
    for p in clipped[1:]:
        if abs(p[0] - deduped[-1][0]) > 1e-6 or abs(p[1] - deduped[-1][1]) > 1e-6:
            deduped.append(p)
    if len(deduped) < 3:
        return None
    return deduped


def _prepare_mask(mask, img_w: int, img_h: int):
    # Shared mask preprocessing: squeeze, threshold, crop, upsample, morphology.
    if mask is None:
        return None, 0, 0
    arr = np.asarray(mask)
    if arr.ndim > 2:
        arr = arr.squeeze()
    if arr.ndim != 2:
        return None, 0, 0
    if arr.dtype != np.uint8:
        arr = (arr > 0.5).astype(np.uint8)
    h_lim, w_lim = min(arr.shape[0], img_h), min(arr.shape[1], img_w)
    arr = arr[:h_lim, :w_lim]
    mh, mw = arr.shape[0], arr.shape[1]
    if mw < img_w or mh < img_h:
        arr = cv2.resize(arr, (img_w, img_h), interpolation=cv2.INTER_LINEAR)
        arr = (arr > 0.5).astype(np.uint8)
        mh, mw = arr.shape[0], arr.shape[1]
    kernel = np.ones((3, 3), np.uint8)
    arr = cv2.morphologyEx(arr, cv2.MORPH_CLOSE, kernel)
    arr = cv2.dilate(arr, kernel)
    return arr, mh, mw


def _contour_to_polygon(cnt, mw: int, mh: int, img_w: int, img_h: int) -> list[list[float]] | None:
    # Convert a single OpenCV contour to a clipped polygon.
    if len(cnt) < 3:
        return None
    peri = cv2.arcLength(cnt, True)
    epsilon = max(0.5, peri * 0.0005)
    cnt = cv2.approxPolyDP(cnt, epsilon, True)
    if len(cnt) < 3:
        return None
    pts = cnt.reshape(-1, 2).tolist()
    pts = [[float(x), float(y)] for x, y in pts]
    sx = img_w / max(1, mw)
    sy = img_h / max(1, mh)
    pts = [[x * sx, y * sy] for x, y in pts]
    return _clip_polygon_to_bounds(pts, img_w, img_h)


def _mask_to_polygon(mask, img_w: int, img_h: int) -> list[list[float]] | None:
    # Extract the single largest polygon contour from binary mask (street view mode).
    arr, mh, mw = _prepare_mask(mask, img_w, img_h)
    if arr is None:
        return None
    contours, _ = cv2.findContours(arr, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return None
    cnt = max(contours, key=cv2.contourArea)
    return _contour_to_polygon(cnt, mw, mh, img_w, img_h)


_SAT_MIN_CONTOUR_AREA = 80  # minimum contour area in pixels for satellite buildings


def _mask_to_all_polygons(mask, img_w: int, img_h: int) -> list[dict]:
    # Extract ALL contours from a mask as separate polygons (satellite mode).
    # Returns list of {polygon, bbox} dicts — one per detected building.
    arr, mh, mw = _prepare_mask(mask, img_w, img_h)
    if arr is None:
        return []
    contours, _ = cv2.findContours(arr, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return []

    sx = img_w / max(1, mw)
    sy = img_h / max(1, mh)
    results = []
    for cnt in contours:
        if cv2.contourArea(cnt) < _SAT_MIN_CONTOUR_AREA:
            continue
        poly = _contour_to_polygon(cnt, mw, mh, img_w, img_h)
        if not poly:
            continue
        x, y, cw, ch = cv2.boundingRect(cnt)
        bbox = {
            "xmin": x * sx,
            "ymin": y * sy,
            "xmax": (x + cw) * sx,
            "ymax": (y + ch) * sy,
        }
        results.append({"polygon": poly, "bbox": bbox})
    return results


def _run_inference_pass(
    infer_image: Image.Image,
    prompts: list[str],
    infer_w: int,
    infer_h: int,
    confidence_threshold: float,
    mask_threshold: float,
    mode: str,
    offset_x: float = 0.0,
    offset_y: float = 0.0,
    scale_x: float = 1.0,
    scale_y: float = 1.0,
) -> list[dict]:
    # Run one SAM 3 inference pass for a given image crop and concept prompt list.
    
    # Inputs:
    # - `infer_image`: PIL image crop to run inference on
    # - `prompts`: text concepts to evaluate (street view vs satellite differs)
    # - `infer_w`/`infer_h`: dimensions of the crop in pixels
    # - `offset_x`/`offset_y`: where this crop sits within the full image
    # - `scale_x`/`scale_y`: mapping from crop space back to full-image space
    
    # Output:
    # - list of dict detections containing:
    # - `label`: the prompt/concept that produced this instance
    # - `confidence`: score from SAM 3 post-processing
    # - `bbox`: bounding box mapped into full-image coordinates
    # - `polygon`: polygon outline derived from the segmentation mask (when available)
    import torch

    dets: list[dict] = []

    for batch_start in range(0, len(prompts), _BATCH_SIZE):
        batch_prompts = prompts[batch_start : batch_start + _BATCH_SIZE]
        batch_images = [infer_image] * len(batch_prompts)

        try:
            inputs = _processor(
                images=batch_images,
                text=batch_prompts,
                return_tensors="pt",
            ).to(_device)

            target_sizes = inputs.get("original_sizes")
            if target_sizes is not None and hasattr(target_sizes, "tolist"):
                target_sizes = target_sizes.tolist()
            else:
                target_sizes = [[infer_h, infer_w]] * len(batch_prompts)

            with torch.inference_mode():
                outputs = _model(**inputs)

            results = _processor.post_process_instance_segmentation(
                outputs,
                threshold=confidence_threshold,
                mask_threshold=mask_threshold,
                target_sizes=target_sizes,
            )

            for prompt, result in zip(batch_prompts, results):
                boxes = result.get("boxes", [])
                scores = result.get("scores", [])
                masks = result.get("masks", [])

                n_inst = min(_tensor_batch_len(boxes), _tensor_batch_len(scores))
                n_masks = _tensor_batch_len(masks)

                for i in range(n_inst):
                    score_f = _to_float_score(scores[i])
                    if score_f < confidence_threshold:
                        continue

                    if mode == "satellite" and i < n_masks:
                        mask_arr = masks[i]
                        if hasattr(mask_arr, "cpu"):
                            mask_arr = mask_arr.cpu().numpy()
                        sub_polys = _mask_to_all_polygons(mask_arr, infer_w, infer_h)
                        for sp in sub_polys:
                            sb = sp["bbox"]
                            sb = {
                                "xmin": sb["xmin"] * scale_x + offset_x,
                                "ymin": sb["ymin"] * scale_y + offset_y,
                                "xmax": sb["xmax"] * scale_x + offset_x,
                                "ymax": sb["ymax"] * scale_y + offset_y,
                            }
                            poly = [
                                [px * scale_x + offset_x, py * scale_y + offset_y]
                                for px, py in sp["polygon"]
                            ]
                            dets.append({
                                "label": prompt,
                                "confidence": score_f,
                                "bbox": sb,
                                "polygon": poly,
                            })
                        continue

                    try:
                        x1, y1, x2, y2 = _xyxy_from_box(boxes[i])
                    except (ValueError, TypeError) as err:
                        logger.warning("Bad box tensor for prompt %r: %s", prompt, err)
                        continue
                    bbox = {"xmin": x1, "ymin": y1, "xmax": x2, "ymax": y2}
                    if not _min_area(bbox, label=prompt):
                        continue
                    polygon = None
                    if i < n_masks:
                        mask_arr = masks[i]
                        if hasattr(mask_arr, "cpu"):
                            mask_arr = mask_arr.cpu().numpy()
                        polygon = _mask_to_polygon(mask_arr, infer_w, infer_h)
                    bbox = {
                        "xmin": bbox["xmin"] * scale_x + offset_x,
                        "ymin": bbox["ymin"] * scale_y + offset_y,
                        "xmax": bbox["xmax"] * scale_x + offset_x,
                        "ymax": bbox["ymax"] * scale_y + offset_y,
                    }
                    if polygon:
                        polygon = [
                            [px * scale_x + offset_x, py * scale_y + offset_y]
                            for px, py in polygon
                        ]
                    dets.append({
                        "label": prompt,
                        "confidence": score_f,
                        "bbox": bbox,
                        "polygon": polygon,
                    })
        except Exception as e:
            logger.warning("SAM3 batch failed prompts=%s: %s", batch_prompts, e, exc_info=True)
            continue

    return dets


def _satellite_tiles_cover(w: int, h: int, tile_size: int, overlap: float) -> list[tuple[int, int, int, int]]:
    # Axis-aligned windows of size up to tile_size with overlap; last step snaps to far edge.
    if w <= 0 or h <= 0:
        return []
    ts = max(128, min(tile_size, max(w, h)))
    if w <= ts and h <= ts:
        return [(0, 0, w, h)]
    step = max(1, int(ts * (1 - overlap)))

    def axis_starts(total: int) -> list[int]:
        if total <= ts:
            return [0]
        xs: list[int] = []
        x = 0
        while True:
            xs.append(x)
            if x + ts >= total:
                break
            x = min(x + step, total - ts)
        return list(dict.fromkeys(xs))

    x_starts = axis_starts(w)
    y_starts = axis_starts(h)
    tiles: list[tuple[int, int, int, int]] = []
    for y in y_starts:
        for x in x_starts:
            cw = min(ts, w - x)
            ch = min(ts, h - y)
            tiles.append((x, y, cw, ch))
    return tiles


def _collect_satellite_detections(
    image: Image.Image,
    w: int,
    h: int,
    prompts: list[str],
    confidence_threshold: float,
    mask_threshold: float,
    max_dim: int,
) -> list[dict]:
    # Single downscaled pass, or optional multi-tile inference at ~max_dim per tile
    # Tiling is ON by default: a single downscaled pass destroys the resolution solar
    # panels need. Measured on a 1600m-wide scan (2048px Esri export): single pass at
    # max_dim=768 sees ~2.1 m/px and found 0 arrays; tiled at 1024 sees ~0.8 m/px and
    # found 35. Set SAM3_SAT_TILING=0 for the old fast-but-blind single pass.
    use_tiles = _env_bool("SAM3_SAT_TILING", True)
    if not use_tiles or max(w, h) <= max_dim:
        infer_image = image
        sx, sy = 1.0, 1.0
        iw, ih = w, h
        if max(iw, ih) > max_dim:
            ratio = max_dim / max(iw, ih)
            iw, ih = int(iw * ratio), int(ih * ratio)
            infer_image = image.resize((iw, ih), Image.Resampling.LANCZOS)
            sx, sy = w / iw, h / ih
        logger.info("Satellite: single pass %dx%d (max_dim=%d)", iw, ih, max_dim)
        return _run_inference_pass(
            infer_image, prompts, iw, ih,
            confidence_threshold, mask_threshold, "satellite",
            scale_x=sx, scale_y=sy,
        )

    try:
        ov = float((os.environ.get("SAM3_SAT_TILE_OVERLAP") or "0.22").strip())
    except ValueError:
        ov = 0.22
    ov = max(0.08, min(0.45, ov))
    tile_specs = _satellite_tiles_cover(w, h, max_dim, ov)
    logger.info(
        "Satellite: tiled inference %d tiles max_dim=%d overlap=%.2f",
        len(tile_specs), max_dim, ov,
    )
    acc: list[dict] = []
    for x0, y0, cw, ch in tile_specs:
        crop = image.crop((x0, y0, x0 + cw, y0 + ch))
        iw, ih = crop.size
        infer_im = crop
        sx, sy = 1.0, 1.0
        if max(iw, ih) > max_dim:
            ratio = max_dim / max(iw, ih)
            ni, nj = max(1, int(iw * ratio)), max(1, int(ih * ratio))
            infer_im = crop.resize((ni, nj), Image.Resampling.LANCZOS)
            sx, sy = cw / ni, ch / nj
        else:
            ni, nj = iw, ih
        acc.extend(
            _run_inference_pass(
                infer_im, prompts, ni, nj,
                confidence_threshold, mask_threshold, "satellite",
                offset_x=float(x0), offset_y=float(y0),
                scale_x=sx, scale_y=sy,
            )
        )
    return acc


def run_detection(image_bytes: bytes, mode: str = "streetview") -> dict:
    # Run SAM 3 detection on image. Returns dict compatible with DetectionResult:
    # { image_width, image_height, detections, processing_time_s }
    
    # mode: "streetview" for door detection, "satellite" for building detection.
    # Satellite mode uses multi-scale tiled inference for comprehensive coverage.
    if not load_sam3():
        raise RuntimeError("SAM 3 model not loaded")

    prompts = SATELLITE_PROMPTS if mode == "satellite" else STREETVIEW_PROMPTS

    start = time.perf_counter()
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    w, h = image.size

    all_dets: list[dict] = []

    if mode == "satellite":
        # Env-tunable thresholds (SAM3_SAT_* clamped to sane ranges) instead of
        # hardcoded values, so recall/precision can be tuned per deployment without
        # a code change. Defaults chosen close to prior hardcoded behavior.
        try:
            confidence_threshold = float((os.environ.get("SAM3_SAT_CONF") or "0.20").strip())
        except ValueError:
            confidence_threshold = 0.20
        confidence_threshold = max(0.12, min(0.45, confidence_threshold))

        try:
            mask_threshold = float((os.environ.get("SAM3_SAT_MASK_THRESHOLD") or "0.42").strip())
        except ValueError:
            mask_threshold = 0.42
        mask_threshold = max(0.25, min(0.65, mask_threshold))

        try:
            # 1024 beat 768 on both accuracy (35 vs 30 arrays) and wall time
            # (55s vs 98s) — larger tiles mean fewer inference passes.
            max_dim = int((os.environ.get("SAM3_SAT_MAX_DIM") or "1024").strip())
        except ValueError:
            max_dim = 768
        max_dim = max(480, min(1024, max_dim))

        all_dets = _collect_satellite_detections(
            image, w, h, prompts, confidence_threshold, mask_threshold, max_dim
        )

        # Merge labels to "solar panel"
        for d in all_dets:
            if d["label"] != "solar panel":
                d["label"] = "solar panel"

        # Drop only near-full-frame false positives.
        try:
            max_bbox_frac = float((os.environ.get("SAM3_SAT_MAX_BBOX_FRACTION") or "0.62").strip())
        except ValueError:
            max_bbox_frac = 0.62
        max_bbox_frac = max(0.18, min(0.92, max_bbox_frac))
        img_area = w * h
        all_dets = [
            d for d in all_dets
            if (d["bbox"]["xmax"] - d["bbox"]["xmin"])
            * (d["bbox"]["ymax"] - d["bbox"]["ymin"])
            <= max_bbox_frac * img_area
        ]
        all_dets = _nms(all_dets, iou_threshold=0.6)

    else:
        # Street view: keep scores closer to HF defaults (0.3); 0.5 was dropping most doors.
        confidence_threshold = 0.32
        street_mask_threshold = 0.45

        max_dim = _MAX_INFER_DIM
        infer_image = image
        sx, sy = 1.0, 1.0
        if max(w, h) > max_dim:
            ratio = max_dim / max(w, h)
            iw, ih = int(w * ratio), int(h * ratio)
            infer_image = image.resize((iw, ih), Image.Resampling.LANCZOS)
            sx, sy = w / iw, h / ih
        else:
            iw, ih = w, h

        all_dets = _run_inference_pass(
            infer_image, prompts, iw, ih,
            confidence_threshold, street_mask_threshold, mode,
            scale_x=sx, scale_y=sy,
        )
        all_dets = _nms(all_dets, iou_threshold=0.6)

    all_dets = _cap_per_class(all_dets)
    elapsed_s = round(time.perf_counter() - start, 3)

    detections = []
    for i, d in enumerate(all_dets):
        label = d["label"]
        # Normalize any solar panel related label to a single canonical label.
        if label in _SOLAR_PANEL_LABELS:
            label = "solar panel"
        det = {
            "id": f"det_{i}",
            "label": label,
            "confidence": d["confidence"],
            "bbox": d["bbox"],
        }
        if d.get("polygon"):
            det["polygon"] = d["polygon"]
        detections.append(det)

    logger.info(
        "Detection complete: %d objects in %.3fs (%s)",
        len(detections),
        elapsed_s,
        mode,
    )

    return {
        "image_width": w,
        "image_height": h,
        "detections": detections,
        "processing_time_s": elapsed_s,
        "engine": "sam3",
    }
