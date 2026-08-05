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

## Conventions

- Comments explain *why*, not what. Don't narrate the code.
- Frontend charts are hand-written SVG (`AllocationPie`, `PerformanceChart`) —
  there is deliberately no charting dependency.
- `frontend/dist/` is committed so `start.command` works without npm.
