"""Portfolio performance over time, and how it compares to the major indices.

Nothing records what the portfolio was worth on past dates, so the value series
is reconstructed by pricing the quantities held on each day (per the change log)
at that day's close. Values are in INR, with US legs converted at that day's
USD/INR rate.

**Value is not performance.** Buying a stock raises what the portfolio is worth
without earning anything, so indexing the raw value counts every deposit as a
gain — an import once read as a 6% day. The plotted line is therefore
chain-linked: each day's return is measured after netting out the money that
moved that day, which is also the only basis on which it can be set against an
index, since Nifty and the Nasdaq have no deposits.
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


def _chain_linked(values: List[float], flows: Dict[str, float],
                  dates: List[str]) -> List[Optional[float]]:
    """Rebases to 100 and compounds daily returns, net of money moving in or out.

    `(value - flow) / previous_value` is the day's return on the capital that
    was already there; compounding those is what makes the line comparable to a
    price index. Without the flow term a deposit lands as a vertical jump and
    everything after it is measured off an inflated base.
    """
    out: List[Optional[float]] = []
    level: Optional[float] = None
    for i, day in enumerate(dates):
        value = values[i]
        if level is None:
            level = 100.0 if value > 0 else None
            out.append(round(level, 3) if level is not None else None)
            continue
        previous = values[i - 1]
        if previous > 0:
            level *= 1 + ((value - flows.get(day, 0.0)) / previous - 1)
        out.append(round(level, 3))
    return out


def _indexed(values: List[float]) -> List[Optional[float]]:
    """Rebases a series to 100 at its first non-zero point."""
    base = next((v for v in values if v and v > 0), 0.0)
    if base <= 0:
        return [None] * len(values)
    return [round(v / base * 100, 3) if v and v > 0 else None for v in values]


def build_history(holdings: List[Dict[str, Any]], range_: str = "3mo",
                  quantity_at=None,
                  flows: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Portfolio and benchmark series, each indexed to 100 at the first date.

    `holdings` is a list of {"symbol", "country", "quantity"} giving the stocks
    to price and today's quantity of each.

    `quantity_at(symbol, country, day, fallback)` supplies the quantity held on
    a given day, so the line reflects what was actually owned rather than
    applying today's basket to the whole past. Omit it and the old behaviour —
    today's quantities throughout — is used.

    `flows` is `holdings_history.flow_events(...)`: the shares and cost basis
    that moved on each day, which are priced here and removed from the return.
    Omit it and every purchase reads as profit.
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

    # Providers do not reach back equally far — Groww's Indian series starts a
    # session or two after Nasdaq's. A leading date on which only some holdings
    # print values only part of the portfolio, and since the line is rebased to
    # its first point, that partial day becomes the base for everything after
    # it: the rest of the portfolio then arrives as a one-day "gain" of over
    # 100%. Start where every holding has a close instead.
    #
    # Only when that is cheap. A genuinely short history — a recent listing —
    # would otherwise truncate the whole chart to match its worst source, so
    # such a holding keeps its late start and is handled as a flow below.
    starts = {k: min(s) for k, s in priced.items()}
    late_cutoff = dates[min(len(dates) // 4, len(dates) - 1)] if dates else None
    on_time = [d for d in starts.values() if late_cutoff is None or d <= late_cutoff]
    first_full = max(on_time) if on_time else None
    trimmed = 0
    if first_full and first_full > dates[0]:
        trimmed = sum(1 for d in dates if d < first_full)
        dates = [d for d in dates if d >= first_full]

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

    # Money in and out, priced on the day it moved. A purchase's cost basis is
    # the cash that went in; a sale hands back the market value of the shares
    # that left, which a cost basis cannot tell us.
    date_set = set(dates)
    flow_by_day: Dict[str, float] = {}
    charged = set()
    for row in flows or []:
        day = row["day"]
        if day not in date_set:
            continue
        key = (row["symbol"], row["country"])
        close = filled.get(key, {}).get(day)
        if close is None:
            # Nothing to net out: a stock with no price history never entered
            # the value series, and one sold before today was never fetched at
            # all. Removing its cash anyway would invent the opposite error —
            # buying YATHARTHHO, which resolves at no provider, subtracted
            # ₹108,472 from a day the portfolio had not actually moved.
            continue
        delta = row["quantity_delta"]
        if delta > 0:
            amount = row["cost_delta"]
            # An implied purchase price far from that day's close means the
            # average itself was misread; the close is the safer figure.
            if amount <= 0 or not close / 3 <= amount / delta <= close * 3:
                amount = delta * close
        else:
            amount = delta * close
        if key[1] == "US":
            rate = fx_filled.get(day, 0.0)
            if rate <= 0:
                continue
            amount *= rate
        flow_by_day[day] = flow_by_day.get(day, 0.0) + amount
        charged.add((day, key))

    # A holding whose price history merely *starts* late joins the value series
    # mid-window without anything having been bought. That is a data boundary,
    # not a gain, so it is netted out the same way — unless the change log has
    # already booked a purchase for it that day, which would double-count.
    for key in priced:
        entry = next((d for d in dates if d in filled.get(key, {})), None)
        if entry is None or entry == dates[0] or (entry, key) in charged:
            continue
        held = (quantity_at(key[0], key[1], entry, quantities[key])
                if quantity_at else quantities[key])
        if held <= 0:
            continue
        amount = held * filled[key][entry]
        if key[1] == "US":
            rate = fx_filled.get(entry, 0.0)
            if rate <= 0:
                continue
            amount *= rate
        flow_by_day[entry] = flow_by_day.get(entry, 0.0) + amount

    if trimmed:
        warnings.append(
            f"{trimmed} early session(s) dropped: not every holding had price "
            f"history that far back, so they would have priced only part of "
            f"the portfolio."
        )

    series: Dict[str, Any] = {
        "portfolio": {
            "label": "My Portfolio",
            "values_inr": portfolio,
            "flows_inr": [round(flow_by_day.get(d, 0.0), 2) for d in dates],
            "indexed": _chain_linked(portfolio, flow_by_day, dates),
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
