import re
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, Iterable, Tuple

import httpx

from services.symbols import resolve_quote_symbol

PRICE_CACHE: Dict[Tuple[str, str], Dict[str, Any]] = {}
CACHE_TTL_SECONDS = 120

# Last-resort seed, used only if every FX provider is unreachable on the very
# first request. It goes stale — treat a figure equal to this as "not live".
FALLBACK_USD_INR = 95.50
USD_INR_CACHE: Dict[str, Any] = {"rate": FALLBACK_USD_INR, "timestamp": 0.0}
USD_INR_TTL_SECONDS = 300

BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
                  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}

# JSON endpoints answer fast. Google Finance serves a ~1.2MB HTML page that can
# take ~2s on its own, so it needs a larger budget — requests run in parallel,
# so this bounds the slowest fetch, not their sum.
REQUEST_TIMEOUT = 2.0
PAGE_TIMEOUT = 6.0

# Google Finance serves several page variants and silently redirects between
# them, so try each known shape. The `jsname` anchor is the current /beta/
# layout; the other two are the older markup, kept as fallbacks.
#
# The currency symbol is required, not optional: the same `jsname` wraps the
# market-summary index strip at the top of every page, and those render as bare
# numbers. Without the symbol the first match is the Nifty, not the stock.
_GOOGLE_PRICE_PATTERNS = (
    re.compile(r'jsname="Pdsbrc"[^>]*>(?:\s*<span[^>]*>)?\s*(?:\$|₹|Rs\.?)\s*([\d,]+\.\d{2})'),
    re.compile(r'data-last-price="([\d.]+)"'),
    re.compile(r'class="YMlKec fxfaPl">\s*(?:\$|₹|Rs\.?)\s*([\d,]+\.?\d*)'),
)

# Yahoo rate-limits aggressively (HTTP 429). When it does, stop asking for a
# while instead of burning a timeout on every symbol in the batch.
_YAHOO_BLOCKED_UNTIL = 0.0
YAHOO_COOLDOWN_SECONDS = 600


def _scrape_google_finance(client: httpx.Client, path: str) -> float:
    """Reads the last price off a Google Finance quote page. 0.0 if absent."""
    try:
        response = client.get(f"https://www.google.com/finance/quote/{path}")
    except Exception:
        return 0.0

    for pattern in _GOOGLE_PRICE_PATTERNS:
        match = pattern.search(response.text)
        if match:
            try:
                value = float(match.group(1).replace(',', ''))
            except ValueError:
                continue
            if value > 0:
                return value
    return 0.0


def _fetch_yahoo_chart(ticker: str) -> float:
    """Reads the last price from Yahoo's chart endpoint. 0.0 if absent."""
    global _YAHOO_BLOCKED_UNTIL
    if time.time() < _YAHOO_BLOCKED_UNTIL:
        return 0.0

    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1m&range=1d"
    try:
        response = httpx.get(url, headers=BROWSER_HEADERS, timeout=REQUEST_TIMEOUT)
        if response.status_code == 429:
            _YAHOO_BLOCKED_UNTIL = time.time() + YAHOO_COOLDOWN_SECONDS
            return 0.0
        if response.status_code != 200:
            return 0.0
        results = response.json().get('chart', {}).get('result') or []
        if not results:
            return 0.0
        meta = results[0].get('meta', {})
        price = meta.get('regularMarketPrice') or meta.get('previousClose')
        return float(price) if price and float(price) > 0 else 0.0
    except Exception:
        return 0.0


def _fetch_fx_api_rate() -> float:
    """USD->INR from a structured JSON endpoint (no key required)."""
    try:
        response = httpx.get("https://open.er-api.com/v6/latest/USD",
                             timeout=REQUEST_TIMEOUT)
        if response.status_code == 200:
            rate = response.json().get("rates", {}).get("INR")
            if rate and float(rate) > 0:
                return float(rate)
    except Exception:
        pass
    return 0.0


def fetch_usd_to_inr_rate() -> float:
    """Live USD->INR rate, cached for 5 minutes.

    Every INR figure in the app is derived from this, so it is worth trying
    more than one source. Falls back to the last known good value.
    """
    now = time.time()
    if (now - USD_INR_CACHE["timestamp"]) < USD_INR_TTL_SECONDS:
        return USD_INR_CACHE["rate"]

    rate = _fetch_fx_api_rate() or _fetch_yahoo_chart("USDINR=X")
    if rate > 0:
        USD_INR_CACHE["rate"] = rate
        USD_INR_CACHE["timestamp"] = now
    return USD_INR_CACHE["rate"]


def _fetch_us_quote(symbol: str) -> float:
    try:
        with httpx.Client(follow_redirects=True, headers=BROWSER_HEADERS,
                          timeout=PAGE_TIMEOUT) as client:
            for exchange in ('NASDAQ', 'NYSE'):
                price = _scrape_google_finance(client, f"{symbol}:{exchange}")
                if price > 0:
                    return price
    except Exception:
        pass
    return _fetch_yahoo_chart(symbol)


def _fetch_indian_quote(symbol: str) -> float:
    # Groww's public live-price endpoint is the most reliable for NSE.
    url = (f"https://groww.in/v1/api/stocks_data/v1/tr_live_prices"
           f"/exchange/NSE/segment/CASH/{symbol}/latest")
    try:
        response = httpx.get(url, headers=BROWSER_HEADERS, timeout=REQUEST_TIMEOUT)
        if response.status_code == 200:
            data = response.json()
            ltp = data.get('ltp') or data.get('close')
            if ltp and float(ltp) > 0:
                return float(ltp)
    except Exception:
        pass
    return _fetch_yahoo_chart(f"{symbol}.NS")


def fetch_single_quote(symbol: str, country: str = "IND") -> float:
    """Live price for one symbol, in its own native currency.

    `country` comes from the holding's stored country, so no guessing from the
    shape of the ticker is needed. Returns 0.0 when no provider has a price.
    """
    sym = resolve_quote_symbol(symbol)
    if not sym:
        return 0.0

    is_us = (country or "IND").upper() == "US"
    cache_key = (sym, "US" if is_us else "IND")

    now = time.time()
    cached = PRICE_CACHE.get(cache_key)
    if cached and (now - cached["timestamp"]) < CACHE_TTL_SECONDS:
        return cached["price"]

    price = _fetch_us_quote(sym) if is_us else _fetch_indian_quote(sym)
    if price > 0:
        PRICE_CACHE[cache_key] = {"price": price, "timestamp": now}
    return price


def fetch_live_prices_batch(symbol_countries: Iterable[Tuple[str, str]]) -> Dict[Tuple[str, str], float]:
    """Fetches many quotes in parallel.

    Takes (symbol, country) pairs and returns a dict keyed the same way, so a
    ticker that exists in both markets stays two distinct prices.
    """
    wanted = {
        (sym.strip().upper(), (country or "IND").upper())
        for sym, country in symbol_countries
        if sym and sym.strip()
    }
    if not wanted:
        return {}

    results: Dict[Tuple[str, str], float] = {}
    with ThreadPoolExecutor(max_workers=min(15, len(wanted))) as executor:
        futures = {
            executor.submit(fetch_single_quote, sym, country): (sym, country)
            for sym, country in wanted
        }
        for future, key in futures.items():
            try:
                results[key] = future.result()
            except Exception:
                results[key] = 0.0
    return results
