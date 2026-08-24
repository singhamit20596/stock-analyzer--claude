"""Applying an import as a diff, and reading the resulting history back.

Two jobs, both about the same log:

  * `apply_import` turns "here is the account's current state" into the set of
    changes that produced it, updating rows in place rather than deleting and
    re-inserting them.
  * `quantity_reader` replays that log to answer "how many of this did the
    account hold on that day", which is what lets the performance chart value
    the past with the quantities actually held then.

An import is a snapshot from a broker screenshot, not a transaction feed, so a
change is only ever inferred by comparing two snapshots. Nothing here knows
about individual trades, and two buys between imports look like one increase.
"""
from bisect import bisect_right
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import models

ADDED = "ADDED"
REMOVED = "REMOVED"
INCREASED = "INCREASED"
DECREASED = "DECREASED"
REPRICED = "REPRICED"
# The opening balance written when the log was introduced. Distinct from ADDED
# because it is not a purchase: the position already existed and the app simply
# had not been recording. That distinction decides what the chart shows for
# dates before the entry — see `QuantityReader`.
OPENING = "OPENING"

# Broker screenshots round, and OCR re-reads the same number slightly
# differently, so a hair of movement is not a change worth recording.
QUANTITY_EPSILON = 1e-6
PRICE_EPSILON = 0.005


def _changed(before: Optional[float], after: Optional[float], epsilon: float) -> bool:
    if before is None or after is None:
        return before != after
    return abs(after - before) > epsilon


def apply_import(db, account, incoming: List[Dict[str, Any]], country: str,
                 currency: str, when: Optional[datetime] = None) -> Dict[str, Any]:
    """Reconcile `incoming` against what the account already holds.

    Returns a summary of what moved. Holdings that did not change are left
    completely untouched — same row, same id, same `first_seen_at`.
    """
    when = when or datetime.now(timezone.utc)

    existing = {h.symbol.strip().upper(): h
                for h in db.query(models.Holding)
                .filter(models.Holding.account_id == account.id).all()}
    seen = set()
    events: List[models.HoldingChange] = []

    def record(**kwargs):
        events.append(models.HoldingChange(
            account_id=account.id, country=country, changed_at=when, **kwargs))

    for row in incoming:
        symbol = (row.get("symbol") or "").strip().upper()
        if not symbol:
            continue
        seen.add(symbol)

        quantity = float(row.get("quantity") or 0.0)
        avg_price = float(row.get("avg_buy_price") or 0.0)
        company = row.get("company_name") or symbol
        price = float(row.get("current_price") or 0.0)

        holding = existing.get(symbol)
        if holding is None:
            db.add(models.Holding(
                account_id=account.id, symbol=symbol, company_name=company,
                quantity=quantity, avg_buy_price=avg_price, current_price=price,
                country=country, currency=currency, first_seen_at=when,
                is_user_verified=1,
            ))
            record(symbol=symbol, company_name=company, change_type=ADDED,
                   quantity_before=0.0, quantity_after=quantity,
                   avg_price_before=None, avg_price_after=avg_price)
            continue

        quantity_moved = _changed(holding.quantity, quantity, QUANTITY_EPSILON)
        price_moved = _changed(holding.avg_buy_price, avg_price, PRICE_EPSILON)

        if quantity_moved or price_moved:
            record(
                symbol=symbol, company_name=company,
                change_type=(INCREASED if quantity > holding.quantity
                             else DECREASED if quantity_moved else REPRICED),
                quantity_before=holding.quantity, quantity_after=quantity,
                avg_price_before=holding.avg_buy_price, avg_price_after=avg_price,
            )

        # The row is updated whether or not it moved enough to log, so a
        # refreshed price still lands; only the *event* is conditional.
        holding.company_name = company or holding.company_name
        holding.quantity = quantity
        holding.avg_buy_price = avg_price
        holding.current_price = price or holding.current_price
        holding.country = country
        holding.currency = currency
        holding.is_user_verified = 1
        if holding.first_seen_at is None:
            holding.first_seen_at = when

    for symbol, holding in existing.items():
        if symbol in seen:
            continue
        record(symbol=symbol, company_name=holding.company_name, change_type=REMOVED,
               quantity_before=holding.quantity, quantity_after=0.0,
               avg_price_before=holding.avg_buy_price, avg_price_after=None)
        db.delete(holding)

    for event in events:
        db.add(event)
    db.commit()

    counts: Dict[str, int] = {}
    for event in events:
        counts[event.change_type] = counts.get(event.change_type, 0) + 1
    return {
        "changed": len(events),
        "counts": counts,
        "unchanged": len(seen) - sum(
            1 for e in events if e.change_type in (ADDED, INCREASED, DECREASED, REPRICED)),
        "events": [_event_payload(e) for e in events],
    }


