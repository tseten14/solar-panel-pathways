# Solar-AI: OpenAI-backed Q&A over this app's own data (EPA landfill stats, USGS
# solar capacity, modelled trade flows, detection coverage). Port of
# ndc-data-explorer's NDC-AI dashboard panel (backend/routes/dashboardAi.js) —
# same raw-fetch-to-OpenAI approach (no SDK), same fact_ledger citation
# discipline, reworded for PV-waste-flow intelligence instead of NDC targets.
from __future__ import annotations

import json
import os
import re

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import solar_ai_cache
from solar_ai_citations import enrich_citations_from_facts

router = APIRouter(prefix="/solar-ai")

OPENAI_URL = "https://api.openai.com/v1/chat/completions"
# Literal default matches the reference app's own default (its .env does not
# override OPENAI_MODEL either) — override with OPENAI_MODEL if needed.
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.6-sol")
MAX_CONTEXT_CHARS = 24_000
OPENAI_TIMEOUT_S = 55.0


class QuotaError(Exception):
    pass


ACTION_PROMPTS: dict[str, str] = {
    "landfill_overview": (
        "Write 3-4 prose sections on tracked MSW landfill status: open vs closed, "
        "states covered, and waste-in-place volume. Use ONLY numbers from "
        "context.fact_ledger. Each paragraph's refs must list fact ids for every "
        "number you mention."
    ),
    "solar_capacity_gap": (
        "Write 3-4 prose sections comparing utility-scale solar capacity (USGS "
        "USPVDB) to the volume of PV waste the landfill network may eventually "
        "receive. Cite fact_solar_* for capacity figures and fact_landfill_* for "
        "landfill figures — never mix them on one ref list incorrectly."
    ),
    "trade_flow_summary": (
        "Write 3-4 prose sections on the modelled interstate PV-waste trade "
        "routes: which are largest, and what that implies for disposal capacity "
        "planning. Every numeric claim must match a fact in context.fact_ledger "
        "and cite that fact id."
    ),
    "detection_progress": (
        "Write 3-4 prose sections on satellite detection coverage progress: "
        "area scanned, and pending vs confirmed solar array counts. Only use "
        "numbers from context.fact_ledger with matching fact id refs."
    ),
}

SYSTEM_PROMPT = """You are a plain-language analyst for SolarTrace, a PV-waste-flow \
intelligence tool tracking end-of-life solar panel disposal across U.S. landfills.

You receive JSON with live app data plus a fact_ledger: every number you may quote is \
pre-listed with an exact id, value, and verified source URL.

Write like Perplexity: prose paragraphs with precise inline citations — each paragraph \
cites ONLY the fact ids backing the numbers in THAT paragraph.

Respond ONLY with valid JSON:

{
  "title": "<short answer title, max 8 words>",
  "confidence": "high" | "medium" | "low",
  "sections": [
    {
      "heading": "<section heading>",
      "lines": [
        {
          "text": "<one prose paragraph: 2-3 sentences, 40-80 words>",
          "refs": ["<fact id from context.fact_ledger — one per number cited>"]
        }
      ]
    }
  ],
  "disclaimer": "<one sentence, max 25 words>",
  "suggested_follow_ups": ["<question 1>", "<question 2>"]
}

Critical rules:
- ONLY use numbers that appear in context.fact_ledger (value field). Never invent, \
round differently, or estimate.
- Every number in text MUST have a matching fact id in refs for that paragraph.
- refs must be copied exactly from context.fact_ledger[].id (e.g. \
fact_landfill_open_count, fact_solar_total_mw, fact_trade_top_route_tons, \
fact_coverage_scanned_km2).
- Landfill figures -> fact_landfill_* ids. Solar capacity figures -> fact_solar_* ids. \
Trade flow figures -> fact_trade_* ids. Detection coverage -> fact_coverage_* ids.
- Do NOT cite generic sources (EPA, USGS, dashboard). Cite the specific fact id.
- If data is missing from fact_ledger, say it is unavailable — do not guess.
- 3-5 sections, 1-2 paragraphs each, no bullet lists.
- confidence is "high" only when all numbers map to fact_ledger.
- Return JSON only — no markdown fences."""


