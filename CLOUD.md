# Cloud deploy (`netlify` branch)

A read-only website over the laptop's data, so the portfolio can be viewed from
anywhere. `main` and the laptop app are unchanged by it.

```
LAPTOP — source of truth, the only place anything is written
  backend/ (FastAPI + SQLite + OCR), started by start.command
  every successful change ──► encrypted JSON ──► git push to `netlify`

NETLIFY — read-only, live (https://stockview2027.netlify.app)
  each push rebuilds the site (~1 min)
  frontend/ built with VITE_READ_ONLY
  netlify/functions ── decrypt cloud/data/snapshot.json, fetch live prices
```

## The data file

`cloud/data/snapshot.json`. The repository is public, so it is always
encrypted: gzip'd JSON of every mirrored table, sealed with AES-256-GCM. The
key exists in two places only — `~/.stocks-analyzer/cloud.env` on the laptop
(outside the repo and outside iCloud Drive) and the `DATA_KEY` environment
variable on the Netlify site. GCM authenticates, so a wrong key or an edited
file fails to decrypt rather than producing wrong numbers.

The envelope's `digest` is a keyed hash of the content: it lets the laptop skip
publishing unchanged data without revealing anything.

`cloud/test/fixture.json` is encrypted with a test-only key and fake data; the
test proves TypeScript reads exactly what Python wrote.

## Publishing (laptop → cloud)

`backend/services/cloud_publish.py`. After any successful POST/PUT/DELETE the
app schedules a publish two seconds later (bursts collapse into one), on a
background thread, after the response has already gone back.

- **Its own clone.** Publishing commits from `~/.stocks-analyzer/publish-repo`,
  always starting from what GitHub has, so it never touches a working checkout
  and never overwrites code pushed from elsewhere.
- **Full snapshot, not a diff.** A few hundred rows; it cannot drift.
- **Never breaks a save.** Offline or failing, the local save still succeeds;
  the publish is marked pending and retried on the next change and at startup.
- **Off until configured.** Without `~/.stocks-analyzer/cloud.env` every call
  is a no-op and the app behaves exactly as it did.

Costs of this design, accepted: an update takes about a minute to appear (the
rebuild), each one uses about a minute of Netlify's free build allowance
(300/month), and every publish is a commit on this branch.

`GET /api/cloud/status` reports whether the cloud is current;
`POST /api/cloud/publish` publishes immediately and returns the error if any.

## Setup (once)

`scripts/cloud_setup.sh` — creates the key, gives it to Netlify, publishes
once. The key is never printed. Then `/api/health` should report `loaded`.

## Local tooling

The laptop has Node 20; netlify-cli 27 needs Node 22+. `scripts/netlify.sh`
runs the CLI under Node 22 via npx without installing either system-wide.
Work in the `~/stocks-analyzer-netlify` worktree, outside iCloud Drive.
`npm test` runs the cloud tests.

## Status

- [x] Providers answer Netlify's servers (all but Tickertape, which only adds
      company descriptions on Indian stock pages)
- [x] Encrypted publisher, tested end to end against a local git remote
- [x] Website login: same passwords as the laptop, registration closed, 10 failed
      attempts per username per 15 min, signed 30-day sessions that end when the
      password changes on the laptop (cloud/lib/auth.ts)
- [x] Read API batch 1 — accounts, account detail and changes, portfolios,
      portfolio detail, classification, targets and compare, sync logs. Diff
      test against the Python on a copy of the real data with fixed prices:
      33/33 endpoints identical to the last digit (cloud/lib/py.ts reproduces
      Python's rounding; cloud/lib/store.ts reproduces SQLite's row order).
      Live prices from TypeScript match the laptop's (45 stocks).
- [x] Batch 2 — portfolio history, daily P&L, price moves. Diff test with
      recorded provider data: 36/36 endpoints identical (all four ranges, 4
      portfolios). TypeScript fetches match the laptop's for 242 provider calls.
- [x] Batch 3 — stock deep-dive page and candles. Diff test with recorded
      provider data: 89/89 endpoints identical (every held stock, ETFs, a
      stock not held, target tracking, every range). Live fundamentals match
      the laptop on 138/138 calls apart from intraday volume/high-low/market cap.
- [x] Website build hides import/edit controls, the Assistant and Account
      Management tabs, and news (frontend/src/readOnly.js); the API
      already refuses every write.
- Not on the website: news and the assistant (paid model calls), screenshots.
- [ ] Read-only frontend build
