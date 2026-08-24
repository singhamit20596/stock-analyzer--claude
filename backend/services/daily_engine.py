"""Day-by-day P&L for one portfolio.

The figure is the **sum of each stock's P&L for that day**, not the change in
portfolio value. Those are different numbers, and the difference is money you
moved: differencing two portfolio values counts a day's buying as profit, which
is how an import of eight positions once showed up as +3.4% in a single day.

Per stock, per day:

  * shares held yesterday too -> quantity x (today's close - yesterday's close)
  * shares that appeared today -> quantity x (today's close - average cost),
    counted once on the day they arrive and carried on the price move after
  * shares sold -> simply stop contributing; without transaction history there
    is no realised P&L to book

Everything is INR, so a US holding's day includes the rupee's move against the
dollar — which is real P&L for someone whose money is in rupees.

`portfolio_daily_snapshots` is still written on every view, because it is the
only record of what the portfolio was actually *observed* to be worth. It is no
longer what this table is computed from: prices and quantities give a figure
that can be explained stock by stock, which a stored total cannot.
"""
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import models
from services import history_source, stock_detail

DISPLAY_DAYS = 30
# Enough sessions behind the 30-row window to fill it after weekends and
# holidays, without pulling a year of history on every load.
LOOKBACK_DAYS = 95


def record_snapshot(db, portfolio_id: str, invested_inr: float,
                    current_value_inr: float) -> None:
    """Write today's observed value, replacing any earlier write today.

    Never raises: failing to record history must not take down the page that
    triggered it.
    """
    if not portfolio_id or current_value_inr is None:
        return

    today = date.today().isoformat()
    try:
        row = (db.query(models.PortfolioDailySnapshot)
               .filter(models.PortfolioDailySnapshot.portfolio_id == portfolio_id,
                       models.PortfolioDailySnapshot.snapshot_date == today)
               .first())
        if row is None:
            row = models.PortfolioDailySnapshot(
                portfolio_id=portfolio_id, snapshot_date=today)
            db.add(row)
        row.invested_inr = round(float(invested_inr or 0.0), 2)
        row.current_value_inr = round(float(current_value_inr or 0.0), 2)
        row.recorded_at = datetime.now(timezone.utc)
        db.commit()
    except Exception:
        db.rollback()


def _forward_fill(series: Dict[str, float], dates: List[str]) -> Dict[str, float]:
    """Carry the last known price over days a stock did not print."""
    out: Dict[str, float] = {}
    last: Optional[float] = None
    for day in dates:
        if day in series:
            last = series[day]
        if last is not None:
            out[day] = last
    return out


def _closes(symbol: str, country: str) -> Dict[str, float]:
    """Daily closes keyed by session date, from the IST-correct candle series."""
    try:
        candles = stock_detail.fetch_candles(symbol, country)
    except Exception:
        return {}
    return {c["time"]: c["close"] for c in candles if c.get("close")}


def build_daily(db, portfolio_id: str, holdings: List[Dict[str, Any]],
                quantity_at, limit: int = DISPLAY_DAYS) -> Dict[str, Any]:
    """The last *limit* sessions of P&L, newest first.

    `holdings` carries symbol, country, quantity and avg_cost_native.
    `quantity_at(symbol, country, day, fallback)` answers how much was held.
    """
    if not holdings:
        return {"portfolio_id": portfolio_id, "days": [], "shown": 0,
                "stored_total": _stored_count(db, portfolio_id), "holdings": 0}

    prices = {(h["symbol"], h["country"]): _closes(h["symbol"], h["country"])
              for h in holdings}
    priced = {k: v for k, v in prices.items() if v}
    if not priced:
        return {"portfolio_id": portfolio_id, "days": [], "shown": 0,
                "stored_total": _stored_count(db, portfolio_id),
                "holdings": len(holdings),
                "warnings": ["No price history could be fetched for these holdings."]}

    cutoff = (date.today() - timedelta(days=LOOKBACK_DAYS)).isoformat()
    dates = sorted({d for series in priced.values() for d in series if d >= cutoff})
    if len(dates) < 2:
        return {"portfolio_id": portfolio_id, "days": [], "shown": 0,
                "stored_total": _stored_count(db, portfolio_id),
                "holdings": len(holdings)}

    filled = {k: _forward_fill(v, dates) for k, v in priced.items()}

    needs_fx = any(country == "US" for _, country in priced)
    fx = _forward_fill(history_source.fetch_fx(LOOKBACK_DAYS + 10), dates) if needs_fx else {}
    warnings: List[str] = []
    if needs_fx and not fx:
        warnings.append("USD/INR history unavailable; US holdings are excluded from these days.")

    by_key = {(h["symbol"], h["country"]): h for h in holdings}
    rows: List[Dict[str, Any]] = []

    for i in range(1, len(dates)):
        today_str, prev_str = dates[i], dates[i - 1]
        rate = fx.get(today_str, 0.0)

        pnl = base = value = 0.0
        # Distinct stocks, not contribution legs: one position can contribute
        # both a carried leg and an added leg on the day it is topped up.
        contributors: set = set()

        for key, series in filled.items():
            symbol, country = key
            close = series.get(today_str)
            previous_close = series.get(prev_str)
            if close is None:
                continue

            to_inr = rate if country == "US" else 1.0
            if country == "US" and to_inr <= 0:
                continue

            holding = by_key[key]
            held_today = quantity_at(symbol, country, today_str, holding["quantity"])
            if held_today <= 0:
                continue

            held_before = quantity_at(symbol, country, prev_str, holding["quantity"])
            price_now = close * to_inr
            value += held_today * price_now

            carried = min(held_today, held_before)
            added = max(0.0, held_today - held_before)

            if carried > 0 and previous_close is not None:
                price_then = previous_close * to_inr
                pnl += carried * (price_now - price_then)
                base += carried * price_then
                contributors.add(key)

            if added > 0:
                # A position that arrived today earns only what it has made
                # since it was bought — never its whole market value.
                cost = (holding.get("avg_cost_native") or 0.0) * to_inr
                if cost > 0:
                    pnl += added * (price_now - cost)
                    base += added * cost
                    contributors.add(key)

        if not contributors:
            continue

        rows.append({
            "date": today_str,
            "value_inr": round(value, 2),
            "change_inr": round(pnl, 2),
            "change_percent": round(pnl / base * 100, 2) if base > 0 else None,
            "positions": len(contributors),
        })

    return {
        "portfolio_id": portfolio_id,
        "days": list(reversed(rows[-limit:])),
        "shown": min(len(rows), limit),
        "stored_total": _stored_count(db, portfolio_id),
        "holdings": len(holdings),
        "warnings": warnings,
    }


def _stored_count(db, portfolio_id: str) -> int:
    """How many days were observed live, kept as a record of what was seen."""
    try:
        return (db.query(models.PortfolioDailySnapshot)
                .filter(models.PortfolioDailySnapshot.portfolio_id == portfolio_id)
                .count())
    except Exception:
        return 0
