# Deterministic citation resolution for Solar-AI — maps fact ids and numeric
# claims in each paragraph to verified source URLs from the client fact ledger.
# Direct port of ndc-data-explorer's dashboardAiCitations.js; this is the
# feature's hallucination guardrail and is ported without simplification.
from __future__ import annotations

import re
from typing import Any


def _extract_numbers(text: str | None) -> list[float]:
    if not text:
        return []
    return [float(m) for m in re.findall(r"\d+(?:\.\d+)?", str(text))]


def _values_match(a: float | None, b: float | None) -> bool:
    if a is None or b is None:
        return False
    try:
        x, y = float(a), float(b)
    except (TypeError, ValueError):
        return False
    if abs(x - y) < 0.06:
        return True
    denom = max(abs(x), abs(y), 0.001)
    return abs(x - y) / denom < 0.025


def match_facts_by_numbers(text: str, ledger: list[dict]) -> list[dict]:
    nums = _extract_numbers(text)
    if not nums:
        return []
    matched = []
    for fact in ledger:
        if fact.get("value") is None:
            continue
        if any(_values_match(n, fact["value"]) for n in nums):
            matched.append(fact)
    return matched


def _fact_to_citation(fact: dict, used: dict[str, dict]) -> dict:
    link = {
        "id": fact["id"],
        "label": fact.get("source_label"),
        "url": fact.get("source_url"),
        "domain": fact.get("domain"),
        "claim": fact.get("claim"),
    }
    used[fact["id"]] = link
    return link


def _resolve_fact_refs(refs: list[str], fact_map: dict[str, dict], used: dict[str, dict]) -> list[dict]:
    out = []
    for ref in refs or []:
        fact = fact_map.get(ref)
        if fact:
            out.append(_fact_to_citation(fact, used))
    return out


def _infer_facts_from_keywords(text: str, context: dict, ledger: list[dict]) -> list[dict]:
    lower = (text or "").lower()
    inferred: list[dict] = []

    wants_landfill = bool(re.search(r"landfill|epa|lmop|waste in place|disposal", lower))
    wants_solar = bool(re.search(r"solar capacity|uspvdb|usgs|utility solar|mw\b|megawatt", lower))
    wants_trade = bool(re.search(r"trade|interstate|route|flow", lower))
    wants_coverage = bool(re.search(r"coverage|scanned|detection", lower))

    if wants_landfill:
        facts = [f for f in ledger if f["id"].startswith("fact_landfill_") and f.get("value") is not None]
        if facts:
            inferred.append(facts[0])
    if wants_solar:
        facts = [f for f in ledger if f["id"].startswith("fact_solar_") and f.get("value") is not None]
        if facts:
            inferred.append(facts[0])
    if wants_trade:
        facts = [f for f in ledger if f["id"].startswith("fact_trade_") and f.get("value") is not None]
        inferred.extend(facts[:2])
    if wants_coverage:
        facts = [f for f in ledger if f["id"].startswith("fact_coverage_") and f.get("value") is not None]
        inferred.extend(facts[:2])

    return inferred


def validate_paragraph_numbers(text: str, ledger: list[dict]) -> dict:
    nums = _extract_numbers(text)
    allowed = [float(f["value"]) for f in ledger if f.get("value") is not None]
    unmatched = [n for n in nums if not any(_values_match(n, v) for v in allowed)]
    return {"valid": len(unmatched) == 0, "unmatched": unmatched}


def enrich_citations_from_facts(parsed: dict, context: dict) -> dict:
    ledger: list[dict] = context.get("fact_ledger") or []
    fact_map = {f["id"]: f for f in ledger}
    used: dict[str, dict] = {}
    has_unverified_numbers = False

    sections = []
    for section in parsed.get("sections") or []:
        lines = []
        for line in section.get("lines") or []:
            text = line if isinstance(line, str) else (line or {}).get("text", "")
            raw_refs = [] if isinstance(line, str) else (line or {}).get("refs", [])

            citations = _resolve_fact_refs(raw_refs, fact_map, used)
            if not citations:
                citations = [_fact_to_citation(f, used) for f in match_facts_by_numbers(text, ledger)]
            if not citations:
                citations = [
                    _fact_to_citation(f, used) for f in _infer_facts_from_keywords(text, context, ledger)
                ]

            validation = validate_paragraph_numbers(text, ledger)
            if not validation["valid"] and _extract_numbers(text):
                has_unverified_numbers = True

            lines.append({"text": text, "refs": [c["id"] for c in citations], "citations": citations})
        sections.append({**section, "lines": lines})

    return {
        **parsed,
        "sections": sections,
        "sources": list(used.values()),
        "has_unverified_numbers": has_unverified_numbers,
    }
