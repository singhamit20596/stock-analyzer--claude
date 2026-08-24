"""Percentage price moves over fixed windows, for a list of holdings.

Reads the same daily candles the deep-dive page uses, so opening a stock warms
this table's cache and vice versa. `stock_detail` caches each symbol's 5Y
series for six hours, which is what makes a thirty-symbol table affordable.

Every window is measured from the latest close back to the last session on or
before the cutoff — not "N rows back" — so a market holiday shifts the
comparison date rather than silently widening the window.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from services import stock_detail
from services.quote_service import fetch_live_prices_batch

# Label -> calendar days back. 1D is "the previous session", handled separately,
# because a calendar day back from Monday is Sunday.
WINDOWS: Dict[str, int] = {"d7": 7, "d30": 30, "m6": 182, "y1": 365}

MAX_WORKERS = 8


def _round(value: Optional[float], digits: int = 2) -> Optional[float]:
    return None if value is None else round(value, digits)


def _percent(now: float, then: Optional[float]) -> Optional[float]:
    if not then or then <= 0:
        return None
    return round((now - then) / then * 100, 2)


def _close_on_or_before(candles: List[Dict[str, Any]], cutoff: str) -> Optional[float]:
    """The last close at or before *cutoff*, or None if the series starts later."""
    found = None
    for candle in candles:
        if candle["time"] <= cutoff:
            found = candle["close"]
        else:
            break
    return found


# A live quote wildly adrift from the last close is a bad scrape, not a move.
LIVE_SANITY = 0.25


def changes_for(symbol: str, country: str,
                live_price: Optional[float] = None) -> Dict[str, Any]:
    """Moves for one instrument. Empty dict when no history is available.

    `live_price` matters more than it looks. The daily endpoints only publish a
    row once a session has closed, so on any day the market is open — or, for
    US names, for most of an Indian day — the newest candle is *yesterday's*.
    Comparing the last two candles then labels a stale figure "1D". Feeding the
    live quote in makes 1D mean "since the last close", which is what every
    finance site shows and what the reader expects.
    """
    try:
        candles = stock_detail.fetch_candles(symbol, country)
    except Exception:
        candles = []
    if len(candles) < 2:
        return {}

    latest = candles[-1]
    last_close = latest["close"]
    today = datetime.now(timezone.utc).date()

    # Is there a newer price than the last published close?
    live = False
    now = last_close
    reference = candles[-2]["close"]
    reference_date = candles[-2]["time"]

    if (live_price and live_price > 0 and last_close > 0
            and abs(live_price - last_close) / last_close < LIVE_SANITY
            and abs(live_price - last_close) > 1e-9):
        now = live_price
        reference = last_close
        reference_date = latest["time"]
        live = True

    moves: Dict[str, Optional[float]] = {"d1": _percent(now, reference)}
    for label, days in WINDOWS.items():
        cutoff = (today - timedelta(days=days)).isoformat()
        moves[label] = _percent(now, _close_on_or_before(candles, cutoff))

    return {
        "symbol": symbol.strip().upper(),
        "country": (country or "IND").upper(),
        # What the figures are measured *to*, and what 1D is measured *from* —
        # so the UI can say which day it is showing instead of implying today.
        "as_of": "live" if live else latest["time"],
        "last_close_date": latest["time"],
        "reference_date": reference_date,
        "is_live": live,
        "close": _round(now, 4),
        **moves,
    }


def changes_for_many(pairs: Iterable[Tuple[str, str]]) -> Dict[str, Dict[str, Any]]:
    """Moves for many (symbol, country) pairs, keyed "SYMBOL:COUNTRY"."""
    wanted = sorted({(s.strip().upper(), (c or "IND").upper())
                     for s, c in pairs if s and s.strip()})
    if not wanted:
        return {}

    # One batched quote call for the whole table, so 1D reflects the session in
    # progress rather than the last published close.
    try:
        live = fetch_live_prices_batch(wanted)
    except Exception:
        live = {}

    out: Dict[str, Dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(wanted))) as pool:
        futures = {pool.submit(changes_for, s, c, live.get((s, c))): (s, c)
                   for s, c in wanted}
        for future, (symbol, country) in futures.items():
            try:
                result = future.result()
            except Exception:
                result = {}
            if result:
                out[f"{symbol}:{country}"] = result
    return out
