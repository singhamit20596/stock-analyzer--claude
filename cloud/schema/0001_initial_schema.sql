-- The cloud copy of the laptop's SQLite database.
--
-- The laptop is the source of truth. After every change it rewrites the
-- mirrored tables below in a single transaction, so this schema follows
-- backend/models.py column for column and the ported read code sees the same
-- shapes the Python does. Three deliberate differences:
--
--   * Timestamps are TEXT, holding exactly the naive-UTC strings SQLite stores
--     ("2026-08-06 16:43:24.160901"). A TIMESTAMP column would hand the driver
--     a value it then reinterprets in some timezone, and an off-by-a-day date
--     is the bug this project has already paid for once (Groww candles read as
--     UTC instead of IST). Text in, the same text out.
--
--   * No foreign keys. Integrity is enforced where the data is written, on the
--     laptop; here a constraint could only make a faithful mirror fail.
--
--   * Three tables exist only in the cloud and are never mirrored, because
--     the website writes them itself: user_sessions (its own logins),
--     login_attempts (rate limiting) and publish_state (when the laptop last
--     published, shown on the site).

-- ── mirrored from the laptop ────────────────────────────────────────────────

CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL,
    created_at    TEXT
);

CREATE TABLE accounts (
    id                     TEXT PRIMARY KEY,
    name                   TEXT NOT NULL,
    currency_type          TEXT DEFAULT 'IND',
    created_at             TEXT,
    last_synced_at         TEXT,
    wallet_balance         DOUBLE PRECISION DEFAULT 0.0,
    latest_screenshot_path TEXT,
    user_id                TEXT
);

CREATE TABLE holdings (
    id               TEXT PRIMARY KEY,
    account_id       TEXT NOT NULL,
    symbol           TEXT NOT NULL,
    company_name     TEXT,
    quantity         DOUBLE PRECISION NOT NULL,
    avg_buy_price    DOUBLE PRECISION NOT NULL,
    current_price    DOUBLE PRECISION,
    -- SQLite declares BOOLEAN but stores 0/1, and the Python writes 1.
    is_user_verified INTEGER,
    updated_at       TEXT,
    country          TEXT DEFAULT 'IND',
    currency         TEXT DEFAULT 'INR',
    sector           TEXT,
    section          TEXT,
    first_seen_at    TEXT
);
CREATE INDEX ix_holdings_account_id ON holdings (account_id);

CREATE TABLE holding_changes (
    id               TEXT PRIMARY KEY,
    account_id       TEXT NOT NULL,
    symbol           TEXT NOT NULL,
    company_name     TEXT,
    country          TEXT,
    change_type      TEXT NOT NULL,
    quantity_before  DOUBLE PRECISION,
    quantity_after   DOUBLE PRECISION,
    avg_price_before DOUBLE PRECISION,
    avg_price_after  DOUBLE PRECISION,
    changed_at       TEXT
);
CREATE INDEX ix_holding_changes_account_id ON holding_changes (account_id);
CREATE INDEX ix_holding_changes_changed_at ON holding_changes (changed_at);
CREATE INDEX ix_holding_changes_symbol     ON holding_changes (symbol);

CREATE TABLE portfolios (
    id         TEXT PRIMARY KEY,
    user_id    TEXT,
    name       TEXT NOT NULL,
    created_at TEXT,
    CONSTRAINT uq_portfolio_user_name UNIQUE (user_id, name)
);

CREATE TABLE portfolio_accounts (
    portfolio_id TEXT NOT NULL,
    account_id   TEXT NOT NULL,
    PRIMARY KEY (portfolio_id, account_id)
);

CREATE TABLE portfolio_daily_snapshots (
    id                TEXT PRIMARY KEY,
    portfolio_id      TEXT NOT NULL,
    snapshot_date     TEXT NOT NULL,
    invested_inr      DOUBLE PRECISION NOT NULL,
    current_value_inr DOUBLE PRECISION NOT NULL,
    recorded_at       TEXT,
    CONSTRAINT uq_snapshot_portfolio_day UNIQUE (portfolio_id, snapshot_date)
);

CREATE TABLE target_portfolios (
    id               TEXT PRIMARY KEY,
    user_id          TEXT,
    name             TEXT NOT NULL,
    ind_percent      DOUBLE PRECISION,
    ind_cash_percent DOUBLE PRECISION,
    us_cash_percent  DOUBLE PRECISION,
    created_at       TEXT,
    CONSTRAINT uq_target_user_name UNIQUE (user_id, name)
);

CREATE TABLE target_rules (
    id        TEXT PRIMARY KEY,
    target_id TEXT NOT NULL,
    market    TEXT NOT NULL,
    dimension TEXT NOT NULL,
    "key"     TEXT NOT NULL,
    percent   DOUBLE PRECISION NOT NULL
);

CREATE TABLE watch_stocks (
    id           TEXT PRIMARY KEY,
    user_id      TEXT,
    symbol       TEXT NOT NULL,
    company_name TEXT NOT NULL,
    country      TEXT,
    sector       TEXT,
    section      TEXT,
    created_at   TEXT,
    CONSTRAINT uq_watch_user_symbol_country UNIQUE (user_id, symbol, country)
);

CREATE TABLE sync_logs (
    id             TEXT PRIMARY KEY,
    account_id     TEXT,
    status         TEXT NOT NULL,
    message        TEXT,
    created_at     TEXT,
    holdings_count INTEGER DEFAULT 0,
    error_message  TEXT,
    synced_at      TEXT
);

-- ── written by the website itself, never mirrored ───────────────────────────

CREATE TABLE user_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    created_at TEXT,
    expires_at TEXT NOT NULL
);

-- One row per failed login, pruned as it ages out of the window. Keyed by both
-- username and client address, so guessing one account from many addresses
-- and many accounts from one address are each throttled.
CREATE TABLE login_attempts (
    id           BIGSERIAL PRIMARY KEY,
    username     TEXT NOT NULL,
    client_ip    TEXT NOT NULL,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_login_attempts_username ON login_attempts (username, attempted_at);
CREATE INDEX ix_login_attempts_ip       ON login_attempts (client_ip, attempted_at);

-- A single row the laptop writes at the end of every publish, inside the same
-- transaction, so "data as of" on the site is exactly as fresh as the data.
CREATE TABLE publish_state (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    published_at TIMESTAMPTZ NOT NULL,
    source       TEXT,
    row_counts   JSONB
);
