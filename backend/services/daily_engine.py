"""Day-by-day movement of one portfolio.

Two sources feed this, and they are not equivalent:

  * **recorded** — `PortfolioDailySnapshot` rows, written from live values while
    the app is open. These are what the portfolio was actually worth.
  * **reconstructed** — `history_engine`, which values *today's* quantities at
    old closes. It is the only thing available for days before recording
    started, but it cannot see past buys and sells.

Recorded days always win. Reconstructed days fill in behind them so the section
is not empty on day one, and every row says which it is.
"""
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

import models

DISPLAY_DAYS = 30


def record_snapshot(db, portfolio_id: str, invested_inr: float,
                    current_value_inr: float) -> None:
    """Write today's value for *portfolio_id*, replacing any earlier write.

    Called whenever a portfolio is priced, so the row is refreshed through the
    day and settles on the last value seen. Never raises: a failure to record
    history must not take down the page that triggered it.
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


def _recorded_days(db, portfolio_id: str) -> Dict[str, Dict[str, Any]]:
    rows = (db.query(models.PortfolioDailySnapshot)
            .filter(models.PortfolioDailySnapshot.portfolio_id == portfolio_id)
            .order_by(models.PortfolioDailySnapshot.snapshot_date)
            .all())
    return {
        r.snapshot_date: {
            "value_inr": round(r.current_value_inr, 2),
            "invested_inr": round(r.invested_inr, 2) if r.invested_inr else None,
            "source": "recorded",
        }
        for r in rows
    }


def _reconstructed_days(history: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    dates = history.get("dates") or []
    values = ((history.get("series") or {}).get("portfolio") or {}).get("values_inr") or []
    return {
        day: {"value_inr": value, "invested_inr": None, "source": "reconstructed"}
        for day, value in zip(dates, values)
        if value and value > 0
    }


def build_daily(db, portfolio_id: str, history: Optional[Dict[str, Any]] = None,
                limit: int = DISPLAY_DAYS) -> Dict[str, Any]:
    """The last *limit* days of movement, newest first."""
    merged: Dict[str, Dict[str, Any]] = {}
    merged.update(_reconstructed_days(history or {}))
    # Recorded last so a real value replaces the reconstruction for that day.
    merged.update(_recorded_days(db, portfolio_id))

    days = sorted(merged)
    rows: List[Dict[str, Any]] = []

    for i, day in enumerate(days):
        entry = merged[day]
        previous = merged[days[i - 1]] if i > 0 else None

        change_inr = change_percent = None
        if previous and previous["value_inr"] > 0:
            change_inr = round(entry["value_inr"] - previous["value_inr"], 2)
            change_percent = round(change_inr / previous["value_inr"] * 100, 2)

        pnl_inr = pnl_percent = None
        if entry["invested_inr"]:
            pnl_inr = round(entry["value_inr"] - entry["invested_inr"], 2)
            pnl_percent = round(pnl_inr / entry["invested_inr"] * 100, 2)

        rows.append({
            "date": day,
            "value_inr": entry["value_inr"],
            "invested_inr": entry["invested_inr"],
            "change_inr": change_inr,
            "change_percent": change_percent,
            "pnl_inr": pnl_inr,
            "pnl_percent": pnl_percent,
            "source": entry["source"],
            # A change measured across the switch from reconstruction to real
            # recording is partly an artefact of the method changing, not a
            # move in the market, so the row is flagged rather than trusted.
            "spans_sources": bool(previous and previous["source"] != entry["source"]),
        })

    recorded_total = sum(1 for r in rows if r["source"] == "recorded")
    return {
        "portfolio_id": portfolio_id,
        "days": list(reversed(rows[-limit:])),
        "shown": min(len(rows), limit),
        "stored_total": _stored_count(db, portfolio_id),
        "recorded_in_window": recorded_total,
    }


def _stored_count(db, portfolio_id: str) -> int:
    """How many days are on record, including those older than the window."""
    try:
        return (db.query(models.PortfolioDailySnapshot)
                .filter(models.PortfolioDailySnapshot.portfolio_id == portfolio_id)
                .count())
    except Exception:
        return 0
