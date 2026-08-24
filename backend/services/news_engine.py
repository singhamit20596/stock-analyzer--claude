"""Recent news on the portfolio's stocks, read as an investor would.

Two stages, and the split matters:

  1. `news_sources` fetches real headlines from Google News RSS. Free, no key,
     and it is the only thing that decides *what exists*.
  2. A model ranks and explains them — but only ever sees headlines that were
     actually fetched, so it cannot invent one. Without a key this stage is
     skipped and keyword scoring stands in.

That ordering is why the model is never asked to search: given real headlines
its job is judgement, which is the part keywords cannot do. It also costs a
fraction of a web-search turn.

Manually triggered throughout. Nothing here gives buy or sell advice.
"""
from typing import Any, Dict, List, Optional

from services import llm_provider, news_sources

DEFAULT_WINDOW_DAYS = 14
MATERIALITY = ("high", "medium", "low")

_RULES = """You are a news analyst for a private investor reviewing their own portfolio.

You will be given real headlines already gathered for the stocks they hold. Judge
them as a shareholder would.

Material — earnings and guidance, management changes, regulatory or legal action,
credit rating and analyst actions, large orders or contract wins and losses, M&A,
fundraising and dilution, promoter or insider transactions, production or supply
disruption, index inclusion or exclusion, and sector shocks that clearly reach a
named holding.

Not material — routine product announcements, marketing, conference
appearances, listicles, institutional 13F filings, and commentary that merely
restates the day's price move.

Rules:
- Use ONLY the headlines given. Never invent one, and never alter a URL.
- Copy `id` through unchanged so each judgement can be matched back.
- Drop anything immaterial entirely rather than reporting it as low.
- `impact` must explain the mechanism — why this bears on the share price — not
  restate the headline. One or two sentences.
- `materiality` is high only when a reasonable shareholder would act on it or
  watch it closely.
- Do not give buy, sell or hold advice, and do not predict a price.

Return ONLY JSON:

{"items": [
  {"id": 0,
   "materiality": "high|medium|low",
   "direction": "positive|negative|mixed|unclear",
   "impact": "why this bears on the share price"}
]}"""

_STOCK_EXTRA = """
Also return an overall read of where this company stands, on the evidence in these
headlines alone:

{"summary": "3-4 sentences", "watch": ["what a shareholder should watch next"], "items": [...]}"""


def provider_status() -> Dict[str, Any]:
    """What the news section will run on, for the UI to say so up front."""
    provider = llm_provider.available()
    return {
        "provider": provider,
        "interpreted": provider is not None,
        "note": (
            "Ranked and explained by " + ("Gemini" if provider == "gemini" else "Claude")
            if provider else
            "No model key set, so items are ranked by keyword and not explained. "
            "A free Gemini key from aistudio.google.com adds that."
        ),
    }


def _numbered(headlines: List[Dict[str, Any]]) -> str:
    lines = []
    for i, h in enumerate(headlines):
        when = f", {h['published']}" if h.get("published") else ""
        lines.append(f"[{i}] {h['symbol']}{when} — {h['headline']} ({h.get('source') or 'unknown'})")
    return "\n".join(lines)


def _apply_judgements(headlines: List[Dict[str, Any]],
                      judgements: Any) -> List[Dict[str, Any]]:
    """Merge the model's verdicts onto the headlines it was given.

    Keyed by the index handed out, so a hallucinated headline has nowhere to
    attach: anything whose id is unknown is discarded, and any headline the
    model did not rate is simply left out.
    """
    out: List[Dict[str, Any]] = []
    for judgement in (judgements or []):
        if not isinstance(judgement, dict):
            continue
        try:
            index = int(judgement.get("id"))
        except (TypeError, ValueError):
            continue
        if not 0 <= index < len(headlines):
            continue

        level = str(judgement.get("materiality") or "").lower()
        item = dict(headlines[index])
        item.update({
            "materiality": level if level in MATERIALITY else "medium",
            "direction": str(judgement.get("direction") or "unclear").lower(),
            "impact": str(judgement.get("impact") or "").strip(),
            "summary": "",
        })
        out.append(item)

    order = {level: i for i, level in enumerate(MATERIALITY)}
    out.sort(key=lambda i: order.get(i["materiality"], 1))
    return out


def portfolio_news(holdings: List[Dict[str, Any]],
                   window_days: int = DEFAULT_WINDOW_DAYS) -> Dict[str, Any]:
    """Material news across every holding, most important first."""
    status = provider_status()
    if not holdings:
        return {"items": [], "covered": 0, "holdings": 0,
                "window_days": window_days, **status}

    by_symbol = news_sources.fetch_for_holdings(holdings, window_days, per_stock=6)
    headlines = [h for entries in by_symbol.values() for h in entries]

    if not headlines:
        return {"items": [], "covered": 0, "holdings": len(holdings),
                "window_days": window_days, **status}

    if not status["interpreted"]:
        items = news_sources.rank_without_model(by_symbol)
    else:
        result = llm_provider.ask_for_json(
            _RULES,
            f"Headlines from the last {window_days} days:\n\n{_numbered(headlines)}\n\n"
            f"Return the JSON described in your instructions.")
        items = _apply_judgements(headlines, result.get("items"))

    return {
        "items": items,
        "covered": len({i["symbol"] for i in items}),
        "holdings": len(holdings),
        "fetched": len(headlines),
        "window_days": window_days,
        **status,
    }


def stock_news(symbol: str, company_name: str, country: str,
               window_days: int = 30) -> Dict[str, Any]:
    """A deeper read on one holding."""
    status = provider_status()
    headlines = news_sources.fetch_headlines(symbol, company_name, country,
                                             window_days, limit=14)
    base = {"symbol": symbol.strip().upper(), "summary": "", "watch": [],
            "window_days": window_days, **status}

    if not headlines:
        return {**base, "items": []}

    if not status["interpreted"]:
        return {**base, "items": news_sources.rank_without_model({symbol: headlines})}

    result = llm_provider.ask_for_json(
        _RULES + _STOCK_EXTRA,
        f"The stock is {symbol} ({company_name or symbol}).\n\n"
        f"Headlines from the last {window_days} days:\n\n{_numbered(headlines)}\n\n"
        f"Return the JSON described in your instructions.")

    return {
        **base,
        "summary": str(result.get("summary") or "").strip(),
        "watch": [str(w).strip() for w in (result.get("watch") or []) if str(w).strip()],
        "items": _apply_judgements(headlines, result.get("items")),
    }
