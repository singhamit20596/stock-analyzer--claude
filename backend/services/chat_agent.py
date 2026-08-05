"""Portfolio assistant: answers questions about the holdings, and searches the web.

The whole portfolio is ~65 rows, so it is assembled into one context block and
cached rather than embedded and retrieved. Vector search over this much data
would only add a way to miss the row that matters — full context is both simpler
and more accurate here. The block is the stable prefix of every request, so a
cache breakpoint sits at its end and follow-up turns re-read it cheaply.

Live prices are NOT fetched here. The context carries whatever the portfolio
endpoints last computed, and the model is told to use its web-search tool when a
question needs a price fresher than that.
"""
import os
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

MODEL = "claude-opus-5"
MAX_TOKENS = 16000

# Claude Opus 5 declines some requests outright (HTTP 200 with this stop
# reason). Fall back rather than surfacing a dead end to the user.
FALLBACK_BETA = "server-side-fallback-2026-07-01"

SYSTEM_RULES = """\
You are the assistant built into this user's personal stock-portfolio app. You \
answer questions about their actual holdings, and you search the web when a \
question needs information the portfolio data does not contain.

How to work:
- The portfolio context below is the authoritative record of what they hold. \
Prefer it over anything you recall or find online about their positions.
- Use the web search tool for anything time-sensitive or external: current \
prices, earnings dates, management guidance, analyst views, news. The prices in \
the context were captured when the page last loaded and may be stale.
- Cite sources with links when you use search results.
- All portfolio values are in INR. US positions are converted at the rate given \
below. Show both when it aids understanding.

Being accurate about what you do and don't know:
- `first_seen_at` is when a stock first appeared in an OCR import into this app. \
It is NOT the purchase date. Treat it as a lower bound on the holding period and \
say so plainly — "held for at least X, since that's when this app first saw it" \
— never as the date they bought.
- The app stores no transaction history, so realised gains, cost-basis lots, and \
actual purchase dates are unavailable. Say so rather than estimating them.
- If a figure isn't in the context and you can't find it, say you don't know.

On price expectations:
- Report what management actually guided and what analysts have published, each \
attributed to its source, before offering any view of your own.
- You may then give your own estimate with the reasoning behind it. Label it \
clearly as your own reasoning rather than a sourced figure, and give the \
assumptions it depends on.
- Add a brief note that this is analysis, not financial advice, and that you are \
not a licensed advisor. Say it once, at the end — do not repeat it in every \
paragraph.

Style: answer directly and concisely. Lead with the number or the answer, then \
the supporting detail. Use a compact table when comparing several holdings. \
Skip preamble.\
"""


def _money(value: Optional[float]) -> str:
    if value is None:
        return "—"
    return f"₹{value:,.0f}"


def build_context(snapshot: Dict[str, Any]) -> str:
    """Renders the portfolio into the stable, cacheable prefix of the prompt."""
    lines: List[str] = []
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    lines.append(f"# Portfolio context (as of {today})\n")

    lines.append("## What this app tracks")
    lines.append(
        "Holdings imported from broker screenshots via OCR, across several "
        "accounts in two markets (IND = India/NSE, US). It records quantity, "
        "average buy price, and a live-ish market price per position, plus a "
        "cash wallet balance per account. It does NOT record transactions, "
        "purchase dates, or realised gains."
    )
    lines.append(
        "Each stock carries a user-assigned sector (Financials, Healthcare, "
        "Datacentre, CapitalMarket, AI, Software, Semiconductor, Others) and "
        "section (Hyperscalers = the largest global companies; Satellite = "
        "small, high-risk/high-reward; regular = everything else). These are "
        "the user's own taxonomy, not a standard one like GICS.\n"
    )

    fx = snapshot.get("usd_inr_rate")
    if fx:
        lines.append(f"USD/INR conversion rate in use: {fx}\n")

    summary = snapshot.get("summary") or {}
    if summary:
        lines.append("## Totals (INR)")
        for label, key in (
            ("Invested", "total_invested_inr"),
            ("Current value", "total_current_inr"),
            ("Unrealised P&L", "total_pnl_inr"),
            ("Cash / wallet", "total_wallet_inr"),
        ):
            lines.append(f"- {label}: {_money(summary.get(key))}")
        if summary.get("total_pnl_percent") is not None:
            lines.append(f"- P&L %: {summary['total_pnl_percent']}%")
        for label, key in (("Invested : cash", "invested_to_cash_ratio"),
                           ("US : India", "us_to_ind_ratio")):
            if summary.get(key):
                lines.append(f"- {label}: {summary[key]}")
        for market, key in (("India", "ind_metrics"), ("US", "us_metrics")):
            m = summary.get(key) or {}
            if m:
                lines.append(
                    f"- {market}: invested {_money(m.get('invested'))}, "
                    f"current {_money(m.get('current'))}, "
                    f"P&L {_money(m.get('pnl'))} ({m.get('pnl_percent')}%), "
                    f"cash {_money(m.get('wallet'))}"
                )
        lines.append("")

    accounts = snapshot.get("accounts") or []
    if accounts:
        lines.append("## Accounts")
        for a in accounts:
            lines.append(
                f"- {a['name']} ({a.get('currency_type', 'IND')}), "
                f"wallet {_money(a.get('wallet_balance_inr'))}"
            )
        lines.append("")

    rows = snapshot.get("holdings") or []
    if rows:
        lines.append(f"## Holdings ({len(rows)} positions)")
        lines.append(
            "| Symbol | Company | Mkt | Sector | Section | Qty | Avg (INR) | "
            "Price (INR) | Value (INR) | P&L (INR) | P&L % | First seen |"
        )
        lines.append("|---|---|---|---|---|---|---|---|---|---|---|---|")
        for r in rows:
            lines.append(
                f"| {r['symbol']} | {r.get('company_name', '')} | {r.get('country', '')} "
                f"| {r.get('sector', '')} | {r.get('section', '')} "
                f"| {r.get('quantity', 0):g} | {r.get('avg_buy_price_inr', 0):,.2f} "
                f"| {r.get('current_price_inr', 0):,.2f} | {r.get('current_value_inr', 0):,.0f} "
                f"| {r.get('pnl_inr', 0):,.0f} | {r.get('pnl_percent', 0)}% "
                f"| {r.get('first_seen_at') or 'unknown'} |"
            )
        lines.append("")
        lines.append(
            "`First seen` is the first OCR import that included the stock — a "
            "lower bound on the holding period, not the purchase date.\n"
        )

    targets = snapshot.get("targets") or []
    if targets:
        lines.append("## Target portfolios")
        for t in targets:
            lines.append(
                f"- {t['name']}: India {t.get('ind_percent')}% / US "
                f"{t.get('us_percent')}%, cash {t.get('ind_cash_percent')}% IND "
                f"and {t.get('us_cash_percent')}% US"
            )
            for market, dims in (t.get("rules") or {}).items():
                for dimension, entries in (dims or {}).items():
                    if entries:
                        pretty = ", ".join(f"{k} {v}%" for k, v in entries.items())
                        lines.append(f"    - {market} {dimension}: {pretty}")
        lines.append("")

    watch = snapshot.get("watchlist") or []
    if watch:
        lines.append("## Watch list (tracked, not held)")
        for w in watch:
            lines.append(
                f"- {w['symbol']} ({w.get('country')}, {w.get('sector')}, "
                f"{w.get('section')})"
            )
        lines.append("")

    return "\n".join(lines)


