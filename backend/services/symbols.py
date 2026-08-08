"""Single source of truth for ticker resolution.

Two distinct lookups live here:

  * COMPANY_NAME_TO_SYMBOL — free text off a broker screenshot -> ticker.
    Used by the OCR parser, where the input is a company name.
  * TICKER_ALIASES — a ticker we already have -> the symbol the quote
    provider actually expects. Used by the quote service.
"""

import re

# Company name (as it appears in broker UIs) -> US ticker.
US_COMPANY_NAMES = {
    "ADOBE": "ADBE",
    "ALPHABET": "GOOGL",
    "AMAZON": "AMZN",
    "AMD": "AMD",
    "APPLE": "AAPL",
    "BERKSHIRE": "BRK-B",
    "BROADCOM": "AVGO",
    "COINBASE": "COIN",
    "DISNEY": "DIS",
    "FACEBOOK": "META",
    "GOOGLE": "GOOGL",
    "INTEL": "INTC",
    "META": "META",
    "MICROSOFT": "MSFT",
    "MICROSTRATEGY": "MSTR",
    "NETFLIX": "NFLX",
    "NOVO NORDISK": "NVO",
    "NOVO-NORDISK": "NVO",
    "NVIDIA": "NVDA",
    "OKLO": "OKLO",
    "PALANTIR": "PLTR",
    "QUALCOMM": "QCOM",
    "TESLA": "TSLA",
}

# Company name (as it appears in broker UIs) -> NSE ticker.
INDIAN_COMPANY_NAMES = {
    "AAVAS FINANCIERS": "AAVAS",
    "AAVAS": "AAVAS",
    "ANANT RAJ": "ANANTRAJ",
    "AXIS BANK": "AXISBANK",
    "BHARTI AIRTEL": "BHARTIARTL",
    "CAPRI GLOBAL CAPITAL": "CGCL",
    "DCB BANK": "DCBBANK",
    "DCBBANK": "DCBBANK",
    "GLOBAL HEALTH": "MEDANTA",
    "HDFC BANK": "HDFCBANK",
    "HERO MOTOCORP": "HEROMOTOCO",
    "HINDUSTAN UNILEVER": "HINDUNILVR",
    "HOME FIRST FINANCE": "HOMEFIRST",
    "HOME FIRST": "HOMEFIRST",
    "ICICI BANK": "ICICIBANK",
    "ICICI PRUDENT.NIFTY": "NIFTYIETF",
    "ICICI PRUDENTIAL NIFTY": "NIFTYIETF",
    "IDFC FIRST BANK": "IDFCFIRSTB",
    "INFOSYS": "INFY",
    "ITC": "ITC",
    "JIO FINANCIAL SERV": "JIOFIN",
    "JIO FINANCIAL SERVICES": "JIOFIN",
    "JIO FINANCIAL": "JIOFIN",
    "JIOFIN": "JIOFIN",
    "JUPITER LIFE LINE": "JLHL",
    "KOTAK MAHINDRA BANK": "KOTAKBANK",
    "KOVAI MEDICAL CENTER": "KOVAI",
    "KOVAI MEDICAL": "KOVAI",
    "LARSEN & TOUBRO": "LT",
    "MAX HEALTHCARE": "MAXHEALTH",
    "MAXHEALTH": "MAXHEALTH",
    "MEDI ASSIST HEALTH": "MEDIASSIST",
    "MOREALTY": "MOREALTY",
    "NIPPON INDIA ETF BANK": "BANKBEES",
    "NIPPON INDIA ETF IT": "ITBEES",
    "NIPPON INDIA ETF NIFTY IT": "ITBEES",
    "OBEROI REALTY": "OBEROIRLTY",
    "RELIANCE IND": "RELIANCE",
    "RELIANCE INDUSTRIES": "RELIANCE",
    "SBI CARD": "SBICARD",
    "SBI CARDS AND PAY": "SBICARD",
    "SBI CARDS": "SBICARD",
    "SBI": "SBIN",
    "STATE BANK OF INDIA": "SBIN",
    "TATA CONSULTANCY SERVICES": "TCS",
    "TATA MOTORS": "TATAMOTORS",
    "TECHNO ELECTRIC": "TECHNOE",
}

