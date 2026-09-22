"""Chat assistant for the SolarCycle Data page.

Answers questions about SolarCycle's landfill survey using only the survey rows
the page sends with each request. Replies stream as Server-Sent Events in the
same shape as the map agent, so the browser can reuse its SSE reader.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, AsyncIterator, Literal

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agent.llm import MissingApiKey, agent_model, stream_turn

router = APIRouter(prefix="/solarcycle-ai", tags=["solarcycle-ai"])
_log = logging.getLogger("uvicorn.error")

MAX_TOKENS = int(os.environ.get("SOLARCYCLE_AI_MAX_TOKENS", "1500"))
MAX_SURVEY_CHARS = 60_000

SYSTEM_PROMPT = """You are the SolarCycle data assistant. You answer questions about \
SolarCycle's landfill survey: which landfills in Arizona, Nevada, Texas and New Mexico \
accept end-of-life solar (PV) panels, their restrictions, contacts, and disposal prices.

The full survey is given below as JSON, one object per landfill row. Field meanings:
- pv_status: "accepts", "declines", "unknown" (asked, no clear answer), or \
"not_surveyed" (on the call list, no answer recorded yet). pv_raw is the survey's own wording.
- cost is the quoted price as of July 2024, per `cost_per` `cost_unit` (2000 lbs = one ton).
- cost_per_panel is SolarCycle's per-panel estimate derived from that price.
- restrictions, notes and call_notes are free text from the callers.
- Missing fields were not recorded.

Rules:
- Use ONLY this survey. If it does not contain the answer, say so plainly and, if useful, \
say what is recorded instead. Never guess prices, policies or contacts.
- Count carefully when asked "how many"; the summary block has the headline totals.
- Name the specific landfills (with state) behind any claim, and quote prices exactly as \
recorded, noting they are July 2024 quotes.
- Beatty Facility (NV) appears twice: once for non-hazardous and once for hazardous waste.
- Keep answers short: a sentence or two, then a short list or table only when it helps. \
Use Markdown.

SURVEY SUMMARY:
{summary}

SURVEY ROWS (JSON):
{rows}"""


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8_000)


class SurveyChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=40)
    sites: list[dict[str, Any]] = Field(max_length=2_000)


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def summarise(sites: list[dict[str, Any]]) -> dict[str, Any]:
    by_state: dict[str, dict[str, int]] = {}
    for s in sites:
        state = str(s.get("state") or "?")
        status = str(s.get("pv_status") or "not_surveyed")
        row = by_state.setdefault(state, {})
        row[status] = row.get(status, 0) + 1
        row["total"] = row.get("total", 0) + 1
    priced = sorted(
        (s for s in sites if isinstance(s.get("cost_per_panel"), (int, float)) and s["cost_per_panel"] > 0),
        key=lambda s: s["cost_per_panel"],
    )
    return {
        "rows": len(sites),
        "by_state": by_state,
        "priced_sites": len(priced),
        "cheapest_per_panel": priced[0]["cost_per_panel"] if priced else None,
        "most_expensive_per_panel": priced[-1]["cost_per_panel"] if priced else None,
    }


def build_system_prompt(sites: list[dict[str, Any]]) -> str:
    compact = [{k: v for k, v in s.items() if v not in (None, "")} for s in sites]
    rows = json.dumps(compact, separators=(",", ":"))
    if len(rows) > MAX_SURVEY_CHARS:
        rows = rows[:MAX_SURVEY_CHARS] + "...[truncated]"
    return SYSTEM_PROMPT.format(summary=json.dumps(summarise(sites)), rows=rows)


@router.get("/health")
async def health() -> dict:
    return {
        "configured": bool((os.environ.get("OPENAI_API_KEY") or "").strip()),
        "model": agent_model(),
    }


@router.post("/chat")
async def chat(body: SurveyChatRequest):
    system = build_system_prompt(body.sites)
    messages = [m.model_dump() for m in body.messages]

    async def stream() -> AsyncIterator[str]:
        try:
            async for delta, _final in stream_turn(
                system=system, messages=messages, tools=[], max_tokens=MAX_TOKENS
            ):
                if delta:
                    yield _sse("assistant_delta", {"text": delta})
        except MissingApiKey as exc:
            yield _sse("error", {"message": str(exc)})
        except Exception as exc:  # noqa: BLE001
            _log.exception("solarcycle assistant failed")
            yield _sse("error", {"message": str(exc)})
        yield _sse("done", {})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
