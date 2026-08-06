# Stocks Analyzer

Personal multi-account stock portfolio tracker. Runs entirely on localhost — no
deployment, no auth, single user. FastAPI serves both the API and the built
React frontend from one origin.

**Run it:** `./start.command` (creates the venv, installs deps, rebuilds the
frontend if sources changed, opens http://127.0.0.1:8080).

## Layout

```
backend/
  main.py                 all HTTP endpoints
  models.py               SQLAlchemy models -> portfolio.db (SQLite, committed)
  schemas.py              pydantic request bodies
  services/
    symbols.py            ticker resolution — the ONLY place ticker maps live
    quote_service.py      live prices (Groww for NSE, Google/Yahoo for US) + FX
    history_source.py     daily closes: Groww / Nasdaq / Frankfurter
    history_engine.py     portfolio value series vs benchmarks
    portfolio_engine.py   cross-account aggregation, all output in INR
    target_engine.py      target-vs-actual diff
    taxonomy.py           the sector/section vocabulary
    chat_agent.py         the AI assistant (Claude Opus 5 + web search)
    ocr_engine.py         screenshot -> holdings (RapidOCR)
frontend/src/components/  one file per tab
```

## Things that will bite you

**Everything is INR.** US positions convert at the live USD/INR rate. Both
`avg_buy_price` and `current_price` must be converted — converting only one
inflates US P&L by ~95x. This was a real bug; don't reintroduce it.

**Quotes are keyed by `(symbol, country)`, never symbol alone.** The same ticker
can exist in both markets.

**`portfolio.db` is committed to git**, so the repo contains real holdings. The
GitHub repo (`singhamit20596/stock-analyzer--claude`) is public.

**Saving holdings deletes and re-inserts rows.** Anything user-owned —
`sector`, `section`, `first_seen_at` — must be carried across by symbol in
`verify_and_save_holdings`, or the user's manual edits are silently wiped.

**`first_seen_at` is not a purchase date.** It's when a stock first appeared in
an OCR import. Treat it as a lower bound on the holding period. There is no
transaction history, so realised gains and cost-basis lots are unavailable.

**`npm run build` takes 2-3 minutes** on this iCloud Drive path, and hangs
outright if two builds overlap. Run one at a time; `pkill -f "vite build"` if a
build appears stuck at 0% CPU (that's blocked I/O, not a compile error).

**Yahoo Finance rate-limits this IP hard** (429 on every ticker). That's why
history comes from Groww + Nasdaq + Frankfurter instead. Groww also emits a
Sunday-stamped daily candle that isn't a real session — weekends are filtered
out in `history_engine`.

## Taxonomy (user-defined, not GICS)

Sectors: Financials, Healthcare, Datacentre, CapitalMarket, AI, Software,
Semiconductor, Others. **No Indian stock belongs in AI.**

Sections: `Hyperscalers` (biggest companies in the world — FAANG + Nvidia),
`Satellite` (small, high risk / high reward), `regular` (everything else).

Both are editable per stock in the Classification tab and are user-owned —
never overwrite a value the user has set.

## Target rebalancing

A target declares an India:US split, a cash ratio per market, and sector/section
splits within each market. **India is compared on sectors, the US on sections.**
Per-stock targets inside a bucket are equal-weighted.

## The assistant (`/api/chat`)

Needs `ANTHROPIC_API_KEY` in the environment; returns a clear 503 without it.
Model is `claude-opus-5` with the server-side `web_search` tool.

The whole portfolio (~65 rows, ~10K chars) is injected as one cached system
block — **not** vector RAG. At this size full context is simpler and more
accurate; retrieval only adds a way to miss the row that matters. Revisit if
holdings grow past a few hundred.

## Stock deep-dive — verified data sources (spike done 2026-08-06)

Planned feature: click a stock row -> full analysis page. **Do not use
`yfinance`.** It is a Yahoo scraper and Yahoo hard-blocks this IP (429 on every
endpoint, verified twice hours apart). Use these instead:

| Need | Source | Notes |
|---|---|---|
| US OHLCV | `api.nasdaq.com/api/quote/{sym}/historical` | already in `history_source.py` |
| US ratios / sector / 52w / analyst target | `api.nasdaq.com/api/quote/{sym}/summary?assetclass=stocks` | `OneYrTarget` is the analyst price target |
| US financials | `api.nasdaq.com/api/company/{sym}/financials?frequency=1` | income statement, balance sheet, cash flow, ratios |
| IND OHLCV | Groww charting v1 | already in `history_source.py`; returns `changePerc` free |
| IND fundamentals | `screener.in/company/{SYMBOL}/` | HTML scrape — see parsing note below |
| IND company info | `api.tickertape.in/stocks/info/{sid}` | `sid` from `api.tickertape.in/search?text={sym}&types=stock` |

Dead ends already tried: NSE official API (403), Groww `accord_points`
(502/404), tickertape `financials`/`ratios` (400/404, undocumented params).

**screener.in parsing:** ratios live in `<ul id="top-ratios">`, and the value
span is `class="nowrap value"` — matching on `class="value"` finds nothing.
Quarterly results are in `<section id="quarters">`. `High / Low` holds two
numbers in one span; take both.

Design decisions from the plan review:
- Lead the page with **the user's own position** (units, avg cost, P&L, % of
  portfolio, sector/section, target-bucket drift). That's the part a generic
  stock site cannot show and the reason to open the page.
- **No computed BUY/HOLD/SELL badge.** Show indicators as inputs and hand off to
  the assistant, which cites sources and carries the not-advice note.
- ETFs (VOO, QQQM, SOXX, ITBEES, NIFTYIETF) have no P/E, ROE, EPS or quarterly
  results — they need a separate variant, not empty ratio cards.
- 1D/5D need intraday data the daily endpoints do not serve; cap the range at
  5Y (Groww's window will not reach 10Y reliably).
- Cache fundamentals 6-24h, as `history_source` does.

## Conventions

- Comments explain *why*, not what. Don't narrate the code.
- Frontend charts are hand-written SVG (`AllocationPie`, `PerformanceChart`) —
  there is deliberately no charting dependency.
- `frontend/dist/` is committed so `start.command` works without npm.
