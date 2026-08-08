"""Market data for one instrument, for the stock deep-dive page.

Yahoo is not used anywhere here: it rate-limits this IP to 429 on every
endpoint, which is why `history_source` already avoids it. Each market is read
from the provider that serves it without an API key:

  * IND candles      -> Groww charting
  * IND fundamentals -> screener.in (HTML) + tickertape (company info)
  * US  candles      -> Nasdaq historical
  * US  fundamentals -> Nasdaq summary + financials

Nothing here decides anything. The page shows indicators as inputs and hands
off to the assistant, so there is deliberately no buy/hold/sell verdict and no
scoring — see CLAUDE.md.

Every fetch degrades to None rather than raising, so one provider going down
costs the page a section instead of the whole response.
"""
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from html import unescape
from typing import Any, Dict, List, Optional, Tuple

import httpx

from services.symbols import is_etf, resolve_quote_symbol

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
}
NASDAQ_HEADERS = {**BROWSER_HEADERS, "Referer": "https://www.nasdaq.com/"}
HTML_HEADERS = {**BROWSER_HEADERS, "Accept": "text/html,application/xhtml+xml"}

TIMEOUT = 20.0

# Groww stamps a daily candle at 00:00 IST, which is 18:30 UTC the *previous*
# day. Reading it as UTC shifts every session back one day and makes Monday
# look like Sunday, so the session date must be taken in IST.
IST = timezone(timedelta(hours=5, minutes=30))

# 1D/5D would need intraday data these daily endpoints do not serve, and Groww's
# window does not reach 10Y reliably, so the range stops at 5Y.
RANGES: Dict[str, int] = {"1M": 31, "6M": 186, "1Y": 366, "3Y": 1096, "5Y": 1827}
DEFAULT_RANGE = "1Y"
MAX_RANGE_DAYS = RANGES["5Y"]

# Daily candles change once a day; fundamentals change quarterly at most.
CANDLE_TTL = 6 * 3600
FUNDAMENTAL_TTL = 12 * 3600

_CACHE: Dict[Tuple, Any] = {}
_CACHE_AT: Dict[Tuple, float] = {}


def _cached(key: Tuple, ttl: float):
    stamped = _CACHE_AT.get(key)
    if stamped and (time.time() - stamped) < ttl:
        return _CACHE.get(key)
    return None


def _store(key: Tuple, value):
    if value:
        _CACHE[key] = value
        _CACHE_AT[key] = time.time()
    return value


# ── parsing helpers ──────────────────────────────────────────────────────────

def _num(text: Any) -> Optional[float]:
    """First number in *text*, ignoring currency symbols, commas and units.

    Indian digit grouping ("11,34,131") survives this because every comma is
    dropped rather than assumed to be a thousands separator.
    """
    if text is None:
        return None
    if isinstance(text, (int, float)):
        return float(text)
    cleaned = str(text).replace(",", "").replace("\xa0", " ")
    match = re.search(r"-?\d+(?:\.\d+)?", cleaned)
    if not match:
        return None
    try:
        value = float(match.group(0))
    except ValueError:
        return None
    # A leading minus sits outside the match when the source writes "-$1,234".
    if re.match(r"^\s*-\s*[^\d-]*" + re.escape(match.group(0)), cleaned):
        value = -abs(value)
    return value


def _strip_tags(markup: str) -> str:
    """Visible text of an HTML fragment.

    Entities have to be decoded, not just stripped: screener writes its row
    labels as "Sales&nbsp;+", so matching against the literal markup silently
    misses the revenue and net-profit rows.
    """
    text = unescape(re.sub(r"<[^>]+>", " ", markup))
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


def _round(value: Optional[float], digits: int = 2) -> Optional[float]:
    return None if value is None else round(value, digits)


def _div(a: Optional[float], b: Optional[float]) -> Optional[float]:
    if a is None or not b:
        return None
    return a / b


# ── candles ──────────────────────────────────────────────────────────────────

