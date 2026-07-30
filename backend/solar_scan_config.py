# Tunable constants for the solar-panel scan/review pipeline.
# Kept separate from config.py (CORS/upload/API-key concerns, imported broadly)
# since this module owns a larger, detection-pipeline-specific surface.
import os

ESRI_EXPORT_URL = "https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export"


def scan_target_mpp() -> float:
    # Meters per pixel requested from the Esri export for a scan.
    try:
        return float(os.environ.get("SCAN_TARGET_MPP", "0.3"))
    except ValueError:
        return 0.3


def scan_max_px() -> int:
    # Hard ceiling on the fetched image's longest side.
    try:
        return int(os.environ.get("SCAN_MAX_PX", "2048"))
    except ValueError:
        return 2048


def dedup_iou() -> float:
    # Two detections at/above this IoU are treated as the same physical array on rescan.
    try:
        return float(os.environ.get("DEDUP_IOU", "0.35"))
    except ValueError:
        return 0.35


# Solar-panel-specific shape thresholds — first-pass estimates, not yet calibrated
# against real scans. See plan notes: at SCAN_TARGET_MPP≈0.3 an individual panel
# (~1.7 m²) is below reliable per-instance segmentation, so a "solar panel" detection
# here is expected to be one contiguous array/cluster segment, not one physical panel.
def min_solar_area_m2() -> float:
    try:
        return float(os.environ.get("MIN_SOLAR_AREA_M2", "3.0"))
    except ValueError:
        return 3.0


def max_solar_area_m2() -> float:
    try:
        return float(os.environ.get("MAX_SOLAR_AREA_M2", "50000"))
    except ValueError:
        return 50000.0


def min_compactness() -> float:
    try:
        return float(os.environ.get("MIN_COMPACTNESS", "0.35"))
    except ValueError:
        return 0.35


def min_rectangularity() -> float:
    try:
        return float(os.environ.get("MIN_RECTANGULARITY", "0.55"))
    except ValueError:
        return 0.55


def max_aspect_ratio() -> float:
    try:
        return float(os.environ.get("MAX_ASPECT_RATIO", "8.0"))
    except ValueError:
        return 8.0
