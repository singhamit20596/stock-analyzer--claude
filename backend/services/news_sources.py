"""Headlines for a stock, from sources that need no API key.

Google News RSS is the whole backbone: it answers for both NSE and US names,
carries a source and a timestamp, and costs nothing. Nasdaq's news endpoint
returns non-JSON to this IP and screener.in does not serve its announcements
block in the HTML, so neither is used.

RSS gives headlines, not judgement. The scoring here is keyword matching — good
enough to push results, regulatory action and rating changes above the noise,
and to drop pure price commentary — but it cannot explain *why* an item matters.
That is what the model layer in `news_engine` adds when a key is available.
"""
import re
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Dict, List, Optional, Tuple

import httpx

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
}
TIMEOUT = 15.0
MAX_WORKERS = 8

# Edition matters: an Indian stock searched on the US edition returns very
# little, and vice versa.
EDITIONS = {
    "IND": "hl=en-IN&gl=IN&ceid=IN:en",
    "US": "hl=en-US&gl=US&ceid=US:en",
}

# Things a shareholder would act on or watch closely.
HIGH_SIGNALS = [
    (r"\b(q[1-4]|quarterly|annual)\s+(results?|earnings?)|\bresults?\s+(beat|miss)|"
     r"\bearnings?\b|\bprofit\s+(jump|surge|fall|drop|decline|rise)", "results"),
    (r"\b(sebi|rbi|cci|sec|ftc|doj|irdai|nclt)\b|\bregulator|\bprobe\b|\binvestigat|"
     r"\blawsuit\b|\bpenalty\b|\bfine[sd]?\b|\braid\b|\bshow[- ]cause\b", "regulatory"),
    (r"\b(downgrade[sd]?|upgrade[sd]?|target price|price target|rating)\b|"
     r"\b(buy|sell|hold|overweight|underweight)\s+rating\b", "rating"),
    (r"\b(acquisition|acquires?|merger|merges?|takeover|stake sale|divest|demerger)\b", "M&A"),
    (r"\b(order win|bags? order|wins? contract|contract win|awarded|bags? deal)\b", "contract"),
    (r"\b(qip|fund ?rais|preferential issue|rights issue|dilution|block deal|"
     r"bulk deal|buyback|stake (buy|purchase))\b", "capital"),
    (r"\b(resign|steps? down|appoints?|new (ceo|cfo|md|chairman)|管理)\b|"
     r"\b(ceo|cfo|md|chairman)\s+(resign|exit|quit)", "management"),
    (r"\b(guidance|outlook)\s+(cut|rais|lower|hike)|\bwarns?\b|\bprofit warning\b", "guidance"),
    (r"\b(promoter|insider)\s+(sell|buy|stake|pledge)", "insider"),
    (r"\bdividend\b|\bbonus issue\b|\bstock split\b", "payout"),
]

# Price commentary that merely restates the chart, listicle filler, and the
# automated 13F churn ("X Purchases 27,545 Shares of NVIDIA") that floods a US
# ticker search and tells a retail holder nothing.
NOISE = re.compile(
    r"stocks? to (watch|buy)|top \d+ stocks?|best stocks?|"
    r"\bshares? (fall|rise|gain|drop|slip|jump|climb|decline|surge)\s+[\d.]+%|"
    r"\b(nifty|sensex) (gainers?|losers?)|among (top )?(gainers?|losers?)|"
    r"why is .* (climbing|falling|rising) today|"
    r"\bmarket (wrap|roundup|close|today)\b|\blive updates?\b|"
    r"\bmuhurat\b|\bhoroscope\b|\bbuy,? sell,? or hold\b|"
    # 13F churn, in every phrasing marketbeat and friends emit.
    r"\b(purchases?|sold|buys?|acquires?|sells?|boosts?|trims?|lowers?|raises?)\s+"
    r"[\d,]+\s+shares\b|\bshares? (sold|bought|purchased) by\b|"
    r"\b(boosts?|raises?|trims?|lowers?|cuts?|increases?|reduces?|takes?|acquires?|"
    r"buys?|sells?|grows?|has|holds?)\s+(its\s+)?(new\s+)?(stock\s+)?"
    r"(holdings?|position|stake|shares?)\s+(in|of)\b|"
    r"\b13f\b|\bshares? of\b.*\b(purchased|acquired|sold) by\b|"
    r"\binvests?\s+\$[\d.]+\s+(million|billion)\s+in\b",
    re.I,
)

# Words too generic to prove a headline is about the right company.
_GENERIC = {
    "LIMITED", "LTD", "INC", "CORP", "CORPORATION", "COMPANY", "PLC", "GROUP",
    "HOLDINGS", "HOLDING", "INDIA", "INDIAN", "THE", "AND", "SERVICES",
    "INDUSTRIES", "ENTERPRISES", "INTERNATIONAL", "GLOBAL", "COMMON", "STOCK",
}


def _edition(country: str) -> str:
    return EDITIONS.get((country or "IND").upper(), EDITIONS["IND"])


def _clean_name(company_name: str) -> str:
    """OCR leaves truncation marks behind, and they poison a search."""
    name = re.sub(r"\.{2,}|…", " ", company_name or "")
    return re.sub(r"\s+", " ", name).strip()