def _groww_ohlcv(symbol: str) -> List[Dict[str, Any]]:
    """Daily OHLCV for an NSE symbol, oldest first."""
    key = ("groww_ohlcv", symbol)
    hit = _cached(key, CANDLE_TTL)
    if hit is not None:
        return hit

    now_ms = int(time.time() * 1000)
    start_ms = now_ms - MAX_RANGE_DAYS * 24 * 3600 * 1000
    url = (f"https://groww.in/v1/api/charting_service/v1/chart/exchange/NSE"
           f"/segment/CASH/{symbol}"
           f"?intervalInMinutes=1440&startTimeInMillis={start_ms}&endTimeInMillis={now_ms}")
    try:
        response = httpx.get(url, headers=BROWSER_HEADERS, timeout=TIMEOUT)
        if response.status_code != 200:
            return []
        candles = []
        for row in response.json().get("candles") or []:
            # [epoch_seconds, open, high, low, close, volume]
            if len(row) < 5 or not row[4]:
                continue
            candles.append({
                "time": datetime.fromtimestamp(row[0], tz=IST).strftime("%Y-%m-%d"),
                "open": float(row[1]),
                "high": float(row[2]),
                "low": float(row[3]),
                "close": float(row[4]),
                "volume": float(row[5]) if len(row) > 5 and row[5] else 0.0,
            })
        candles.sort(key=lambda c: c["time"])
        return _store(key, candles)
    except Exception:
        return []


def _nasdaq_ohlcv(symbol: str, asset_class: str = "") -> List[Dict[str, Any]]:
    """Daily OHLCV from Nasdaq, oldest first."""
    key = ("nasdaq_ohlcv", symbol, asset_class)
    hit = _cached(key, CANDLE_TTL)
    if hit is not None:
        return hit

    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=MAX_RANGE_DAYS)
    for cls in ([asset_class] if asset_class else ["stocks", "etf"]):
        url = (f"https://api.nasdaq.com/api/quote/{symbol}/historical"
               f"?assetclass={cls}&fromdate={start}&todate={today}&limit=9999")
        try:
            response = httpx.get(url, headers=NASDAQ_HEADERS, timeout=TIMEOUT)
            if response.status_code != 200:
                continue
            rows = (((response.json().get("data") or {}).get("tradesTable") or {})
                    .get("rows")) or []
            candles = []
            for row in rows:
                close = _num(row.get("close"))
                if not close:
                    continue
                try:
                    day = datetime.strptime(row["date"], "%m/%d/%Y").strftime("%Y-%m-%d")
                except (KeyError, ValueError):
                    continue
                candles.append({
                    "time": day,
                    "open": _num(row.get("open")) or close,
                    "high": _num(row.get("high")) or close,
                    "low": _num(row.get("low")) or close,
                    "close": close,
                    "volume": _num(row.get("volume")) or 0.0,
                })
            if candles:
                candles.sort(key=lambda c: c["time"])
                return _store(key, candles)
        except Exception:
            continue
    return []


def fetch_candles(symbol: str, country: str) -> List[Dict[str, Any]]:
    """Full 5Y daily OHLCV. Ranges are slices of this, so switching a range
    pill re-reads the cache instead of the provider."""
    resolved = resolve_quote_symbol(symbol)
    if country.upper() == "US":
        return _nasdaq_ohlcv(resolved, "etf" if is_etf(resolved) else "")
    return _groww_ohlcv(resolved)


def slice_range(candles: List[Dict[str, Any]], range_key: str) -> Dict[str, Any]:
    """The candles inside *range_key*, with that window's change."""
    days = RANGES.get(range_key.upper(), RANGES[DEFAULT_RANGE])
    if not candles:
        return {"range": range_key, "candles": [], "change_percent": None,
                "change_absolute": None}

    cutoff = (datetime.now(timezone.utc).date() - timedelta(days=days)).isoformat()
    window = [c for c in candles if c["time"] >= cutoff] or candles[-2:]

    first_close = window[0]["close"]
    last_close = window[-1]["close"]
    change = last_close - first_close
    return {
        "range": range_key,
        "candles": window,
        "change_absolute": _round(change),
        "change_percent": _round(change / first_close * 100) if first_close else None,
        "period_high": _round(max(c["high"] for c in window)),
        "period_low": _round(min(c["low"] for c in window)),
    }


