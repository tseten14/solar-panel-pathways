import data_cache


def test_get_landfills_from_fixture(landfills_cache):
    payload = data_cache.get_landfills()
    assert len(payload["features"]) == 1
    assert payload["fetched_at"] == 1_700_000_000.0


def test_cache_status_with_fixtures(landfills_cache, solar_cache):
    status = data_cache.cache_status()
    assert status["cache_landfills"] is True
    assert status["cache_solar"] is True
    assert status["landfills_fetched_at"] == 1_700_000_000.0
    assert status["solar_fetched_at"] == 1_700_000_000.0
