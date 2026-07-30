from unittest.mock import AsyncMock, patch

import pytest

# A small square detection near the bbox center, in pixel space (image is 512x512),
# sized/shaped so it survives the shape filter (see test_solar_geometry.py).
_PIXEL_POLY = [[220, 220], [292, 220], [292, 292], [220, 292], [220, 220]]

_BBOX = [-118.2510, 34.0490, -118.2490, 34.0510]


def _mock_detect_result():
    return {
        "image_width": 512,
        "image_height": 512,
        "detections": [
            {
                "id": "det_0",
                "label": "solar panel",
                "confidence": 0.5,
                "bbox": {"xmin": 220, "ymin": 220, "xmax": 292, "ymax": 292},
                "polygon": _PIXEL_POLY,
            }
        ],
        "processing_time_s": 0.1,
        "engine": "sam3",
    }


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    import solar_store

    monkeypatch.setattr(solar_store, "DB_PATH", tmp_path / "solar_scans.db")
    yield


@pytest.fixture(autouse=True)
def _mock_esri_fetch():
    with patch("solar_scan_api._fetch_esri", new=AsyncMock(return_value=b"fake-jpeg-bytes")):
        yield


def test_scan_happy_path(client):
    with patch("solar_scan_api.sam3_run_detection", return_value=_mock_detect_result()):
        res = client.post("/scan", json={"bbox": _BBOX, "model": "sam3"})
    assert res.status_code == 200
    body = res.json()
    assert body["count"] == 1
    assert body["stored"]["pending"] == 1
    assert body["features"][0]["properties"]["status"] == "pending"


def test_scan_rejects_bad_bbox(client):
    res = client.post("/scan", json={"bbox": [1, 2, 3], "model": "sam3"})
    assert res.status_code == 400 or res.status_code == 422


def test_scan_dedup_on_rescan(client):
    with patch("solar_scan_api.sam3_run_detection", return_value=_mock_detect_result()):
        first = client.post("/scan", json={"bbox": _BBOX, "model": "sam3"})
        second = client.post("/scan", json={"bbox": _BBOX, "model": "sam3"})
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["stored"]["pending"] == 1
    assert second.json()["stored"]["skipped"] == 1
    assert second.json()["stored"]["by_reason"].get("duplicate") == 1


def test_confirm_reject_restore(client):
    with patch("solar_scan_api.sam3_run_detection", return_value=_mock_detect_result()):
        scan_res = client.post("/scan", json={"bbox": _BBOX, "model": "sam3"})
    det_id = scan_res.json()["features"][0]["properties"]["id"]

    res = client.post(f"/detections/{det_id}/confirm")
    assert res.status_code == 200
    assert res.json()["status"] == "confirmed"

    res = client.post(f"/detections/{det_id}/reject")
    assert res.json()["status"] == "rejected"

    res = client.post(f"/detections/{det_id}/restore")
    assert res.json()["status"] == "pending"


def test_confirm_unknown_id_404(client):
    res = client.post("/detections/99999/confirm")
    assert res.status_code == 404


def test_merge_requires_two_ids(client):
    res = client.post("/detections/merge", json={"ids": [1]})
    assert res.status_code == 400


def _manual_square(client, lng: float, lat: float, half: float = 0.0002) -> int:
    res = client.post(
        "/detections/manual",
        json={
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [lng - half, lat - half],
                    [lng + half, lat - half],
                    [lng + half, lat + half],
                    [lng - half, lat + half],
                    [lng - half, lat - half],
                ]],
            }
        },
    )
    assert res.status_code == 200, res.text
    return res.json()["properties"]["id"]


def test_merge_overlapping_detections(client):
    # Two squares offset by half their width — they genuinely overlap, so the union
    # is a single polygon and the merge should succeed.
    a = _manual_square(client, -118.2500, 34.0500)
    b = _manual_square(client, -118.2498, 34.0500)

    res = client.post("/detections/merge", json={"ids": [a, b]})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["merged_id"] == min(a, b)
    assert body["rejected_ids"] == [max(a, b)]
    # Merged footprint must be larger than either input square.
    assert body["area_m2"] > 0

    # The absorbed row is rejected; the survivor stays pending.
    listing = client.get("/detections").json()["features"]
    by_id = {f["properties"]["id"]: f["properties"]["status"] for f in listing}
    assert by_id[min(a, b)] == "pending"
    assert by_id[max(a, b)] == "rejected"


def test_merge_disjoint_detections_rejected(client):
    # Far apart — the union is a MultiPolygon, which must be refused rather than
    # silently discarding one of the two real footprints.
    a = _manual_square(client, -118.2500, 34.0500)
    b = _manual_square(client, -118.2000, 34.0900)

    res = client.post("/detections/merge", json={"ids": [a, b]})
    assert res.status_code == 400
    assert "overlap" in res.json()["detail"].lower()


def test_erase_circle_rejects_detections_inside(client):
    inside = _manual_square(client, -118.2500, 34.0500)
    outside = _manual_square(client, -118.2000, 34.0900)

    res = client.post(
        "/detections/erase-circle",
        json={"center": [34.0500, -118.2500], "radius_m": 100},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["erased"] == 1
    assert body["ids"] == [inside]

    listing = client.get("/detections").json()["features"]
    by_id = {f["properties"]["id"]: f["properties"]["status"] for f in listing}
    assert by_id[inside] == "rejected"
    assert by_id[outside] == "pending"


def test_coverage_and_stats_empty(client):
    res = client.get("/coverage")
    assert res.status_code == 200
    assert res.json()["scanned_area_km2"] == 0.0

    res = client.get("/detection-stats")
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 0
    assert body["scans"] == 0


def test_export_404_when_empty(client):
    res = client.get("/detections/export/confirmed.gpkg")
    assert res.status_code == 404
    res = client.get("/detections/export/confirmed.csv")
    assert res.status_code == 404


def test_export_gpkg_after_confirm(client):
    with patch("solar_scan_api.sam3_run_detection", return_value=_mock_detect_result()):
        scan_res = client.post("/scan", json={"bbox": _BBOX, "model": "sam3", "auto_confirm": True})
    assert scan_res.json()["stored"]["confirmed"] == 1

    res = client.get("/detections/export/confirmed.gpkg")
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/geopackage+sqlite3"

    res = client.get("/detections/export/confirmed.csv")
    assert res.status_code == 200
    assert "text/csv" in res.headers["content-type"]