# ── technical indicators ─────────────────────────────────────────────────────

def _sma(closes: List[float], period: int) -> Optional[float]:
    if len(closes) < period:
        return None
    return sum(closes[-period:]) / period


def _ema_series(values: List[float], period: int) -> List[float]:
    if not values:
        return []
    k = 2.0 / (period + 1)
    out = [values[0]]
    for value in values[1:]:
        out.append(value * k + out[-1] * (1 - k))
    return out


def _rsi(closes: List[float], period: int = 14) -> Optional[float]:
    """Wilder's RSI over the most recent *period* sessions."""
    if len(closes) < period + 1:
        return None
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = [max(d, 0.0) for d in deltas]
    losses = [abs(min(d, 0.0)) for d in deltas]

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(deltas)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period

    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def _macd(closes: List[float]) -> Dict[str, Optional[float]]:
    if len(closes) < 35:
        return {"macd": None, "signal": None, "histogram": None}
    fast = _ema_series(closes, 12)
    slow = _ema_series(closes, 26)
    line = [f - s for f, s in zip(fast, slow)]
    signal = _ema_series(line, 9)
    return {
        "macd": _round(line[-1], 3),
        "signal": _round(signal[-1], 3),
        "histogram": _round(line[-1] - signal[-1], 3),
    }


def _support_resistance(candles: List[Dict[str, Any]], lookback: int = 120):
    """Nearest swing low below and swing high above the last close.

    A swing point is a session whose low (or high) is the extreme of a 5-day
    window centred on it — a plain min/max would just restate the period range.
    """
    window = candles[-lookback:]
    if len(window) < 11:
        return {"support": None, "resistance": None,
                "recent_low": None, "recent_high": None}

    last = window[-1]["close"]
    supports, resistances = [], []
    for i in range(2, len(window) - 2):
        lows = [window[j]["low"] for j in range(i - 2, i + 3)]
        highs = [window[j]["high"] for j in range(i - 2, i + 3)]
        if window[i]["low"] == min(lows) and window[i]["low"] < last:
            supports.append(window[i]["low"])
        if window[i]["high"] == max(highs) and window[i]["high"] > last:
            resistances.append(window[i]["high"])

    return {
        "support": _round(max(supports)) if supports else None,
        "resistance": _round(min(resistances)) if resistances else None,
        "recent_low": _round(min(c["low"] for c in window)),
        "recent_high": _round(max(c["high"] for c in window)),
        "lookback_sessions": len(window),
    }


