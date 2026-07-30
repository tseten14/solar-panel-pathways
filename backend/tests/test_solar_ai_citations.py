from solar_ai_citations import enrich_citations_from_facts, match_facts_by_numbers, validate_paragraph_numbers

LEDGER = [
    {"id": "fact_landfill_open_count", "value": 1260, "source_label": "EPA LMOP", "source_url": "https://epa.gov"},
    {"id": "fact_solar_total_mw", "value": 162802, "source_label": "USGS USPVDB", "source_url": "https://usgs.gov"},
]


def test_match_facts_by_numbers():
    matched = match_facts_by_numbers("There are 1260 open landfills.", LEDGER)
    assert len(matched) == 1
    assert matched[0]["id"] == "fact_landfill_open_count"


def test_match_facts_by_numbers_tolerant_of_rounding():
    matched = match_facts_by_numbers("About 1259.7 open landfills.", LEDGER)
    assert len(matched) == 1


def test_validate_paragraph_numbers_flags_unknown_value():
    result = validate_paragraph_numbers("There are 99999 open landfills.", LEDGER)
    assert result["valid"] is False
    assert 99999 in result["unmatched"]


def test_enrich_citations_resolves_explicit_refs():
    parsed = {
        "title": "Landfill overview",
        "sections": [
            {
                "heading": "Status",
                "lines": [{"text": "1260 landfills are open.", "refs": ["fact_landfill_open_count"]}],
            }
        ],
    }
    enriched = enrich_citations_from_facts(parsed, {"fact_ledger": LEDGER})
    assert enriched["has_unverified_numbers"] is False
    assert enriched["sources"][0]["id"] == "fact_landfill_open_count"
    assert enriched["sections"][0]["lines"][0]["refs"] == ["fact_landfill_open_count"]


def test_enrich_citations_flags_fabricated_number():
    parsed = {
        "sections": [{"heading": "Status", "lines": [{"text": "There are 42000 open landfills.", "refs": []}]}],
    }
    enriched = enrich_citations_from_facts(parsed, {"fact_ledger": LEDGER})
    assert enriched["has_unverified_numbers"] is True
