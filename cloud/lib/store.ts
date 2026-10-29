// The published tables, with the lookups backend/main.py makes against SQLite.
//
// Row order matters: the laptop's pages list things in whatever order SQLite
// returns them, which for an unordered query depends on the index the planner
// picks. Each lookup below reproduces that order and says why, so the website
// lists accounts, portfolios and holdings exactly as the laptop does.
import type { Row, Snapshot } from "./snapshot.ts";

export type R = Row & Record<string, any>;

export class Store {
  constructor(readonly snapshot: Snapshot) {}

  table(name: string): R[] {
    return (this.snapshot.tables[name] ?? []) as R[];
  }

  user(id: string): R | undefined {
    return this.table("users").find((u) => u.id === id);
  }

  /** Full scan, so rowid order (no index on user_id). */
  accountsOf(userId: string): R[] {
    return this.table("accounts").filter((a) => a.user_id === userId);
  }

  accountOf(userId: string, accountId: string): R | undefined {
    return this.table("accounts").find((a) => a.id === accountId && a.user_id === userId);
  }

  /** Full scan, rowid order. */
  holdingsIn(accountIds: string[]): R[] {
    const wanted = new Set(accountIds);
    return this.table("holdings").filter((h) => wanted.has(h.account_id));
  }

  /** Served by the unique (user_id, name) index, so ordered by name. */
  portfoliosOf(userId: string): R[] {
    return byKeys(this.table("portfolios").filter((p) => p.user_id === userId), (p) => [p.name]);
  }

  portfolioOf(userId: string, portfolioId: string): R | undefined {
    return this.table("portfolios").find((p) => p.id === portfolioId && p.user_id === userId);
  }

  /** portfolio.account_links: read through the (portfolio_id, account_id)
   *  primary-key index, so ordered by account id. Links to a deleted account
   *  are skipped, as `if link.account` does. */
  portfolioAccounts(portfolioId: string): R[] {
    const accounts = new Map(this.table("accounts").map((a) => [a.id, a]));
    return byKeys(this.table("portfolio_accounts").filter((l) => l.portfolio_id === portfolioId), (l) => [l.account_id])
      .map((l) => accounts.get(l.account_id))
      .filter((a): a is R => a !== undefined);
  }

  /** Served by the unique (user_id, symbol, country) index. */
  watchOf(userId: string): R[] {
    return byKeys(this.table("watch_stocks").filter((w) => w.user_id === userId), (w) => [w.symbol, w.country]);
  }

  targetsOf(userId: string): R[] {
    return this.table("target_portfolios").filter((t) => t.user_id === userId);
  }

  /** target.rules: full scan of target_rules, rowid order. */
  rulesOf(targetId: string): R[] {
    return this.table("target_rules").filter((r) => r.target_id === targetId);
  }
}

/** SQLite's BINARY collation order over one or more columns; stable. */
export function byKeys<T>(rows: T[], keys: (row: T) => unknown[]): T[] {
  return [...rows].sort((a, b) => compareTuples(keys(a), keys(b)));
}

/** SQLite ordering of values: NULL first, then numbers, then text by code unit. */
export function compareValues(a: unknown, b: unknown): number {
  const rank = (v: unknown) => (v === null || v === undefined ? 0 : typeof v === "number" ? 1 : 2);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (rank(a) === 0) return 0;
  if (typeof a === "number") return a - (b as number);
  const x = String(a), y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function compareTuples(a: unknown[], b: unknown[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const c = compareValues(a[i], b[i]);
    if (c !== 0) return c;
  }
  return 0;
}