def _event_payload(event: models.HoldingChange) -> Dict[str, Any]:
    return {
        "id": event.id,
        "account_id": event.account_id,
        "symbol": event.symbol,
        "company_name": event.company_name,
        "country": event.country,
        "change_type": event.change_type,
        "quantity_before": round(event.quantity_before or 0.0, 4),
        "quantity_after": round(event.quantity_after or 0.0, 4),
        "quantity_delta": round((event.quantity_after or 0.0) - (event.quantity_before or 0.0), 4),
        "avg_price_before": event.avg_price_before,
        "avg_price_after": event.avg_price_after,
        "changed_at": event.changed_at,
    }


def recent_changes(db, account_ids: List[str], limit: int = 100) -> List[Dict[str, Any]]:
    if not account_ids:
        return []
    rows = (db.query(models.HoldingChange)
            .filter(models.HoldingChange.account_id.in_(account_ids))
            .order_by(models.HoldingChange.changed_at.desc())
            .limit(limit).all())
    return [_event_payload(r) for r in rows]


# ── reading quantities back out of the log ───────────────────────────────────

def _as_date(value) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)[:10]


class QuantityReader:
    """How much of each stock an account held on any past day.

    Built once per request: the log is walked in order and each stock ends up
    with a sorted list of (day, quantity-after). A lookup is then a binary
    search for the last entry on or before the day in question.
    """

    def __init__(self, timeline: Dict[Tuple[str, str], List[Tuple[str, float]]],
                 pre_history: Dict[Tuple[str, str], float]):
        self._timeline = timeline
        self._pre_history = pre_history
        self._days = {key: [day for day, _ in entries] for key, entries in timeline.items()}

    def at(self, symbol: str, country: str, day: str, fallback: float = 0.0) -> float:
        key = (symbol.strip().upper(), (country or "IND").upper())
        entries = self._timeline.get(key)
        if not entries:
            # No history at all for this stock: its current quantity is the
            # best available answer for every day.
            return fallback
        index = bisect_right(self._days[key], day)
        if index == 0:
            # Before the first entry. A position that was merely *recorded*
            # that day was already owned, so it carries backwards; one that was
            # genuinely bought was not held before, so it reads zero. Treating
            # both as zero would show the whole portfolio appearing out of
            # nowhere on the day logging began.
            return self._pre_history.get(key, 0.0)
        return entries[index - 1][1]

    @property
    def tracked(self) -> int:
        return len(self._timeline)


def quantity_reader(db, account_ids: List[str]) -> QuantityReader:
    """A reader over the change log for these accounts, summed across them."""
    timeline: Dict[Tuple[str, str], List[Tuple[str, float]]] = {}
    pre_history: Dict[Tuple[str, str], float] = {}
    if not account_ids:
        return QuantityReader(timeline, pre_history)

    events = (db.query(models.HoldingChange)
              .filter(models.HoldingChange.account_id.in_(account_ids))
              .order_by(models.HoldingChange.changed_at).all())

    # Quantities are per account, so the running total for a stock is the sum
    # of each account's latest figure — two accounts holding the same stock
    # must not overwrite one another.
    by_account: Dict[Tuple[str, str], Dict[str, float]] = {}
    opened: set = set()
    for event in events:
        key = (event.symbol.strip().upper(), (event.country or "IND").upper())
        holders = by_account.setdefault(key, {})

        # An opening balance says the position already existed, so it also
        # counts backwards from the day it was written.
        account_key = (event.account_id, *key)
        if account_key not in opened:
            opened.add(account_key)
            if event.change_type == OPENING:
                pre_history[key] = pre_history.get(key, 0.0) + (event.quantity_after or 0.0)

        holders[event.account_id] = event.quantity_after or 0.0
        total = sum(holders.values())
        day = _as_date(event.changed_at)

        entries = timeline.setdefault(key, [])
        if entries and entries[-1][0] == day:
            entries[-1] = (day, total)      # last write on a day wins
        else:
            entries.append((day, total))

    return QuantityReader(timeline, pre_history)
