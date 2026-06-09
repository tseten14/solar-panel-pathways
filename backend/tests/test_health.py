def test_health_shape(client):
    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert isinstance(data["sam3_loaded"], bool)
    assert isinstance(data["yolo_available"], bool)
    assert isinstance(data["cache_landfills"], bool)
    assert isinstance(data["cache_solar"], bool)
    assert isinstance(data["streetview_configured"], bool)