def _client():
    try:
        import anthropic
    except ImportError as exc:
        raise RuntimeError(
            "The `anthropic` package is not installed. Run: "
            "backend/venv/bin/pip install anthropic"
        ) from exc

    # A bare client also picks up an `ant auth login` profile, so only reject
    # when there is no credential of any kind.
    if not (os.environ.get("ANTHROPIC_API_KEY")
            or os.environ.get("ANTHROPIC_AUTH_TOKEN")
            or os.path.isdir(os.path.expanduser("~/.config/anthropic"))):
        raise RuntimeError(
            "No Anthropic credentials found. Set ANTHROPIC_API_KEY in the "
            "environment before starting the server."
        )
    return anthropic.Anthropic()


def _blocks_to_param(content) -> List[Dict[str, Any]]:
    """Response content -> the shape the next request's history expects."""
    return [b.model_dump(exclude_none=True) if hasattr(b, "model_dump") else b
            for b in content]


def ask(messages: List[Dict[str, Any]], snapshot: Dict[str, Any]) -> Dict[str, Any]:
    """One assistant turn. `messages` is the prior conversation plus the new question."""
    client = _client()
    context = build_context(snapshot)

    system = [
        {"type": "text", "text": SYSTEM_RULES},
        # Breakpoint at the end of the portfolio block: it is identical across
        # turns, so every follow-up reads it from cache.
        {"type": "text", "text": context, "cache_control": {"type": "ephemeral"}},
    ]
    tools = [{"type": "web_search_20260209", "name": "web_search", "max_uses": 8}]

    history = list(messages)
    searches: List[str] = []
    text_parts: List[str] = []

    # Refusal fallback is worth having but is a beta an account may not carry.
    # Probe once; if the request is rejected for that reason, drop it and carry
    # on rather than failing the whole feature.
    use_fallbacks = True

    def send(msgs):
        nonlocal use_fallbacks
        extra = ({"betas": [FALLBACK_BETA], "fallbacks": "default"}
                 if use_fallbacks else {})
        # Streaming keeps a long web-search turn from hitting the HTTP timeout.
        try:
            with client.beta.messages.stream(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=system,
                tools=tools,
                thinking={"type": "adaptive"},
                output_config={"effort": "high"},
                messages=msgs,
                **extra,
            ) as stream:
                return stream.get_final_message()
        except Exception as exc:
            if use_fallbacks and "fallback" in str(exc).lower():
                use_fallbacks = False
                return send(msgs)
            raise

    # Server-side tools pause the turn when they hit their internal iteration
    # limit; re-sending the assistant turn resumes it where it left off.
    for _ in range(5):
        response = send(history)

        for block in response.content:
            if block.type == "text":
                text_parts.append(block.text)
            elif block.type == "server_tool_use" and block.name == "web_search":
                query = (block.input or {}).get("query")
                if query:
                    searches.append(query)

        if response.stop_reason == "refusal":
            return {
                "reply": "I can't answer that one — the request was declined.",
                "searches": searches,
                "refused": True,
            }
        if response.stop_reason != "pause_turn":
            break

        history = history + [{"role": "assistant", "content": _blocks_to_param(response.content)}]

    reply = "\n\n".join(t for t in text_parts if t.strip())
    return {
        "reply": reply or "I wasn't able to produce an answer for that.",
        "searches": searches,
        "refused": False,
    }
