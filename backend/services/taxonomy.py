"""Portfolio classification: the fixed sector and section vocabularies.

Both are user-owned — these defaults are a starting point that the user edits
from the Classification tab. Nothing here re-derives a value the user has set.
"""

SECTORS = [
    "Financials",
    "Healthcare",
    "Datacentre",
    "CapitalMarket",
    "AI",
    "Software",
    "Semiconductor",
    "Others",
]

# Hyperscalers — the largest companies in the world (FAANG + Nvidia).
# Satellite  — small, high growth: high risk, high reward.
# regular    — everything else.
SECTIONS = ["Hyperscalers", "Satellite", "regular"]

DEFAULT_SECTOR = "Others"
DEFAULT_SECTION = "regular"

# AI is reserved for US names, so an Indian holding never defaults into it.
_INDIA_FORBIDDEN_SECTORS = {"AI"}

# Symbol-level defaults, for names whose sector is a judgement call rather than
# something the scraped GICS sector implies.
_SYMBOL_SECTOR = {
    # US mega-cap platforms
    "GOOGL": "AI", "GOOG": "AI", "MSFT": "AI", "AMZN": "AI", "META": "AI",
    # Semiconductors
    "NVDA": "Semiconductor", "ASML": "Semiconductor", "SOXX": "Semiconductor",
    "AMD": "Semiconductor", "TSM": "Semiconductor", "AVGO": "Semiconductor",
    "INTC": "Semiconductor",
    # Software
    "ADBE": "Software", "NOW": "Software", "CRM": "Software", "SNAP": "Software",
    "NFLX": "Software",
    # Datacentre / power-for-compute
    "TECHNOE": "Datacentre", "VRT": "Datacentre", "EQIX": "Datacentre",
    "DLR": "Datacentre", "ANANTRAJ": "Datacentre",
    # Capital markets (exchanges, wealth, brokers)
    "NUVAMAWEAL": "CapitalMarket", "BSE": "CapitalMarket",
    "MCX": "CapitalMarket", "CDSL": "CapitalMarket", "ANGELONE": "CapitalMarket",
    "360ONE": "CapitalMarket", "MOTILALOFS": "CapitalMarket",
}

_SYMBOL_SECTION = {
    "GOOGL": "Hyperscalers", "GOOG": "Hyperscalers", "MSFT": "Hyperscalers",
    "AMZN": "Hyperscalers", "META": "Hyperscalers", "NVDA": "Hyperscalers",
    "OKLO": "Satellite",
}

# Fallback from the scraped GICS-style sector when the symbol is not listed.
_SCRAPED_SECTOR = {
    "Financials": "Financials",
    "Financial Services": "Financials",
    "Healthcare": "Healthcare",
    "Health Care": "Healthcare",
    "Technology": "Software",
    "Information Technology": "Software",
}


def default_sector(symbol: str, country: str, scraped_sector: str = "") -> str:
    """Best-guess sector for a holding the user has not classified yet."""
    sym = (symbol or "").strip().upper()
    is_india = (country or "IND").upper() == "IND"

    sector = _SYMBOL_SECTOR.get(sym) or _SCRAPED_SECTOR.get(scraped_sector or "")
    if not sector:
        return DEFAULT_SECTOR
    if is_india and sector in _INDIA_FORBIDDEN_SECTORS:
        return "Software"
    return sector


def default_section(symbol: str) -> str:
    return _SYMBOL_SECTION.get((symbol or "").strip().upper(), DEFAULT_SECTION)
