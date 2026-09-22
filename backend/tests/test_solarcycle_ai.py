import json

import solarcycle_ai
from agent.llm import LLMTurn

_SITES = [
    {"state": "AZ", "name": "Red Rock Landfill", "pv_status": "accepts", "cost_per_panel": 2.1, "notes": None},
    {"state": "AZ", "name": "Cerbat Landfill", "pv_status": "declines", "cost_per_panel": None},
    {"state": "NV", "name": "Ely", "pv_status": "not_surveyed"},
]


def _events(body: str) -> list[tuple[str, dict]]:
    out = []
    for block in body.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.split("\n"))
        out.append((lines["event"], json.loads(lines["data"])))
    return out


def test_summary_counts_by_state_and_price_range():
    summary = solarcycle_ai.summarise(_SITES)
    assert summary["rows"] == 3
    assert summary["by_state"]["AZ"] == {"accepts": 1, "declines": 1, "total": 2}
    assert summary["priced_sites"] == 1
    assert summary["cheapest_per_panel"] == 2.1


def test_prompt_contains_rows_without_empty_fields():
    prompt = solarcycle_ai.build_system_prompt(_SITES)
    assert "Red Rock Landfill" in prompt
    assert '"notes":null' not in prompt


def test_health_reports_missing_key(client, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    assert client.get("/solarcycle-ai/health").json()["configured"] is False


def test_chat_rejects_empty_conversation(client):
    res = client.post("/solarcycle-ai/chat", json={"messages": [], "sites": _SITES})
    assert res.status_code == 422


def test_chat_streams_reply(client, monkeypatch):
    captured = {}

    async def fake_stream_turn(*, system, messages, tools, max_tokens):
        captured.update(system=system, messages=messages, tools=tools)
        yield "Red Rock ", None
        yield "accepts panels.", None
        yield "", LLMTurn(text="Red Rock accepts panels.")

    monkeypatch.setattr(solarcycle_ai, "stream_turn", fake_stream_turn)
    res = client.post(
        "/solarcycle-ai/chat",
        json={"messages": [{"role": "user", "content": "Who accepts panels?"}], "sites": _SITES},
    )

    assert res.status_code == 200
    events = _events(res.text)
    text = "".join(d["text"] for e, d in events if e == "assistant_delta")
    assert text == "Red Rock accepts panels."
    assert events[-1][0] == "done"
    assert captured["tools"] == []
    assert "Cerbat Landfill" in captured["system"]


def test_chat_reports_missing_api_key(client, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    res = client.post(
        "/solarcycle-ai/chat",
        json={"messages": [{"role": "user", "content": "hi"}], "sites": _SITES},
    )
    events = _events(res.text)
    assert events[0][0] == "error"
    assert "OPENAI_API_KEY" in events[0][1]["message"]
    assert events[-1][0] == "done"