def compute_technicals(candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    closes = [c["close"] for c in candles]
    if not closes:
        return {}
    last = closes[-1]
    sma_20, sma_50, sma_200 = _sma(closes, 20), _sma(closes, 50), _sma(closes, 200)
    return {
        "rsi_14": _round(_rsi(closes)),
        "macd": _macd(closes),
        "sma_20": _round(sma_20),
        "sma_50": _round(sma_50),
        "sma_200": _round(sma_200),
        # Distance from each average, so the reader can see where price sits
        # without the page drawing a conclusion from it.
        "price_vs_sma_20": _round((last / sma_20 - 1) * 100) if sma_20 else None,
        "price_vs_sma_50": _round((last / sma_50 - 1) * 100) if sma_50 else None,
        "price_vs_sma_200": _round((last / sma_200 - 1) * 100) if sma_200 else None,
        "levels": _support_resistance(candles),
        "sessions_used": len(closes),
    }


# ── India: screener.in + tickertape ──────────────────────────────────────────

def _screener_page(symbol: str) -> str:
    key = ("screener", symbol)
    hit = _cached(key, FUNDAMENTAL_TTL)
    if hit is not None:
        return hit
    for path in (f"https://www.screener.in/company/{symbol}/",
                 f"https://www.screener.in/company/{symbol}/consolidated/"):
        try:
            response = httpx.get(path, headers=HTML_HEADERS, timeout=TIMEOUT,
                                 follow_redirects=True)
            if response.status_code == 200 and "top-ratios" in response.text:
                return _store(key, response.text)
        except Exception:
            continue
    return ""


def _screener_ratios(html: str) -> Dict[str, Any]:
    """The `<ul id="top-ratios">` block.

    The value span is `class="nowrap value"` — matching on `class="value"`
    alone finds nothing. Each number sits in its own `<span class="number">`,
    and "High / Low" carries two of them, so every number in the item is taken
    rather than just the first.
    """
    block = re.search(r'<ul[^>]*id="top-ratios"[^>]*>(.*?)</ul>', html, re.S)
    if not block:
        return {}

    found: Dict[str, List[float]] = {}
    for item in re.findall(r"<li[^>]*>(.*?)</li>", block.group(1), re.S):
        name = re.search(r'class="name"[^>]*>(.*?)</span>', item, re.S)
        if not name:
            continue
        label = _strip_tags(name.group(1)).rstrip(":").strip()
        numbers = [_num(n) for n in re.findall(r'class="number"[^>]*>([^<]*)<', item)]
        numbers = [n for n in numbers if n is not None]
        if numbers:
            found[label] = numbers

    def one(label: str) -> Optional[float]:
        values = found.get(label)
        return values[0] if values else None

    high_low = found.get("High / Low") or []
    price = one("Current Price")
    book_value = one("Book Value")

    return {
        "market_cap": one("Market Cap"),          # ₹ crore
        "market_cap_unit": "crore",
        "current_price": price,
        "pe": one("Stock P/E"),
        "book_value": book_value,
        "pb": _round(_div(price, book_value)),    # screener does not publish P/B
        "dividend_yield": one("Dividend Yield"),
        "roce": one("ROCE"),
        "roe": one("ROE"),
        "face_value": one("Face Value"),
        "week52_high": high_low[0] if len(high_low) > 0 else None,
        "week52_low": high_low[1] if len(high_low) > 1 else None,
    }


# Screener labels the top line "Sales" for most companies but "Revenue" for
# lenders, and the operating line changes name to match.
_QUARTER_ROWS = {
    "revenue": ("Sales", "Revenue"),
    "operating_profit": ("Operating Profit", "Financing Profit"),
    "net_profit": ("Net Profit",),
    "eps": ("EPS in Rs",),
}


def _screener_quarters(html: str) -> Dict[str, Any]:
    """`<section id="quarters">` as columns plus one series per tracked row."""
    section = re.search(r'<section[^>]*id="quarters".*?</section>', html, re.S)
    if not section:
        return {}
    table = re.search(r"<table.*?</table>", section.group(0), re.S)
    if not table:
        return {}

    head = re.search(r"<thead.*?</thead>", table.group(0), re.S)
    columns = [_strip_tags(c) for c in
               re.findall(r"<th[^>]*>(.*?)</th>", head.group(0), re.S)] if head else []
    columns = [c for c in columns[1:] if c]

    body = re.search(r"<tbody.*?</tbody>", table.group(0), re.S)
    if not body or not columns:
        return {}

    raw: Dict[str, List[Optional[float]]] = {}
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", body.group(0), re.S):
        cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)
        if not cells:
            continue
        label = _strip_tags(cells[0]).replace("+", "").strip()
        raw[label] = [_num(_strip_tags(c)) for c in cells[1:]]

    series: Dict[str, List[Optional[float]]] = {}
    for field, labels in _QUARTER_ROWS.items():
        for label in labels:
            if label in raw:
                series[field] = raw[label]
                break

    if not series:
        return {}
    return {"columns": columns, "series": series}