async def _call_openai(api_key: str, system_text: str, user_text: str) -> str:
    async with httpx.AsyncClient(timeout=OPENAI_TIMEOUT_S) as client:
        res = await client.post(
            OPENAI_URL,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
            json={
                "model": OPENAI_MODEL,
                "messages": [
                    {"role": "system", "content": system_text},
                    {"role": "user", "content": user_text},
                ],
                # Newer OpenAI models reject max_tokens and non-default temperature
                # on Chat Completions — same constraint the reference app documents.
                "max_completion_tokens": 2800,
            },
        )
        if res.status_code != 200:
            try:
                err_body = res.json()
            except Exception:
                err_body = {}
            msg = (err_body.get("error") or {}).get("message") or f"HTTP {res.status_code}"
            if res.status_code == 429:
                raise QuotaError(
                    "The AI service rate limit has been reached. Please wait a moment and try again."
                )
            raise RuntimeError(f"OpenAI {res.status_code}: {msg}")
        data = res.json()
        return (data.get("choices") or [{}])[0].get("message", {}).get("content", "")


def _build_user_message(action: str | None, question: str | None, context: dict) -> str:
    context_json = json.dumps(context)
    trimmed = (
        context_json[:MAX_CONTEXT_CHARS] + "\n...[context truncated]"
        if len(context_json) > MAX_CONTEXT_CHARS
        else context_json
    )
    task_line = (
        f'User question: "{question}"'
        if question
        else ACTION_PROMPTS.get(action or "", ACTION_PROMPTS["landfill_overview"])
    )
    return f"Task: {task_line}\n\n--- APP CONTEXT (JSON) ---\n{trimmed}"


def _parse_llm_json(raw: str) -> dict:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        stripped = re.sub(r"^```json?\s*", "", raw.strip(), flags=re.IGNORECASE)
        stripped = re.sub(r"```\s*$", "", stripped).strip()
        return json.loads(stripped)


class AnalyzeIn(BaseModel):
    action: str | None = None
    question: str | None = None
    context: dict


@router.post("/analyze")
async def analyze(body: AnalyzeIn) -> dict:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(503, "AI analysis is not available on this server (OPENAI_API_KEY not set).")

    selected_target = body.context.get("selected_target")
    target = selected_target.get("id", "none") if isinstance(selected_target, dict) else "none"
    cache_key = (
        f"solar-ai:chat:{(body.question or '')[:80]}:{target}"
        if body.question
        else f"solar-ai:{body.action or 'landfill_overview'}:{target}"
    )
    cached = solar_ai_cache.get(cache_key)
    if cached:
        return {**cached, "from_cache": True}

    try:
        user_message = _build_user_message(body.action, body.question, body.context)
        raw = await _call_openai(api_key, SYSTEM_PROMPT, user_message)
        parsed = _parse_llm_json(raw)
    except QuotaError as e:
        raise HTTPException(429, str(e)) from e
    except (httpx.HTTPError, json.JSONDecodeError, RuntimeError) as e:
        raise HTTPException(500, str(e) or "Analysis failed") from e

    enriched = enrich_citations_from_facts(parsed, body.context)
    confidence = "low" if enriched.get("has_unverified_numbers") else enriched.get("confidence", "medium")
    result = {
        "type": "chat" if body.question else (body.action or "landfill_overview"),
        "title": enriched.get("title", "SolarTrace analysis"),
        "sections": enriched.get("sections", []),
        "sources": enriched.get("sources", []),
        "confidence": confidence,
        "disclaimer": enriched.get("disclaimer")
        or (
            "Some figures could not be matched to verified app facts — treat with caution."
            if enriched.get("has_unverified_numbers")
            else "Figures are tied to EPA LMOP and USGS USPVDB sources listed in citations."
        ),
        "suggested_follow_ups": enriched.get("suggested_follow_ups", []),
    }
    solar_ai_cache.set(cache_key, result)
    return result