COMPANY_NAME_TO_SYMBOL = {**US_COMPANY_NAMES, **INDIAN_COMPANY_NAMES}

# Longest keys first so "SBI CARDS" wins over "SBI" regardless of dict order.
_NAME_KEYS_BY_LENGTH = sorted(COMPANY_NAME_TO_SYMBOL, key=len, reverse=True)

# Tickers that a broker or an earlier OCR run may have stored in a truncated or
# non-canonical form -> the symbol NSE (and therefore the quote APIs) expects.
TICKER_ALIASES = {
    # OCR reads the company name where the ticker should be.
    "VISA": "V",
    "APTUSVALUE": "APTUS",
    "CANARABANK": "CANBK",
    "FORTISHEAL": "FORTIS",
    "HOMEFIRSTF": "HOMEFIRST",
    "ICICINIFTY": "NIFTYIETF",
    "ICICINIFTY50": "NIFTYIETF",
    "JIOFINANCI": "JIOFIN",
    "JIOFINANCIAL": "JIOFIN",
    "MAXHEALTHC": "MAXHEALTH",
    "NIFTYIT": "ITBEES",
    "NIPPONIT": "ITBEES",
    "NUVAMAWEAL": "NUVAMA",
    "SBICARDS": "SBICARD",
    "SBICARDSANDPAY": "SBICARD",
}

# Funds, not companies. They have no P/E, ROE, EPS or quarterly results, and
# the providers do not say so: screener.in serves an ordinary company page with
# every ratio blank rather than a 404, so the deep-dive page cannot detect a
# fund from the response and has to be told here.
ETF_SYMBOLS = {
    # US
    "VOO", "QQQM", "SOXX", "IGV",
    # India
    "ITBEES", "NIFTYIETF", "BANKBEES",
}


def is_etf(symbol: str) -> bool:
    return resolve_quote_symbol(symbol) in ETF_SYMBOLS


# Suffixes that carry no identifying information once we are matching names.
_NOISE_WORDS = re.compile(
    r"\b(LTD|LIMITED|CORP|CORPORATION|INC|SERVICES|ETF|INDEX|REIT|CLASS|CLAS|A|B|A/S)\b"
)


def resolve_quote_symbol(symbol: str) -> str:
    """Maps a stored ticker onto the symbol the quote providers recognise."""
    sym = symbol.strip().upper()
    return TICKER_ALIASES.get(sym, sym)


_US_SYMBOLS = set(US_COMPANY_NAMES.values())
_IND_SYMBOLS = set(INDIAN_COMPANY_NAMES.values()) | set(TICKER_ALIASES.values())


def guess_market(symbol: str) -> str:
    """Best guess at the market a bare ticker belongs to: "US" or "IND".

    Only a guess — the user confirms it before anything is saved. Indian
    tickers are the safer default: they are long and varied, while the US
    names we know are enumerated above.
    """
    sym = (symbol or "").strip().upper()
    if sym in _IND_SYMBOLS:
        return "IND"
    if sym in _US_SYMBOLS:
        return "US"
    # US tickers are short and letters-only; NSE symbols are typically longer.
    return "US" if sym.isalpha() and len(sym) <= 4 else "IND"


def normalize_symbol(name_str: str) -> str:
    """Best-effort ticker for a company name read off a screenshot.

    Falls back to a squashed alphanumeric slug when the name is unknown, so a
    holding is never dropped just because it is missing from the dictionary.
    """
    cleaned = name_str.strip().upper()

    for key in _NAME_KEYS_BY_LENGTH:
        if key in cleaned:
            return COMPANY_NAME_TO_SYMBOL[key]

    # Retry without corporate-suffix noise ("APPLE INC" -> "APPLE").
    stripped = _NOISE_WORDS.sub("", cleaned).strip()
    for key in _NAME_KEYS_BY_LENGTH:
        if key in stripped:
            return COMPANY_NAME_TO_SYMBOL[key]

    slug = re.sub(r"[^A-Z0-9]", "", stripped)
    return slug[:10] if slug else "STOCK"
