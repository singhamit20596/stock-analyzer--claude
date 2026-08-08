"""Schema changes `create_all` cannot make on its own.

`Base.metadata.create_all` builds missing tables but never alters existing
ones, so a database created before logins existed needs both new columns and,
in three cases, a rebuilt table: portfolio names, target names and watch-list
symbols were declared globally unique, which would stop two users from having a
portfolio called "Family IND".

Every step checks the current shape first, so running this repeatedly is safe.
"""
from sqlalchemy import inspect, text

# table -> column -> DDL fragment
ADDED_COLUMNS = {
    "accounts": {"user_id": "VARCHAR"},
    "portfolios": {"user_id": "VARCHAR"},
    "target_portfolios": {"user_id": "VARCHAR"},
    "watch_stocks": {"user_id": "VARCHAR"},
}

# Tables whose uniqueness must become per-user. SQLite cannot drop a constraint,
# so each is rebuilt: create the new shape, copy the rows, swap the names.
REBUILDS = {
    "portfolios": {
        "columns": "id, user_id, name, created_at",
        "ddl": """
            CREATE TABLE portfolios_new (
                id VARCHAR NOT NULL PRIMARY KEY,
                user_id VARCHAR,
                name VARCHAR NOT NULL,
                created_at DATETIME,
                CONSTRAINT uq_portfolio_user_name UNIQUE (user_id, name)
            )
        """,
    },
    "target_portfolios": {
        "columns": ("id, user_id, name, ind_percent, ind_cash_percent, "
                    "us_cash_percent, created_at"),
        "ddl": """
            CREATE TABLE target_portfolios_new (
                id VARCHAR NOT NULL PRIMARY KEY,
                user_id VARCHAR,
                name VARCHAR NOT NULL,
                ind_percent FLOAT,
                ind_cash_percent FLOAT,
                us_cash_percent FLOAT,
                created_at DATETIME,
                CONSTRAINT uq_target_user_name UNIQUE (user_id, name)
            )
        """,
    },
    "watch_stocks": {
        "columns": ("id, user_id, symbol, company_name, country, sector, "
                    "section, created_at"),
        "ddl": """
            CREATE TABLE watch_stocks_new (
                id VARCHAR NOT NULL PRIMARY KEY,
                user_id VARCHAR,
                symbol VARCHAR NOT NULL,
                company_name VARCHAR NOT NULL,
                country VARCHAR,
                sector VARCHAR,
                section VARCHAR,
                created_at DATETIME,
                CONSTRAINT uq_watch_user_symbol_country UNIQUE (user_id, symbol, country)
            )
        """,
    },
}


def _columns(connection, table: str) -> set:
    return {row[1] for row in connection.exec_driver_sql(f"PRAGMA table_info({table})")}


def _table_exists(connection, table: str) -> bool:
    found = connection.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()
    return found is not None


def _needs_rebuild(connection, table: str) -> bool:
    """True while the table still carries a unique index that ignores user_id.

    `origin` distinguishes a UNIQUE constraint ("u") from the primary key's own
    index ("pk"). The primary key is on `id` alone and always will be, so
    counting it would make the rebuild look necessary on every start.
    """
    for row in connection.exec_driver_sql(f"PRAGMA index_list({table})"):
        name, unique, origin = row[1], row[2], row[3]
        if not unique or origin == "pk":
            continue
        indexed = {r[2] for r in connection.exec_driver_sql(f"PRAGMA index_info({name})")}
        if "user_id" not in indexed:
            return True
    return False


def run(engine) -> dict:
    """Bring an existing database up to the current models. Returns what it did."""
    performed = {"columns_added": [], "tables_rebuilt": []}

    with engine.begin() as connection:
        for table, columns in ADDED_COLUMNS.items():
            if not _table_exists(connection, table):
                continue
            existing = _columns(connection, table)
            for column, ddl in columns.items():
                if column not in existing:
                    connection.exec_driver_sql(
                        f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
                    performed["columns_added"].append(f"{table}.{column}")

    # Rebuilds run in their own transaction, after the columns they copy exist.
    for table, spec in REBUILDS.items():
        with engine.begin() as connection:
            if not _table_exists(connection, table) or not _needs_rebuild(connection, table):
                continue
            connection.exec_driver_sql(spec["ddl"])
            connection.exec_driver_sql(
                f"INSERT INTO {table}_new ({spec['columns']}) "
                f"SELECT {spec['columns']} FROM {table}")
            connection.exec_driver_sql(f"DROP TABLE {table}")
            connection.exec_driver_sql(f"ALTER TABLE {table}_new RENAME TO {table}")
            performed["tables_rebuilt"].append(table)

    return performed