def _tickertape_info(symbol: str) -> Dict[str, Any]:
    """Company description and sub-sector. `sid` comes from the search endpoint."""
    key = ("tickertape", symbol)
    hit = _cached(key, FUNDAMENTAL_TTL)
    if hit is not None:
        return hit
    try:
        found = httpx.get(f"https://api.tickertape.in/search?text={symbol}&types=stock",
                          headers=BROWSER_HEADERS, timeout=TIMEOUT)
        if found.status_code != 200:
            return {}
        stocks = (found.json().get("data") or {}).get("stocks") or []
        # Only an exact ticker will do. The search is fuzzy and happily answers
        # MEDANTA with Vedanta Ltd, so taking the first hit puts another
        # company's name and description on the page.
        match = next((s for s in stocks
                      if (s.get("ticker") or "").upper() == symbol.upper()), None)
        if not match or not match.get("sid"):
            return {}

        detail = httpx.get(f"https://api.tickertape.in/stocks/info/{match['sid']}",
                           headers=BROWSER_HEADERS, timeout=TIMEOUT)
        info = ((detail.json().get("data") or {}).get("info") or {}
                if detail.status_code == 200 else {})
        return _store(key, {
            "name": info.get("name") or match.get("name"),
            "description": info.get("description"),
            "industry": info.get("sector"),      # tickertape's "sector" is the sub-sector
            "exchange": info.get("exchange"),
        })
    except Exception:
        return {}


# ── US: Nasdaq ───────────────────────────────────────────────────────────────

def _nasdaq_summary(symbol: str, asset_class: str) -> Dict[str, Any]:
    key = ("nasdaq_summary", symbol, asset_class)
    hit = _cached(key, FUNDAMENTAL_TTL)
    if hit is not None:
        return hit
    try:
        response = httpx.get(
            f"https://api.nasdaq.com/api/quote/{symbol}/summary?assetclass={asset_class}",
            headers=NASDAQ_HEADERS, timeout=TIMEOUT)
        if response.status_code != 200:
            return {}
        data = (response.json().get("data") or {}).get("summaryData") or {}
        return _store(key, {k: (v.get("value") if isinstance(v, dict) else v)
                            for k, v in data.items()})
    except Exception:
        return {}


def _nasdaq_info(symbol: str, asset_class: str) -> Dict[str, Any]:
    """The registered company name. The summary endpoint does not carry one, so
    without this the page falls back to whatever the OCR import stored."""
    key = ("nasdaq_info", symbol, asset_class)
    hit = _cached(key, FUNDAMENTAL_TTL)
    if hit is not None:
        return hit
    try:
        response = httpx.get(
            f"https://api.nasdaq.com/api/quote/{symbol}/info?assetclass={asset_class}",
            headers=NASDAQ_HEADERS, timeout=TIMEOUT)
        if response.status_code != 200:
            return {}
        data = response.json().get("data") or {}
        return _store(key, {"name": _clean_company_name(data.get("companyName")),
                            "exchange": data.get("exchange")})
    except Exception:
        return {}


# Nasdaq suffixes the security type onto the company name ("NVIDIA Corporation
# Common Stock"). The share class is dropped with it only when it carries no
# information — "Class A" stays, because it distinguishes GOOG from GOOGL.
_SECURITY_TYPE = re.compile(
    r"\s+(Common Stock|Common Shares|Ordinary Shares|"
    r"American Depositary Shares?)\s*$", re.I)


def _clean_company_name(name: Optional[str]) -> Optional[str]:
    if not name:
        return None
    return _SECURITY_TYPE.sub("", name).strip() or name


