"""Daily closing-price series, from providers that work without an API key.

Yahoo would cover everything in one call, but it rate-limits an ordinary home
IP hard enough to be unusable for a 60-symbol portfolio, so each market is read
from the provider that serves it reliably:

  * Indian stocks and the Nifty 50 -> Groww's charting endpoint
  * US stocks, ETFs and the Nasdaq Composite -> Nasdaq's public quote API
  * USD/INR -> Frankfurter (ECB reference rates)

Every function returns {"YYYY-MM-DD": close} and an empty dict on failure, so a
provider going down degrades the chart rather than breaking the page.
"""
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Tuple

import httpx

from services.symbols import resolve_quote_symbol

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
}
NASDAQ_HEADERS = {**BROWSER_HEADERS, "Referer": "https://www.nasdaq.com/"}

TIMEOUT = 12.0

# Groww stamps a daily candle at 00:00 IST, which is 18:30 UTC the *previous*
# day. Read as UTC, every Indian session lands a day early and Monday looks
# like Sunday, so the session date must be taken in IST. `stock_detail` does
# the same for its candles.
IST = timezone(timedelta(hours=5, minutes=30))

# Daily closes only change once a day.
_CACHE: Dict[Tuple[str, str, int], Dict[str, float]] = {}
_CACHE_AT: Dict[Tuple[str, str, int], float] = {}
CACHE_TTL_SECONDS = 6 * 3600

RANGE_DAYS = {"1mo": 31, "3mo": 93, "6mo": 186, "1y": 366}


def _cached(key: Tuple[str, str, int]):
    stamped = _CACHE_AT.get(key)
    if stamped and (time.time() - stamped) < CACHE_TTL_SECONDS:
        return _CACHE.get(key)
    return None


def _store(key: Tuple[str, str, int], series: Dict[str, float]) -> Dict[str, float]:
    if series:
        _CACHE[key] = series
        _CACHE_AT[key] = time.time()
    return series


def _groww_daily(symbol: str, days: int) -> Dict[str, float]:
    """Daily closes for an NSE symbol (or "NIFTY" for the index)."""
    key = ("groww", symbol, days)
    hit = _cached(key)
    if hit is not None:
        return hit

    now_ms = int(time.time() * 1000)
    start_ms = now_ms - days * 24 * 3600 * 1000
    url = (f"https://groww.in/v1/api/charting_service/v1/chart/exchange/NSE"
           f"/segment/CASH/{symbol}"
           f"?intervalInMinutes=1440&startTimeInMillis={start_ms}&endTimeInMillis={now_ms}")
    try:
        response = httpx.get(url, headers=BROWSER_HEADERS, timeout=TIMEOUT)
        if response.status_code != 200:
            return {}
        series: Dict[str, float] = {}
        for candle in response.json().get("candles") or []:
            # [epoch_seconds, open, high, low, close, volume]
            if len(candle) < 5 or candle[4] in (None, 0):
                continue
            day = datetime.fromtimestamp(candle[0], tz=IST).strftime("%Y-%m-%d")
            series[day] = float(candle[4])
        return _store(key, series)
    except Exception:
        return {}


def _nasdaq_daily(symbol: str, days: int, asset_class: str = "") -> Dict[str, float]:
    """Daily closes from Nasdaq. Tries stocks then etf unless told which."""
    key = ("nasdaq", f"{symbol}:{asset_class}", days)
    hit = _cached(key)
    if hit is not None:
        return hit

    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=days)
    classes = [asset_class] if asset_class else ["stocks", "etf"]

    for cls in classes:
        url = (f"https://api.nasdaq.com/api/quote/{symbol}/historical"
               f"?assetclass={cls}&fromdate={start}&todate={today}&limit=9999")
        try:
            response = httpx.get(url, headers=NASDAQ_HEADERS, timeout=TIMEOUT)
            if response.status_code != 200:
                continue
            rows = (((response.json().get("data") or {}).get("tradesTable") or {})
                    .get("rows")) or []
            series: Dict[str, float] = {}
            for row in rows:
                raw = (row.get("close") or "").replace("$", "").replace(",", "").strip()
                if not raw:
                    continue
                try:
                    close = float(raw)
                except ValueError:
                    continue
                try:
                    day = datetime.strptime(row["date"], "%m/%d/%Y").strftime("%Y-%m-%d")
                except (KeyError, ValueError):
                    continue
                if close > 0:
                    series[day] = close
            if series:
                return _store(key, series)
        except Exception:
            continue
    return {}


def _fx_daily(days: int) -> Dict[str, float]:
    """USD->INR per day, from ECB reference rates."""
    key = ("fx", "USDINR", days)
    hit = _cached(key)
    if hit is not None:
        return hit

    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=days)
    url = f"https://api.frankfurter.dev/v1/{start}..{today}?base=USD&symbols=INR"
    try:
        response = httpx.get(url, timeout=TIMEOUT, follow_redirects=True)
        if response.status_code != 200:
            return {}
        series = {
            day: float(values["INR"])
            for day, values in (response.json().get("rates") or {}).items()
            if values.get("INR")
        }
        return _store(key, series)
    except Exception:
        return {}


def fetch_holding_histories(pairs: Iterable[Tuple[str, str]],
                            days: int) -> Dict[Tuple[str, str], Dict[str, float]]:
    """Daily closes for (symbol, country) pairs, fetched in parallel."""
    wanted: List[Tuple[str, str]] = sorted({
        (s.strip().upper(), (c or "IND").upper()) for s, c in pairs if s and s.strip()
    })
    if not wanted:
        return {}

    def one(pair: Tuple[str, str]) -> Dict[str, float]:
        symbol, country = pair
        resolved = resolve_quote_symbol(symbol)
        if country == "US":
            return _nasdaq_daily(resolved, days)
        return _groww_daily(resolved, days)

    out: Dict[Tuple[str, str], Dict[str, float]] = {}
    with ThreadPoolExecutor(max_workers=min(10, len(wanted))) as executor:
        futures = {executor.submit(one, p): p for p in wanted}
        for future, pair in futures.items():
            try:
                out[pair] = future.result()
            except Exception:
                out[pair] = {}
    return out


def fetch_benchmarks(days: int) -> Dict[str, Dict[str, float]]:
    """Nifty 50, Nasdaq Composite and the S&P 500, as daily closes.

    SPY stands in for the S&P 500: Nasdaq's API does not carry the SPX index,
    and since the chart compares percentage moves the tracking difference is
    immaterial.
    """
    jobs = {
        "nifty50": lambda: _groww_daily("NIFTY", days),
        "nasdaq": lambda: _nasdaq_daily("COMP", days, asset_class="index"),
        "sp500": lambda: _nasdaq_daily("SPY", days, asset_class="etf"),
    }
    out: Dict[str, Dict[str, float]] = {}
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {executor.submit(fn): name for name, fn in jobs.items()}
        for future, name in futures.items():
            try:
                out[name] = future.result()
            except Exception:
                out[name] = {}
    return out


def fetch_fx(days: int) -> Dict[str, float]:
    return _fx_daily(days)
