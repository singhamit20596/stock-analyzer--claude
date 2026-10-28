# Cloud deploy (`netlify` branch)

A read-only website over the laptop's data, so the portfolio can be viewed from
anywhere. `main` and the laptop app are unchanged by it.

```
LAPTOP — source of truth, the only place anything is written
  backend/ (FastAPI + SQLite + OCR), started by start.command
  every successful change ──► mirror all tables ──► Netlify Database (Postgres)

NETLIFY — read-only, live
  frontend/ built with VITE_READ_ONLY
  netlify/functions  ── reads the mirror, fetches live prices itself
```

## Publishing (laptop → cloud)

`backend/services/cloud_publish.py`. After any successful POST/PUT/DELETE the
app schedules a publish two seconds later (bursts collapse into one), on a
background thread, after the response has already gone back.

- **Full mirror, not a diff.** The database is a few hundred rows, so rewriting
  it costs well under a second and cannot drift — deletions and hand repairs
  arrive with no change tracking to miss them.
- **Atomic.** One transaction; a failure halfway leaves the previous mirror
  intact. Tested by poisoning a row after an earlier table had been rewritten.
- **Never breaks a save.** Offline or failing, the local save still succeeds;
  the publish is marked pending and retried on the next change and at startup.
- **Off until configured.** Without `~/.stocks-analyzer/cloud.env` every call
  is a no-op and the app behaves exactly as it did.

`~/.stocks-analyzer/cloud.env` holds `CLOUD_DATABASE_URL` — a credential with
write access, so it lives outside the repo (public) and outside iCloud Drive.

`GET /api/cloud/status` reports whether the cloud is current;
`POST /api/cloud/publish` publishes immediately and returns the error if any.

## The cloud schema

`netlify/database/migrations/` — applied by Netlify on deploy. Mirrors
`backend/models.py` column for column, except: timestamps stay TEXT (no
timezone reinterpretation, the bug class behind the Groww IST fix), no foreign
keys (integrity is enforced on the laptop), and three cloud-only tables the
website writes itself: `user_sessions`, `login_attempts`, `publish_state`.

## Local tooling

The laptop has Node 20; `@netlify/database` and netlify-cli 27 need Node 22+.
`scripts/netlify.sh` runs the CLI under Node 22 via npx without installing
either system-wide. npm installs hang on this iCloud path, so cloud work is
staged in `/private/tmp/sa-cloud` the same way the frontend build is.

## Status

- [x] Schema, verified against real Postgres (PGlite)
- [x] Laptop publisher + middleware, tested end to end
- [ ] Provider probe from Netlify's servers (`/api/_probe`)
- [ ] Cloud auth: same password hashes, registration closed, rate-limited login
- [ ] Read API ported to TypeScript, diff-tested against the Python
- [ ] Read-only frontend build