def _nasdaq_financials(symbol: str, frequency: int) -> Dict[str, Any]:
    """frequency 1 = annual, 2 = quarterly. Returns {} for funds, which the
    provider reports as a 200 with a null body rather than a 404."""
    key = ("nasdaq_fin", symbol, frequency)
    hit = _cached(key, FUNDAMENTAL_TTL)
    if hit is not None:
        return hit
    try:
        response = httpx.get(
            f"https://api.nasdaq.com/api/company/{symbol}/financials?frequency={frequency}",
            headers=NASDAQ_HEADERS, timeout=TIMEOUT)
        if response.status_code != 200:
            return {}
        return _store(key, response.json().get("data") or {})
    except Exception:
        return {}


def _table_row(table: Dict[str, Any], label: str, column: str = "value2") -> Optional[float]:
    for row in (table or {}).get("rows") or []:
        if (row.get("value1") or "").strip().lower() == label.lower():
            return _num(row.get(column))
    return None


# Nasdaq reports every statement line in thousands while market cap is an
# absolute figure, so the two have to be put on the same footing before they can
# be divided — otherwise P/E comes out 1000x too high.
STATEMENT_SCALE = 1000.0


def _us_ratios(summary: Dict[str, Any], annual: Dict[str, Any],
               price: Optional[float]) -> Dict[str, Any]:
    """Nasdaq publishes market cap, yield and the 52-week range directly; P/E,
    P/B, book value and ROCE are derived from the statements."""
    income = annual.get("incomeStatementTable") or {}
    balance = annual.get("balanceSheetTable") or {}
    ratios = annual.get("financialRatiosTable") or {}

    def absolute(label: str, table: Dict[str, Any]) -> Optional[float]:
        value = _table_row(table, label)
        return None if value is None else value * STATEMENT_SCALE

    market_cap = _num(summary.get("MarketCap"))
    net_income = absolute("Net Income", income)
    total_equity = absolute("Total Equity", balance)
    # ROCE divides two statement lines, so the scale cancels and is left off.
    ebit = _table_row(income, "Earnings Before Interest and Tax")
    total_assets = _table_row(balance, "Total Assets")
    current_liabilities = _table_row(balance, "Total Current Liabilities")

    shares = _div(market_cap, price)
    capital_employed = (total_assets - current_liabilities
                        if total_assets is not None and current_liabilities is not None
                        else None)

    week52 = str(summary.get("FiftTwoWeekHighLow") or "")
    high_low = [_num(part) for part in week52.split("/")] if "/" in week52 else []

    return {
        "market_cap": market_cap,
        "market_cap_unit": "absolute",
        "current_price": price,
        "pe": _round(_div(market_cap, net_income)),
        "pb": _round(_div(market_cap, total_equity)),
        "book_value": _round(_div(total_equity, shares)),
        "dividend_yield": _num(summary.get("Yield")),
        "roe": _round(_table_row(ratios, "After Tax ROE")),
        "roce": _round(_div(ebit, capital_employed) * 100) if _div(ebit, capital_employed) else None,
        "week52_high": high_low[0] if len(high_low) > 0 else None,
        "week52_low": high_low[1] if len(high_low) > 1 else None,
        "analyst_target": _num(summary.get("OneYrTarget")),
    }


_US_QUARTER_ROWS = {
    "revenue": "Total Revenue",
    "gross_profit": "Gross Profit",
    "operating_profit": "Operating Income",
    "net_profit": "Net Income",
}


def _us_quarters(quarterly: Dict[str, Any]) -> Dict[str, Any]:
    """Nasdaq serves exactly four quarters, so there is no year-ago column to
    compare against — the caller reports quarter-on-quarter growth instead."""
    income = quarterly.get("incomeStatementTable") or {}
    headers = income.get("headers") or {}
    if not income.get("rows"):
        return {}

    # Columns run newest-first; the rest of the page reads oldest-first.
    keys = [k for k in ("value5", "value4", "value3", "value2") if headers.get(k)]
    columns = [headers[k] for k in keys]

    series: Dict[str, List[Optional[float]]] = {}
    for field, label in _US_QUARTER_ROWS.items():
        values = [_table_row(income, label, k) for k in keys]
        if any(v is not None for v in values):
            series[field] = values

    if not series:
        return {}
    return {"columns": columns, "series": series}