def _identifiers(symbol: str, company_name: str) -> List[str]:
    """Words whose presence proves a headline is about this company.

    Google News treats a quoted phrase as a hint, not a filter, so a search for
    HDFC Bank happily returns Shriram Properties and sugar stocks. Every
    headline is therefore checked for one of these before it is kept.
    """
    tokens = [t for t in re.split(r"[^A-Za-z0-9]+", _clean_name(company_name)) if t]
    distinctive = [t for t in tokens if len(t) >= 4 and t.upper() not in _GENERIC]
    return distinctive or [symbol]


def _is_about(headline: str, identifiers: List[str]) -> bool:
    upper = (headline or "").upper()
    return any(word.upper() in upper for word in identifiers)


def _query(symbol: str, company_name: str, country: str) -> str:
    """The search phrase. The company name beats the ticker — "MEDANTA" alone
    finds a hospital chain's marketing, while the registered name finds what
    moved the stock. Extra words like "news" only dilute the match."""
    name = _clean_name(company_name)
    base = name if len(name) >= 4 else symbol
    return f'"{base}" share price' if (country or "IND").upper() == "IND" else f'"{base}" stock'


def _parse_pubdate(text: str) -> Optional[datetime]:
    try:
        parsed = parsedate_to_datetime(text)
    except (TypeError, ValueError):
        return None
    if parsed and parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def score(title: str) -> Tuple[str, List[str]]:
    """Keyword materiality for a headline: (level, matched signals)."""
    if NOISE.search(title or ""):
        return "low", []
    hits = [label for pattern, label in HIGH_SIGNALS
            if re.search(pattern, title or "", re.I)]
    if not hits:
        return "medium", []
    return "high", sorted(set(hits))


def fetch_headlines(symbol: str, company_name: str, country: str,
                    window_days: int = 14, limit: int = 8) -> List[Dict[str, Any]]:
    """Recent headlines for one stock, newest first, noise dropped."""
    url = (f"https://news.google.com/rss/search?q="
           f"{httpx.QueryParams({'q': _query(symbol, company_name, country)})['q']}"
           f"&{_edition(country)}")
    try:
        response = httpx.get(url, headers=BROWSER_HEADERS, timeout=TIMEOUT,
                             follow_redirects=True)
        if response.status_code != 200:
            return []
        root = ET.fromstring(response.content)
    except Exception:
        return []

    cutoff = datetime.now(timezone.utc) - timedelta(days=window_days)
    identifiers = _identifiers(symbol, company_name)
    items: List[Dict[str, Any]] = []

    for node in root.iterfind(".//item"):
        title = (node.findtext("title") or "").strip()
        if not title:
            continue
        # Google returns near-misses freely, so the company has to be named.
        if not _is_about(title, identifiers):
            continue
        published = _parse_pubdate(node.findtext("pubDate") or "")
        if published and published < cutoff:
            continue

        level, signals = score(title)
        # Pure price commentary is dropped outright rather than ranked last:
        # it is the exact thing this section is meant not to be.
        if level == "low" and not signals:
            continue

        source = node.findtext("{http://news.google.com/rss}source") or ""
        if not source:
            node_source = node.find("source")
            source = (node_source.text or "") if node_source is not None else ""

        items.append({
            "symbol": symbol.strip().upper(),
            "headline": title,
            "url": (node.findtext("link") or "").strip(),
            "source": source.strip(),
            "published": published.date().isoformat() if published else "",
            "published_at": published.isoformat() if published else "",
            "keyword_level": level,
            "signals": signals,
        })

    items.sort(key=lambda i: (i["keyword_level"] != "high", i["published_at"]), reverse=False)
    items.sort(key=lambda i: i["published_at"], reverse=True)
    return items[:limit]


def fetch_for_holdings(holdings: List[Dict[str, Any]], window_days: int = 14,
                       per_stock: int = 6) -> Dict[str, List[Dict[str, Any]]]:
    """Headlines for every holding, fetched in parallel, keyed by symbol."""
    if not holdings:
        return {}

    def one(holding: Dict[str, Any]):
        return holding["symbol"], fetch_headlines(
            holding["symbol"], holding.get("company_name", ""),
            holding.get("country", "IND"), window_days, per_stock)

    out: Dict[str, List[Dict[str, Any]]] = {}
    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(holdings))) as pool:
        for future in [pool.submit(one, h) for h in holdings]:
            try:
                symbol, items = future.result()
            except Exception:
                continue
            if items:
                out[symbol] = items
    return out


def rank_without_model(by_symbol: Dict[str, List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """Flatten to one ranked list using keywords alone.

    Used when no model key is configured. Each item carries the signals that
    got it promoted instead of an explanation, so the reader can see *why it
    was surfaced* even though nothing has interpreted it.
    """
    items: List[Dict[str, Any]] = []
    for entries in by_symbol.values():
        for entry in entries:
            item = dict(entry)
            item["materiality"] = entry["keyword_level"]
            item["direction"] = "unclear"
            item["impact"] = (
                "Flagged on: " + ", ".join(entry["signals"])
                if entry["signals"] else
                "Mentions this holding. Nothing has assessed how it bears on the "
                "share price — add a Gemini key for that."
            )
            item["summary"] = ""
            items.append(item)

    order = {"high": 0, "medium": 1, "low": 2}
    items.sort(key=lambda i: (order.get(i["materiality"], 1), i["published_at"] and -1))
    return items
