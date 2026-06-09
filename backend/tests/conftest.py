import json
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from main import app

    return TestClient(app)


@pytest.fixture
def landfills_cache(tmp_path, monkeypatch):
    import data_cache

    cache_file = tmp_path / "landfills.json"
    payload = {
        "features": [
            {
                "attributes": {
                    "OBJECTID": 1,
                    "landfill_name": "Test Landfill",
                    "county_state": "Washtenaw, MI",
                    "landfill_owner_org": "County",
                    "current_landfill_status": "Open",
                    "latitude": 42.28,
                    "longitude": -83.74,
                    "landfill_design_cap": 1000,
                    "waste_in_place_tons": 500,
                }
            }
        ],
        "fetched_at": 1_700_000_000.0,
    }
    cache_file.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setattr(data_cache, "LANDFILLS_CACHE", cache_file)
    return cache_file


@pytest.fixture
def solar_cache(tmp_path, monkeypatch):
    import data_cache

    cache_file = tmp_path / "solar_stats.json"
    payload = {
        "features": [
            {
                "attributes": {
                    "p_state": "CA",
                    "total_mw": 1000.0,
                    "facility_count": 50,
                }
            }
        ],
        "fetched_at": 1_700_000_000.0,
    }
    cache_file.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setattr(data_cache, "SOLAR_STATS_CACHE", cache_file)
    return cache_file
