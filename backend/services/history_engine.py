"""Portfolio value over time, and how it compares to the major indices.

Nothing records what the portfolio was worth on past dates — only what is held
right now. The series is therefore reconstructed by valuing *today's*
quantities at each day's close. That answers "how has what I hold been moving",
not "what was my account worth then": past buys and sells are invisible, and a
position opened yesterday is priced as though it had been held all along.

Values are in INR, with US legs converted at that day's USD/INR rate.
"""
from datetime import date
from typing import Any, Dict, List, Optional

from services import history_source
from services.quote_service import fetch_usd_to_inr_rate

BENCHMARK_LABELS = {
    "nifty50": "Nifty 50",
    "nasdaq": "Nasdaq Composite",
    "sp500": "S&P 500",
}


def _forward_fill(series: Dict[str, float], dates: List[str]) -> Dict[str, float]:
    """Carries the last known close forward across gaps.

    India and the US keep different holidays, so on any given date one side may
    have no print. Holding the previous close is the standard fix: the position
    did not change value, the market was simply shut.
    """
    out: Dict[str, float] = {}
    last: Optional[float] = None
    for day in dates:
        if day in series:
            last = series[day]
        if last is not None:
            out[day] = last
    return out


def _indexed(values: List[float]) -> List[Optional[float]]:
    """Rebases a series to 100 at its first non-zero point."""
    base = next((v for v in values if v and v > 0), 0.0)
    if base <= 0:
        return [None] * len(values)
    return [round(v / base * 100, 3) if v and v > 0 else None for v in values]


def build_history(holdings: List[Dict[str, Any]], range_: str = "3mo",
                  quantity_at=None) -> Dict[str, Any]:
    """Portfolio and benchmark series, each indexed to 100 at the first date.

    `holdings` is a list of {"symbol", "country", "quantity"} giving the stocks
    to price and today's quantity of each.

    `quantity_at(symbol, country, day, fallback)` supplies the quantity held on
    a given day, so the line reflects what was actually owned rather than
    applying today's basket to the whole past. Omit it and the old behaviour —
    today's quantities throughout — is used.
    """
    days = history_source.RANGE_DAYS.get(range_)
    if days is None:
        range_, days = "3mo", history_source.RANGE_DAYS["3mo"]

    # Same stock in two accounts is one position to price.
    quantities: Dict[tuple, float] = {}
    for h in holdings:
        qty = float(h.get("quantity") or 0)
        symbol = (h.get("symbol") or "").strip().upper()
        if qty <= 0 or not symbol:
            continue
        key = (symbol, (h.get("country") or "IND").upper())
        quantities[key] = quantities.get(key, 0.0) + qty

    if not quantities:
        return {"range": range_, "dates": [], "series": {}, "sessions": [],
                "coverage": {"priced": 0, "total": 0},
                "warnings": ["This portfolio has no holdings."]}

    histories = history_source.fetch_holding_histories(quantities.keys(), days)
    benchmarks = history_source.fetch_benchmarks(days)
    fx = history_source.fetch_fx(days)

    priced = {k: v for k, v in histories.items() if v}
    if not priced:
        return {"range": range_, "dates": [], "series": {}, "sessions": [],
                "coverage": {"priced": 0, "total": len(quantities)},
                "warnings": ["No price history could be fetched. "
                             "The data providers may be unreachable."]}

    # The x-axis is every date on which some holding printed; each series is
    # then forward-filled onto that spine so all four lines align.
    #
    # Weekends are dropped. This used to be load-bearing, because Groww candles
    # were read as UTC and every Monday arrived stamped Sunday — the filter then
    # discarded a real session a week. `history_source` now reads them in IST, so
    # this is only a guard against a provider emitting a non-session date.
    dates = [d for d in sorted({d for s in priced.values() for d in s})
             if date.fromisoformat(d).weekday() < 5]
    filled = {k: _forward_fill(s, dates) for k, s in priced.items()}
    fx_filled = _forward_fill(fx, dates) if fx else {}

    warnings: List[str] = []
    has_us = any(country == "US" for _, country in priced)
    if has_us and not fx_filled:
        # Dropping the US leg would silently halve the portfolio line, which
        # reads as a crash rather than a data gap. Holding today's rate flat
        # keeps the shape honest and only mis-states the currency component.
        spot = fetch_usd_to_inr_rate()
        if spot > 0:
            fx_filled = {d: spot for d in dates}
            warnings.append(
                f"USD/INR history unavailable; US positions valued at today's "
                f"rate (₹{spot:.2f}) throughout."
            )
        else:
            warnings.append("USD/INR unavailable; US positions are excluded.")

    portfolio: List[float] = []
    for day in dates:
        rate = fx_filled.get(day, 0.0)
        total = 0.0
        for key, qty in quantities.items():
            close = filled.get(key, {}).get(day)
            if close is None:
                continue
            # How much was held *that* day, not today. Without the change log
            # this falls back to the current quantity, which prices a position
            # bought last week as though it had been held all year.
            held = quantity_at(key[0], key[1], day, qty) if quantity_at else qty
            if held <= 0:
                continue
            if key[1] == "US":
                if rate <= 0:
                    continue
                close *= rate
            total += held * close
        portfolio.append(round(total, 2))

    series: Dict[str, Any] = {
        "portfolio": {
            "label": "My Portfolio",
            "values_inr": portfolio,
            "indexed": _indexed(portfolio),
        }
    }
    for key, label in BENCHMARK_LABELS.items():
        raw = benchmarks.get(key) or {}
        if not raw:
            warnings.append(f"{label} history unavailable.")
            continue
        aligned = _forward_fill(raw, dates)
        values = [aligned.get(d) or 0.0 for d in dates]
        series[key] = {"label": label, "indexed": _indexed(values)}

    missing = len(quantities) - len(priced)
    if missing > 0:
        warnings.append(f"{missing} of {len(quantities)} holdings had no price "
                        f"history and are excluded from the portfolio line.")

    # Day-over-day moves are no longer derived here: they have their own
    # section, fed by `daily_engine`, which prefers recorded values over this
    # reconstruction and keeps a 30-day window rather than three sessions.
    return {
        "range": range_,
        "dates": dates,
        "series": series,
        "coverage": {"priced": len(priced), "total": len(quantities)},
        "warnings": warnings,
    }
