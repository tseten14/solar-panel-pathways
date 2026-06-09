from unittest.mock import AsyncMock, patch


def test_streetview_missing_api_key(client, monkeypatch):
    monkeypatch.delenv("GOOGLE_MAPS_API_KEY", raising=False)
    res = client.get("/streetview-image?lat=42.28&lng=-83.74")
    assert res.status_code == 503
    assert "GOOGLE_MAPS_API_KEY" in res.json()["detail"]


def test_streetview_no_panorama(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "test-key")

    class FakeResponse:
        status_code = 200
        text = '{"status":"ZERO_RESULTS"}'

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=FakeResponse())

    with patch("main.httpx.AsyncClient") as mock_cls:
        mock_cls.return_value.__aenter__.return_value = mock_client
        mock_cls.return_value.__aexit__.return_value = None
        res = client.get("/streetview-image?lat=0&lng=0")

    assert res.status_code == 404
