"""Single source of truth for ticker resolution.

Two distinct lookups live here:

  * COMPANY_NAME_TO_SYMBOL — free text off a broker screenshot -> ticker.
    Used by the OCR parser, where the input is a company name.
  * TICKER_ALIASES — a ticker we already have -> the symbol the quote
    provider actually expects. Used by the quote service.
"""

import re
from typing import Dict

# Company name (as it appears in broker UIs) -> US ticker.
US_COMPANY_NAMES = {
    "ADOBE": "ADBE",
    # Share class decides the ticker, so the class-specific names have to come
    # before the bare one — otherwise a Class C holding is relabelled Class A.
    "ALPHABET INC CLASS C": "GOOG",
    "ALPHABET CLASS C": "GOOG",
    "ALPHABET INC CLASS A": "GOOGL",
    "ALPHABET CLASS A": "GOOGL",
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
    # Every Groww fund is named "Groww Nifty <something>", and an unknown name
    # falls back to the first ten characters of its slug — which spells
    # GROWWNIFTY, a real NSE ticker for the Groww Nifty 50 ETF. So an unlisted
    # Groww fund does not fail to resolve, it resolves to a *different* fund,
    # and nothing downstream can tell: the defence ETF was priced at ₹9.74
    # against ₹97.44. The whole family is therefore enumerated, codes taken
    # from Groww's own search and each checked against a live quote.
    #
    # Keys stop short of the full names on purpose: brokers truncate the column
    # ("Groww Nifty India Defenc..."), and matching is a substring test, so a
    # key longer than the truncation would never match. Longest key wins, which
    # is what keeps "Groww Nifty 500 Momentum" off the plain "Groww Nifty 50".
    "GROWW BSE POWER": "GROWWPOWER",
    "GROWW GOLD": "GROWWGOLD",
    "GROWW NIFTY 50": "GROWWNIFTY",
    "GROWW NIFTY 500 MOMEN": "GROWWMOM50",
    "GROWW NIFTY CEMENT": "CEMNTGROWW",
    "GROWW NIFTY EV": "GROWWEV",
    "GROWW NIFTY INDIA DEF": "GROWWDEFNC",
    "GROWW NIFTY INDIA INT": "GROWWNET",
    "GROWW NIFTY INDIA RAIL": "GROWWRAIL",
    "GROWW NIFTY METAL": "GROWWMETAL",
    "GROWW NIFTY PRIVATE BAN": "PVTBKGROWW",
    "GROWW NIFTY SMALLCAP": "GROWWSC250",
    "GROWW SILVER": "GROWWSLVR",
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

# Matching happens on names squashed to bare alphanumerics, because OCR often
# reads a broker's wrapped column with the spaces missing: "SBI Cards And Pay"
# comes back as "SBICardsAndPay", where the spaced key cannot match but the
# three-letter "SBI" key can — which silently turned SBI Cards into State Bank
# of India. Longest key first, so the specific name always beats the prefix.
_SQUASH = re.compile(r"[^A-Z0-9]")

_SQUASHED_NAME_KEYS = sorted(
    ((_SQUASH.sub("", key), symbol) for key, symbol in COMPANY_NAME_TO_SYMBOL.items()),
    key=lambda pair: len(pair[0]),
    reverse=True,
)

# A short key is a substring of too many unrelated names: "META" sits inside
# "Groww Nifty Metal ETF", which resolved a metal fund to Meta Platforms, and
# "SBI" and "ITC" carry the same hazard. Longest-key-first ordering does not
# help when the short key is the only one that matches at all.
#
# Short keys therefore have to earn the match: either the name *begins* with
# them, or they appear as a whole word. Both are needed — the first catches
# "METAPlatforms" where OCR dropped the space, the second "Meta Platforms Inc"
# where it did not, and neither accepts "Metal".
_SHORT_KEY = 5
_WORD_CACHE: Dict[str, "re.Pattern[str]"] = {}


def _short_key_matches(key: str, squashed: str, text: str) -> bool:
    if squashed.startswith(key):
        return True
    pattern = _WORD_CACHE.get(key)
    if pattern is None:
        pattern = _WORD_CACHE[key] = re.compile(rf"\b{re.escape(key)}\b")
    return bool(pattern.search(text))

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
    "YATHARTHHO": "YATHARTH",
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
    "GROWWPOWER", "GROWWGOLD", "GROWWNIFTY", "GROWWMOM50", "CEMNTGROWW",
    "GROWWEV", "GROWWDEFNC", "GROWWNET", "GROWWRAIL", "GROWWMETAL",
    "PVTBKGROWW", "GROWWSC250", "GROWWSLVR",
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

    def match(text: str) -> str:
        squashed = _SQUASH.sub("", text)
        for key, symbol in _SQUASHED_NAME_KEYS:
            if len(key) <= _SHORT_KEY:
                if _short_key_matches(key, squashed, text):
                    return symbol
            elif key in squashed:
                return symbol
        return ""

    found = match(cleaned)
    if found:
        return found

    # Retry without corporate-suffix noise ("APPLE INC" -> "APPLE").
    stripped = _NOISE_WORDS.sub("", cleaned).strip()
    found = match(stripped)
    if found:
        return found

    slug = _SQUASH.sub("", stripped)
    return slug[:10] if slug else "STOCK"
