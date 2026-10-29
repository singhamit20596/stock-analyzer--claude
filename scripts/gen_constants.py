"""Copies the backend's fixed vocabularies into cloud/generated/constants.json,
so the website uses exactly the laptop's lists. Re-run after changing
backend/services/taxonomy.py or symbols.py:

    backend/venv/bin/python scripts/gen_constants.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from services import symbols, taxonomy  # noqa: E402

constants = {
    "SECTORS": taxonomy.SECTORS,
    "SECTIONS": taxonomy.SECTIONS,
    "DEFAULT_SECTOR": taxonomy.DEFAULT_SECTOR,
    "DEFAULT_SECTION": taxonomy.DEFAULT_SECTION,
    "INDIA_FORBIDDEN_SECTORS": sorted(taxonomy._INDIA_FORBIDDEN_SECTORS),
    "SYMBOL_SECTOR": taxonomy._SYMBOL_SECTOR,
    "SYMBOL_SECTION": taxonomy._SYMBOL_SECTION,
    "SCRAPED_SECTOR": taxonomy._SCRAPED_SECTOR,
    "TICKER_ALIASES": symbols.TICKER_ALIASES,
    "ETF_SYMBOLS": sorted(symbols.ETF_SYMBOLS),
}
out = ROOT / "cloud" / "generated" / "constants.json"
out.write_text(json.dumps(constants, indent=2, ensure_ascii=False) + "\n")
print(f"wrote {out.relative_to(ROOT)}")