# ── quarterly assembly ───────────────────────────────────────────────────────

def _growth(values: List[Optional[float]], lag: int) -> List[Optional[float]]:
    """Percent change against the value *lag* columns earlier.

    A loss-making base quarter is reported as no growth rather than a number:
    a swing from -438 to 12,287 is arithmetically +2905%, which reads as
    spectacular growth when it only means the sign changed.
    """
    out: List[Optional[float]] = []
    for i, value in enumerate(values):
        previous = values[i - lag] if i >= lag else None
        if value is None or previous is None or previous <= 0:
            out.append(None)
        else:
            out.append(_round((value - previous) / previous * 100))
    return out


def _build_quarters(parsed: Dict[str, Any], max_columns: int = 8) -> Optional[Dict[str, Any]]:
    """Trim to the most recent *max_columns* quarters, keeping growth that was
    computed against columns that are about to be dropped."""
    if not parsed or not parsed.get("columns"):
        return None

    columns = parsed["columns"]
    series = parsed["series"]
    # Four quarters back is a year; without that many columns only the
    # neighbouring quarter is available to compare against.
    lag = 4 if len(columns) > 4 else 1

    rows = []
    for field, values in series.items():
        padded = values + [None] * (len(columns) - len(values))
        rows.append({
            "key": field,
            "values": padded[-max_columns:],
            "growth": _growth(padded, lag)[-max_columns:],
        })

    return {
        "columns": columns[-max_columns:],
        "rows": rows,
        "growth_basis": "yoy" if lag == 4 else "qoq",
    }


# ── assembly ─────────────────────────────────────────────────────────────────

