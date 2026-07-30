import json
from unittest.mock import AsyncMock, patch

import pytest


@pytest.fixture(autouse=True)
def _clear_ai_cache():
    import solar_ai_cache

    solar_ai_cache._store.clear()
    yield
    solar_ai_cache._store.clear()


_FACT_LEDGER = [
    {
        "id": "fact_landfill_open_count",
        "value": 1260,
        "source_label": "EPA LMOP",
        "source_url": "https://epa.gov",
        "domain": "epa.gov",
        "claim": "1,260 open MSW landfills tracked",
    }
]

_LLM_RESPONSE = json.dumps(
    {
        "title": "Landfill overview",
        "confidence": "high",
        "sections": [
            {
                "heading": "Status",
                "lines": [{"text": "1260 landfills are currently open.", "refs": ["fact_landfill_open_count"]}],
            }
        ],
        "disclaimer": "Figures from EPA LMOP.",
        "suggested_follow_ups": ["Which state has the most open landfills?"],
    }
)


def test_analyze_requires_context(client):
    res = client.post("/solar-ai/analyze", json={"action": "landfill_overview"})
    assert res.status_code == 422  # context is a required field


def test_analyze_503_without_api_key(client, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    res = client.post(
        "/solar-ai/analyze",
        json={"action": "landfill_overview", "context": {"fact_ledger": _FACT_LEDGER}},
    )
    assert res.status_code == 503


def test_analyze_happy_path(client, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-key")
    with patch("solar_ai._call_openai", new=AsyncMock(return_value=_LLM_RESPONSE)):
        res = client.post(
            "/solar-ai/analyze",
            json={"action": "landfill_overview", "context": {"fact_ledger": _FACT_LEDGER}},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["confidence"] == "high"
    assert body["sources"][0]["id"] == "fact_landfill_open_count"
    assert body["sections"][0]["lines"][0]["refs"] == ["fact_landfill_open_count"]


def test_analyze_downgrades_confidence_on_fabricated_number(client, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-key")
    fabricated = json.dumps(
        {
            "title": "Landfill overview",
            "confidence": "high",
            "sections": [
                {"heading": "Status", "lines": [{"text": "There are 999999 open landfills.", "refs": []}]}
            ],
            "disclaimer": "x",
            "suggested_follow_ups": [],
        }
    )
    with patch("solar_ai._call_openai", new=AsyncMock(return_value=fabricated)):
        res = client.post(
            "/solar-ai/analyze",
            json={"action": "landfill_overview", "context": {"fact_ledger": _FACT_LEDGER}},
        )
    assert res.status_code == 200
    assert res.json()["confidence"] == "low"


def test_analyze_429_on_quota_error(client, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-key")
    from solar_ai import QuotaError

    with patch("solar_ai._call_openai", new=AsyncMock(side_effect=QuotaError("rate limited"))):
        res = client.post(
            "/solar-ai/analyze",
            json={"action": "landfill_overview", "context": {"fact_ledger": _FACT_LEDGER}},
        )
    assert res.status_code == 429
