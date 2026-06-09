from unittest.mock import patch

from PIL import Image
import io


def _tiny_png() -> bytes:
    img = Image.new("RGB", (8, 8), color="red")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_detect_rejects_non_image(client):
    res = client.post(
        "/detect",
        files={"file": ("test.txt", b"not an image", "text/plain")},
    )
    assert res.status_code == 400


def test_detect_rejects_empty_file(client):
    res = client.post(
        "/detect",
        files={"file": ("empty.png", b"", "image/png")},
    )
    assert res.status_code == 400


@patch("main.run_detection")
def test_detect_sam3_success(mock_run, client):
    mock_run.return_value = {
        "detections": [],
        "image_width": 8,
        "image_height": 8,
        "processing_time_s": 0.1,
    }
    res = client.post(
        "/detect?mode=streetview&engine=sam3",
        files={"file": ("tiny.png", _tiny_png(), "image/png")},
    )
    assert res.status_code == 200
    assert res.json()["image_width"] == 8
    mock_run.assert_called_once()


@patch("main.run_yolo_detection")
def test_detect_yolo_success(mock_run, client):
    mock_run.return_value = {
        "detections": [],
        "image_width": 8,
        "image_height": 8,
        "processing_time_s": 0.1,
    }
    res = client.post(
        "/detect?mode=satellite&engine=yolo",
        files={"file": ("tiny.png", _tiny_png(), "image/png")},
    )
    assert res.status_code == 200
    mock_run.assert_called_once()