def get_stock_detail(symbol: str, country: str = "IND") -> Dict[str, Any]:
    """Everything the deep-dive page shows about the instrument itself.

    The caller adds the user's own position; this function knows nothing about
    holdings.
    """
    country = (country or "IND").upper()
    resolved = resolve_quote_symbol(symbol)
    etf = is_etf(resolved)
    warnings: List[str] = []

    # Candles and fundamentals are independent providers, so they overlap.
    with ThreadPoolExecutor(max_workers=2) as pool:
        candle_job = pool.submit(fetch_candles, symbol, country)
        fundamental_job = pool.submit(
            _us_fundamentals if country == "US" else _ind_fundamentals, resolved, etf)
        candles = candle_job.result()
        fundamentals = fundamental_job.result()

    if not candles:
        warnings.append(
            f"No price history available for {resolved} from "
            f"{'Nasdaq' if country == 'US' else 'Groww'}.")

    ratios = fundamentals.get("ratios") or {}
    price = candles[-1]["close"] if candles else ratios.get("current_price")

    # The US ratios need the last close to turn market cap into per-share
    # figures, so they are finished here rather than in the fetcher.
    if country == "US" and not etf:
        ratios = _us_ratios(fundamentals.get("summary") or {},
                            fundamentals.get("annual") or {}, price)

    previous_close = candles[-2]["close"] if len(candles) > 1 else None
    quarters = None if etf else _build_quarters(fundamentals.get("quarters") or {})

    etf_facts = None
    if etf:
        # Indian funds have no provider metadata at all — screener serves a
        # blank company page and Groww only serves candles — so the traded
        # facts are derived from the price history to keep the reduced variant
        # from being empty.
        etf_facts = {**_candle_facts(candles), **(fundamentals.get("etf_facts") or {})}

    if not etf and quarters is None and candles:
        warnings.append("Quarterly results were not available from the provider.")

    return {
        "symbol": resolved,
        "requested_symbol": symbol.upper(),
        "country": country,
        "currency": "USD" if country == "US" else "INR",
        "is_etf": etf,
        "company": fundamentals.get("company") or {},
        "price": {
            "current": _round(price),
            "previous_close": _round(previous_close),
            "change": _round(price - previous_close) if price and previous_close else None,
            "change_percent": (_round((price / previous_close - 1) * 100)
                               if price and previous_close else None),
            "as_of": candles[-1]["time"] if candles else None,
        },
        "chart": slice_range(candles, DEFAULT_RANGE),
        "ratios": ratios,
        "etf_facts": etf_facts,
        "quarterly": quarters,
        "technicals": compute_technicals(candles),
        "sources": fundamentals.get("sources") or [],
        "warnings": warnings,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


def _candle_facts(candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    """52-week range and average volume, read off the price history."""
    year = candles[-252:]
    if not year:
        return {}
    return {
        "week52_high": _round(max(c["high"] for c in year)),
        "week52_low": _round(min(c["low"] for c in year)),
        "average_volume": _round(sum(c["volume"] for c in year[-50:]) / min(50, len(year)), 0),
    }


def _ind_fundamentals(symbol: str, etf: bool) -> Dict[str, Any]:
    if etf:
        # screener serves a company page for a fund with every ratio blank, so
        # there is nothing to scrape and nothing worth showing.
        return {"sources": ["Groww"], "company": {}, "ratios": {}, "etf_facts": {}}

    with ThreadPoolExecutor(max_workers=2) as pool:
        page_job = pool.submit(_screener_page, symbol)
        info_job = pool.submit(_tickertape_info, symbol)
        html = page_job.result()
        company = info_job.result()

    sources = ["Groww"]
    if html:
        sources.append("screener.in")
    if company:
        sources.append("Tickertape")

    return {
        "company": company,
        "ratios": _screener_ratios(html) if html else {},
        "quarters": _screener_quarters(html) if html else {},
        "sources": sources,
    }


def _us_fundamentals(symbol: str, etf: bool) -> Dict[str, Any]:
    asset_class = "etf" if etf else "stocks"
    if etf:
        with ThreadPoolExecutor(max_workers=2) as pool:
            summary_job = pool.submit(_nasdaq_summary, symbol, asset_class)
            info_job = pool.submit(_nasdaq_info, symbol, asset_class)
            summary = summary_job.result()
            info = info_job.result()
        return {
            "sources": ["Nasdaq"],
            "company": {"name": info.get("name"),
                        "exchange": summary.get("Exchange") or info.get("exchange")},
            "ratios": {},
            "etf_facts": {
                "aum_thousands": _num(summary.get("AUM")),
                "expense_ratio": _num(summary.get("ExpenseRatio")),
                "beta": _num(summary.get("Beta")),
                "market_cap": _num(summary.get("MarketCap")),
                "market_cap_unit": "absolute",
                "week52_high": _split_high_low(summary.get("FiftTwoWeekHighLow"))[0],
                "week52_low": _split_high_low(summary.get("FiftTwoWeekHighLow"))[1],
                "average_volume": _num(summary.get("FiftyDayAvgDailyVol")),
            },
        }

    with ThreadPoolExecutor(max_workers=4) as pool:
        summary_job = pool.submit(_nasdaq_summary, symbol, asset_class)
        info_job = pool.submit(_nasdaq_info, symbol, asset_class)
        annual_job = pool.submit(_nasdaq_financials, symbol, 1)
        quarterly_job = pool.submit(_nasdaq_financials, symbol, 2)
        summary = summary_job.result()
        info = info_job.result()
        annual = annual_job.result()
        quarterly = quarterly_job.result()

    return {
        "company": {
            "name": info.get("name"),
            "industry": summary.get("Industry"),
            "sector_provider": summary.get("Sector"),
            "exchange": summary.get("Exchange") or info.get("exchange"),
        },
        "summary": summary,
        "annual": annual,
        "quarters": _us_quarters(quarterly),
        "sources": ["Nasdaq"],
    }


def _split_high_low(value: Any) -> List[Optional[float]]:
    text = str(value or "")
    if "/" not in text:
        return [None, None]
    parts = text.split("/")
    return [_num(parts[0]), _num(parts[1])]
