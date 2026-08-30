# Stocks Analyzer

Personal multi-account stock portfolio tracker. Runs entirely on localhost — no
deployment. FastAPI serves both the API and the built React frontend from one
origin. Multi-user since logins were added: see "Logins and ownership".

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
    stock_detail.py       one instrument: candles, ratios, quarterly, technicals
    position_engine.py    the user's own holding in one instrument
frontend/src/components/  one file per tab
frontend/src/components/stock/  the deep-dive page, one file per section
```

## Things that will bite you

**Everything is INR.** US positions convert at the live USD/INR rate. Both
`avg_buy_price` and `current_price` must be converted — converting only one
inflates US P&L by ~95x. This was a real bug; don't reintroduce it.

**Quotes are keyed by `(symbol, country)`, never symbol alone.** The same ticker
can exist in both markets.

**`portfolio.db` is NOT in git** — `.gitignore` covers `*.db` and the file has
never been committed. The GitHub repo
(`singhamit20596/stock-analyzer--claude`) is public, so keep it that way: the
database now holds password hashes as well as real holdings. Point the app at a
scratch copy with `STOCKS_DB_PATH=/tmp/whatever.db` rather than editing the
real one to try something out.

**Saving holdings applies a diff, not a replacement.**
`holdings_history.apply_import` compares the incoming snapshot against what is
stored and only touches what moved, so rows keep their id, classification and
`first_seen_at` without anything being carried across by hand. Re-importing the
same screenshot is a no-op and writes nothing.

Every move is logged to `holding_changes` as ADDED / REMOVED / INCREASED /
DECREASED / REPRICED. Imports are broker *snapshots*, not a transaction feed:
two buys between imports look like one increase, and nothing here knows about
individual trades.

**`first_seen_at` is not a purchase date.** It's when a stock first appeared in
an OCR import. Treat it as a lower bound on the holding period. There is no
transaction history, so realised gains and cost-basis lots are unavailable.

**`npm run build` takes 2-3 minutes** on this iCloud Drive path, and hangs
outright if two builds overlap. Run one at a time; `pkill -f "vite build"` if a
build appears stuck at 0% CPU (that's blocked I/O, not a compile error).

**Yahoo Finance rate-limits this IP hard** (429 on every ticker). That's why
history comes from Groww + Nasdaq + Frankfurter instead.

**Groww stamps a daily candle at 00:00 IST, which is 18:30 UTC the day
before.** Read as UTC, every session lands a day early and Monday looks like
Sunday. Both `stock_detail` and `history_source` convert in IST and get a clean
Mon–Fri series; any new reader of a Groww epoch must do the same.

`history_source` read UTC until 2026-08-24. `history_engine` dropped the
resulting "Sunday" candles — really Mondays — so the performance chart was
missing a session a week and every Indian date sat one day left of its US
counterpart on the shared x-axis. Measured on a 1mo window at the time of the
fix: 16 points and no Fridays before, 21 points and a clean Mon–Fri spread
after. The weekday filter in `history_engine` is now only a guard.

## Logins and ownership

Username and password only — no email, no reset flow. **The first account to
register becomes the admin** and claims every ownerless row, which is how the
data that predates logins found an owner. Everyone after that is a normal user
starting empty.

- Passwords: PBKDF2-HMAC-SHA256, 600k iterations, per-user salt
  (`services/auth_engine.py`). Not bcrypt/argon2 only because both are
  compiled dependencies and this path makes installs painful.
- Sessions: a random token, stored **hashed**, 30-day expiry, sent as
  `Authorization: Bearer`.
- `Account`, `Portfolio`, `TargetPortfolio` and `WatchStock` carry `user_id`.
  Everything else hangs off those. **Never query these models directly** —
  use the `_accounts_of` / `_portfolio_or_404` / `_holdings_of` helpers in
  `main.py`, or a forgotten `.filter` becomes a data leak between users.
- Admin "view as" sends `X-View-As: <user_id>`. The `viewer` dependency scopes
  every query to that user and **rejects any non-GET**, so read-only is
  enforced server-side rather than by hiding buttons. It also means the
  assistant (a POST) is unavailable while viewing someone else.
- Portfolio names, target names and watch symbols are unique **per user**.
  Their tables were rebuilt for this — SQLite cannot drop a constraint, so
  `migrations.py` recreates and copies them. That migration is idempotent and
  keyed on whether the unique index already includes `user_id`.

`migrations.py` runs after `create_all` on every start, because `create_all`
adds missing tables but never alters existing ones.

## Reading a holdings screenshot

`ocr_engine` Strategy A reads the INDmoney desktop table, whose row is two
stacked lines: name / market price / invested / current value / P&L on top,
ticker / change% / `qty Qty | $avg Avg.` underneath.

**Column positions are derived from the row, never hard-coded.** The same table
gets captured anywhere from ~840px to ~1600px wide. Absolute pixel windows
matched nothing at the wrong scale and failed *silently*: on a 1600px capture
the market-price window and the avg-price fallback both came up empty, so every
`current_price` was 0 and two of five cost bases were 0. Distances are in
`unit`, the height of the qty box, which scales with the capture.

**The broker prints Invested and Current value, so neither the cost basis nor
the price has to be trusted to OCR alone.** `avg = invested / qty` and
`price = current value / qty`, and a parsed avg that disagrees by more than 1%
is discarded. This is what catches a truncated read: RapidOCR splits
`"$280.91 Avg."` across two boxes often enough that a loose pattern returned
`$280`, which was then stored as a cost basis of 280.00. The avg pattern now
requires two decimals.

**A one-character ticker is a real ticker.** `V`, `F`, `C`. Requiring two
characters dropped VISA Inc. onto the company-name fallback and stored it as
`VISA`; the same path turned VOO into `VANGUARDSP`, which resolves no quote at
any provider, so the position was priced at cost and showed exactly zero P&L.
The row's logo also lands in the ticker band and further left, so candidates are
ranked by alignment with the company name rather than taken in reading order.

**An import is a whole-account snapshot, and a screenshot usually is not.**
`verify-save-holdings?strategy=OVERWRITE` deletes every holding not in the
upload. A long table takes several screenshots, and saving them one at a time
under OVERWRITE deletes the rest of the account each time — on 2026-08-28 this
removed 23 of Ankit's positions, reset `first_seen_at` on the rows that later
came back, and silently dropped a user-set section (TEM's `Satellite`). The
modal defaults to MERGE for that reason. `/api/upload-ocr-images` accepts a list
of files and unions them, so the correct way to OVERWRITE is to upload every
page in one go.

**A zero from OCR means "not read", never "zero".** `deduplicator` guards both
`avg_buy_price` and `current_price` against being overwritten by one; the guard
was missing on avg and a partial read wiped real cost bases (`AMZN 227.35 ->
0.0`), which reports the position as 100% profit.

## Holding history

`holding_changes` is what lets the performance chart value each past day with
the quantities held *then*, via `holdings_history.quantity_reader` →
`history_engine.build_history(..., quantity_at=...)`. Without it the chart
applies today's basket to the whole past, pricing a position bought last week
as though it had been held all year.

**OPENING is not ADDED.** The 92 holdings that predate the log were seeded with
an OPENING event dated `first_seen_at`. OPENING means "already owned, only just
recorded", so the reader carries it *backwards* before that date; ADDED means a
real purchase, so the reader reads zero before it. Treating opening balances as
purchases would show the whole portfolio materialising out of nothing on the
day logging began. `seed_change_log` runs once and refuses to re-seed a
non-empty log.

## Price-change columns (1D/7D/30D/6M/1Y)

`/api/portfolios/{id}/price-changes`, fetched separately from `/detail` so the
table renders before a year of candles per holding has loaded.

**1D uses the live quote when there is one.** The daily endpoints only publish a
row once a session has closed, so comparing the last two candles labels a stale
figure "1D" — on an Indian afternoon the US rows are still on last night's
close. If a live quote differs from the last close, it becomes the measurement
point and 1D reads "since the last close". A quote more than 25% adrift is
treated as a bad scrape and ignored.

Every row carries `as_of` and `reference_date`, and the UI states them, because
the two markets are rarely on the same day.

Two stages, and the split is the design:

1. **`news_sources`** fetches real headlines from **Google News RSS** — free, no
   key, works for NSE and US names. It alone decides what exists.
2. **`llm_provider`** ranks and explains them, but only ever sees headlines that
   were actually fetched, so it cannot invent one. No key → keyword scoring
   stands in and the UI says so.

The model is never asked to *search*. Given real headlines its job is judgement,
which is the part keywords cannot do, and it costs a fraction of a search turn.

**Provider is Gemini first, Anthropic second** (`GEMINI_API_KEY`, free from
aistudio.google.com, or `ANTHROPIC_API_KEY`). Both are plain REST over `httpx` —
no SDK import, deliberately: the venv is on an iCloud path where importing the
Anthropic SDK from cold measured **eleven minutes** against 0.7s warm, which
would land on the user's first click and look like a hang. That SDK is still
warmed in a background thread at startup for the assistant's sake.

RSS needs two filters that are not optional:
- **Relevance.** Google treats a quoted phrase as a hint, not a filter — a
  search for HDFC Bank returned Shriram Properties and sugar stocks. Every
  headline must contain a distinctive word from the company name.
- **13F churn.** A US ticker search floods with "X Boosts Stock Position in
  NVIDIA". Several phrasings; see `NOISE`.

Judgements are merged back by the index handed to the model, so a hallucinated
item has nowhere to attach. `/api/stock/{symbol}/news` is the per-stock dive.

## Daily P&L

`/api/portfolios/{id}/daily` returns the last 30 **sessions**, newest first.

Each day is the **sum of every holding's P&L that day**, computed per stock —
*not* the change in portfolio value. Differencing two portfolio values counts a
day's buying as profit: an eight-position import once read +₹108,323 (+3.42%)
when the real move was +₹19,941 (+0.61%). Per stock, per day:

- shares held the day before → `qty × (close_today − close_yesterday)`
- shares that appeared today → `qty × (close_today − average cost)`, once, then
  carried on the price move afterwards
- shares sold → stop contributing; there is no transaction history, so no
  realised P&L can be booked

The percentage divides by the same base those legs were measured from
(yesterday's close for carried shares, cost for new ones).

Prices come from `stock_detail.fetch_candles`. This predates the IST fix in
`history_source`, which was the reason to avoid it; both read Groww in IST now,
so the two are equivalent on dates and the split is no longer load-bearing.

`portfolio_daily_snapshots` is still written on every portfolio view, because it
is the only record of what the portfolio was *observed* to be worth, but it is
no longer what this table computes from.

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

## Stock deep-dive (built 2026-08-06)

Clicking a stock row anywhere opens `/api/stock/{symbol}/analysis`. The open
stock lives in the query string (`?stock=&country=&portfolio=`) so Back closes
the page; `/api/stock/{symbol}/candles?range=` serves range switches on their
own so a pill click does not refetch the fundamentals.

**Do not use `yfinance`.** It is a Yahoo scraper and Yahoo hard-blocks this IP
(429 on every endpoint, verified twice hours apart). Use these instead:

| Need | Source | Notes |
|---|---|---|
| US OHLCV | `api.nasdaq.com/api/quote/{sym}/historical` | already in `history_source.py` |
| US ratios / sector / 52w / analyst target | `api.nasdaq.com/api/quote/{sym}/summary?assetclass=stocks` | `OneYrTarget` is the analyst price target |
| US financials | `api.nasdaq.com/api/company/{sym}/financials?frequency=1` | income statement, balance sheet, cash flow, ratios |
| US quarterly | same endpoint with `frequency=2` | only 4 quarters, so no year-ago column — the page reports QoQ and says so |
| US company name | `api.nasdaq.com/api/quote/{sym}/info` | the summary endpoint has no name |
| IND OHLCV | Groww charting v1 | already in `history_source.py`; returns `changePerc` free |
| IND fundamentals | `screener.in/company/{SYMBOL}/` | HTML scrape — see parsing note below |
| IND company info | `api.tickertape.in/stocks/info/{sid}` | `sid` from `api.tickertape.in/search?text={sym}&types=stock` |

Dead ends already tried: NSE official API (403), Groww `accord_points`
(502/404), tickertape `financials`/`ratios` (400/404, undocumented params).

**screener.in parsing:** ratios live in `<ul id="top-ratios">`, and the value
span is `class="nowrap value"` — matching on `class="value"` finds nothing.
Quarterly results are in `<section id="quarters">`. `High / Low` holds two
numbers in one span; take both. Every number sits in its own
`<span class="number">`, so reading those is what handles both cases.
Row labels are written `Sales&nbsp;+` — **decode the entities before
matching**, or the revenue and net-profit rows go missing while the others
parse fine. Screener's top line is `Sales` for most companies and `Revenue`
for lenders, whose operating line is `Financing Profit`, not `Operating
Profit`.

**Two unit traps.** Nasdaq's statements are in *thousands* while its market cap
is absolute — divide them without scaling and P/E comes out 1000x too high.
screener's market cap is in *crore*.

**tickertape search is fuzzy.** `?text=MEDANTA` returns Vedanta Ltd with
`match: "SIMILAR"`. Require an exact ticker match or the page shows another
company's name and description.

Design decisions from the plan review:
- Lead the page with **the user's own position** (units, avg cost, P&L, % of
  portfolio, sector/section, target-bucket drift). That's the part a generic
  stock site cannot show and the reason to open the page.
- **No computed BUY/HOLD/SELL badge.** Show indicators as inputs and hand off to
  the assistant, which cites sources and carries the not-advice note.
- ETFs have no P/E, ROE, EPS or quarterly results — they get a "Fund facts"
  variant, not empty ratio cards. The providers do not flag a fund:
  screener.in serves an ordinary company page with every ratio blank, so the
  list is hard-coded as `ETF_SYMBOLS` in `symbols.py` alongside the other
  ticker maps.
- 1D/5D need intraday data the daily endpoints do not serve; cap the range at
  5Y (Groww's window will not reach 10Y reliably).
- Cache fundamentals 6-24h, as `history_source` does.

## Conventions

- Comments explain *why*, not what. Don't narrate the code.
- Portfolio-level charts are hand-written SVG (`AllocationPie`,
  `PerformanceChart`). The one dependency is `lightweight-charts`, used only by
  the deep-dive price chart, where candlesticks with a volume pane and a
  crosshair are not worth hand-rolling.
- `frontend/dist/` is committed so `start.command` works without npm.
