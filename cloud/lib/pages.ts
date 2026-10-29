// The read-only pages, ported from backend/main.py (and the services it
// calls) line for line. Each function names the endpoint it reproduces.
//
// Two deliberate differences from the laptop, both because the website writes
// nothing:
//   * _resolve_sectors fills in missing classifications in memory only. The
//     laptop persists them; the next publish brings its values here.
//   * Viewing a portfolio does not record the day's value
//     (daily_engine.record_snapshot). The laptop keeps that record.
import constants from "../generated/constants.json";
import { fixed, iso, round } from "./py.ts";
import { pairKey, type Pair, type Quotes } from "./quotes.ts";
import { byKeys, compareTuples, compareValues, type R, type Store } from "./store.ts";

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface Viewer {
  account: R;     // who signed in
  user: R;        // whose data is in scope
  impersonating: boolean;
}

export interface Ctx {
  store: Store;
  view: Viewer;
  quotes: Quotes;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

// ── taxonomy.py ──────────────────────────────────────────────────────────────

export const SECTORS = constants.SECTORS;
export const SECTIONS = constants.SECTIONS;
export const DEFAULT_SECTOR = constants.DEFAULT_SECTOR;
export const DEFAULT_SECTION = constants.DEFAULT_SECTION;

export function defaultSector(symbol: string, country: string, scraped = ""): string {
  const sym = (symbol ?? "").trim().toUpperCase();
  const isIndia = (country || "IND").toUpperCase() === "IND";
  const sector = (constants.SYMBOL_SECTOR as Record<string, string>)[sym]
    || (constants.SCRAPED_SECTOR as Record<string, string>)[scraped || ""];
  if (!sector) return DEFAULT_SECTOR;
  if (isIndia && constants.INDIA_FORBIDDEN_SECTORS.includes(sector)) return "Software";
  return sector;
}

export const defaultSection = (symbol: string) =>
  (constants.SYMBOL_SECTION as Record<string, string>)[(symbol ?? "").trim().toUpperCase()] || DEFAULT_SECTION;

// ── portfolio_engine.py ──────────────────────────────────────────────────────

export const accountCurrency = (account: R | undefined) =>
  account !== undefined && account.currency_type === "US" ? "USD" : "INR";

const countryOfAccount = (account: R | undefined) => (accountCurrency(account) === "USD" ? "US" : "IND");

export function aggregateHoldings(accounts: R[], holdings: R[], live: Map<string, number>, usdInr: number) {
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const grouped = new Map<string, any>();

  for (const holding of holdings) {
    const symbol = String(holding.symbol).toUpperCase();
    const account = accountMap.get(holding.account_id);
    const currency = accountCurrency(account);
    const country = currency === "USD" ? "US" : "IND";
    const toInr = currency === "USD" ? usdInr : 1.0;

    let nativePrice = live.get(pairKey(symbol, country)) ?? 0;
    if (nativePrice <= 0) nativePrice = holding.current_price || holding.avg_buy_price || 0;

    const quantity = Number(holding.quantity);
    const avgInr = Number(holding.avg_buy_price) * toInr;
    const priceInr = nativePrice * toInr;

    const key = `${symbol}|${currency}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        symbol, company_name: holding.company_name || symbol, country, currency,
        total_quantity: 0, total_invested_inr: 0, current_price_inr: priceInr, accounts_breakdown: [],
      });
    }
    const row = grouped.get(key);
    const investedInr = quantity * avgInr;
    row.total_quantity += quantity;
    row.total_invested_inr += investedInr;
    row.current_price_inr = priceInr;
    if (holding.company_name && holding.company_name.length > row.company_name.length) {
      row.company_name = holding.company_name;
    }
    row.accounts_breakdown.push({
      account_id: holding.account_id,
      account_name: account ? account.name : "Unknown",
      currency_type: account ? account.currency_type : "IND",
      quantity: round(quantity, 4),
      avg_buy_price: round(Number(holding.avg_buy_price), 2),
      avg_buy_price_inr: round(avgInr, 2),
      invested_inr: round(investedInr, 2),
      current_value_inr: round(quantity * priceInr, 2),
    });
  }

  const items: any[] = [];
  let totalInvested = 0;
  let totalCurrent = 0;
  for (const row of grouped.values()) {
    const quantity = row.total_quantity;
    const invested = row.total_invested_inr;
    const current = quantity * row.current_price_inr;
    const pnl = current - invested;
    totalInvested += invested;
    totalCurrent += current;
    items.push({
      symbol: row.symbol,
      company_name: row.company_name,
      country: row.country,
      currency: row.currency,
      total_quantity: round(quantity, 4),
      wacp_inr: quantity > 0 ? round(invested / quantity, 2) : 0.0,
      current_price_inr: round(row.current_price_inr, 2),
      total_invested_inr: round(invested, 2),
      current_value_inr: round(current, 2),
      pnl_inr: round(pnl, 2),
      pnl_percent: invested > 0 ? round((pnl / invested) * 100.0, 2) : 0.0,
      accounts_breakdown: row.accounts_breakdown,
    });
  }
  for (const item of items) {
    item.allocation_percent = totalCurrent > 0 ? round((item.current_value_inr / totalCurrent) * 100.0, 2) : 0.0;
  }
  items.sort((a, b) => b.current_value_inr - a.current_value_inr);

  const totalPnl = totalCurrent - totalInvested;
  return {
    summary: {
      total_invested_inr: round(totalInvested, 2),
      current_value_inr: round(totalCurrent, 2),
      total_pnl_inr: round(totalPnl, 2),
      total_pnl_percent: totalInvested > 0 ? round((totalPnl / totalInvested) * 100.0, 2) : 0.0,
      total_stocks_count: items.length,
    },
    items,
  };
}

// ── shared helpers in main.py ────────────────────────────────────────────────

/** _price_quotes */
export async function priceQuotes(ctx: Ctx, accounts: R[], holdings: R[]) {
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const pairs: Pair[] = holdings.filter((h) => h.symbol).map((h) => [
    String(h.symbol).trim().toUpperCase(), countryOfAccount(accountMap.get(h.account_id)),
  ]);
  const [live, usdInr] = await Promise.all([ctx.quotes.prices(pairs), ctx.quotes.usdInr()]);
  return { live, usdInr };
}

type Klass = { sector: string; section: string };

/** _resolve_sectors, without the writes: see the note at the top. */
export async function resolveSectors(ctx: Ctx, holdings: R[]): Promise<Map<string, Klass>> {
  const rows = holdings.map((h) => ({ ...h }));
  const unclassified = rows.filter((h) => !h.sector);
  if (unclassified.length) {
    const scraped = await ctx.quotes.sectors(unclassified.map((h) => [h.symbol, h.country || "IND"] as Pair));
    for (const h of unclassified) {
      const country = h.country || "IND";
      const raw = scraped.get(pairKey(String(h.symbol).trim().toUpperCase(), country)) ?? "";
      h.sector = defaultSector(h.symbol, country, raw);
      if (!h.section) h.section = defaultSection(h.symbol);
    }
  }
  for (const h of rows) if (!h.section) h.section = defaultSection(h.symbol);

  const grouped = new Map<string, R[]>();
  for (const h of rows) {
    const key = pairKey(String(h.symbol).trim().toUpperCase(), h.country || "IND");
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(h);
  }
  const agree = (group: R[], field: string, fallback: string) => {
    const values = group.map((r) => r[field]).filter(Boolean);
    if (!values.length) return fallback;
    return values.find((v) => v !== fallback) ?? values[0];
  };
  const resolved = new Map<string, Klass>();
  for (const [key, group] of grouped) {
    resolved.set(key, { sector: agree(group, "sector", DEFAULT_SECTOR), section: agree(group, "section", DEFAULT_SECTION) });
  }
  return resolved;
}

// ── /api/accounts ────────────────────────────────────────────────────────────

const accountResponse = (a: R) => ({
  name: a.name,
  currency_type: a.currency_type,
  wallet_balance: a.wallet_balance,
  id: a.id,
  created_at: iso(a.created_at),
  last_synced_at: iso(a.last_synced_at),
  latest_screenshot_path: a.latest_screenshot_path,
});

export const listAccounts = (ctx: Ctx) => ctx.store.accountsOf(ctx.view.user.id).map(accountResponse);

function accountOr404(ctx: Ctx, accountId: string): R {
  const account = ctx.store.accountOf(ctx.view.user.id, accountId);
  if (!account) throw new HttpError(404, "Account not found");
  return account;
}

/** holdings_history._event_payload */
const eventPayload = (e: R) => ({
  id: e.id,
  account_id: e.account_id,
  symbol: e.symbol,
  company_name: e.company_name,
  country: e.country,
  change_type: e.change_type,
  quantity_before: round(e.quantity_before || 0.0, 4),
  quantity_after: round(e.quantity_after || 0.0, 4),
  quantity_delta: round((e.quantity_after || 0.0) - (e.quantity_before || 0.0), 4),
  avg_price_before: e.avg_price_before,
  avg_price_after: e.avg_price_after,
  changed_at: iso(e.changed_at),
});

/** holdings_history.recent_changes. SQLite reads these through the
 *  account_id index (account id, then rowid) and then sorts by changed_at
 *  descending; its sort keeps ties in that order. */
export function recentChanges(store: Store, accountIds: string[], limit = 100) {
  if (!accountIds.length) return [];
  const wanted = new Set(accountIds);
  const scanned = byKeys(store.table("holding_changes").map((row, rowid) => ({ row, rowid }))
    .filter(({ row }) => wanted.has(row.account_id)), ({ row, rowid }) => [row.account_id, rowid]);
  scanned.sort((a, b) => compareValues(b.row.changed_at, a.row.changed_at));
  return scanned.slice(0, limit).map(({ row }) => eventPayload(row));
}

export function accountChanges(ctx: Ctx, accountId: string, limit: number) {
  accountOr404(ctx, accountId);
  return { account_id: accountId, changes: recentChanges(ctx.store, [accountId], limit) };
}

export async function accountDetail(ctx: Ctx, accountId: string) {
  const acc = accountOr404(ctx, accountId);
  const holdings = ctx.store.holdingsIn([accountId]);
  const { live, usdInr } = await priceQuotes(ctx, [acc], holdings);

  const isUs = acc.currency_type === "US";
  const country = isUs ? "US" : "IND";
  const sectors = await resolveSectors(ctx, holdings);

  const items: any[] = [];
  let totalInvested = 0;
  let totalCurrent = 0;
  for (const h of holdings) {
    const key = pairKey(String(h.symbol).trim().toUpperCase(), country);
    let price = live.get(key) ?? 0;
    if (price <= 0) price = h.current_price || h.avg_buy_price || 0;

    const invested = round(h.quantity * h.avg_buy_price, 2);
    const current = round(h.quantity * price, 2);
    const pnl = round(current - invested, 2);
    totalInvested += invested;
    totalCurrent += current;

    const item: any = {
      id: h.id,
      symbol: h.symbol,
      company_name: h.company_name,
      sector: sectors.get(key)?.sector ?? "",
      section: sectors.get(key)?.section ?? "",
      quantity: round(h.quantity, 4),
      avg_buy_price: round(h.avg_buy_price, 2),
      live_current_price: round(price, 2),
      invested_value: invested,
      current_value: current,
      pnl,
      pnl_percent: invested > 0 ? round((pnl / invested) * 100, 2) : 0.0,
    };
    if (isUs) {
      Object.assign(item, {
        invested_value_inr: round(invested * usdInr, 2),
        current_value_inr: round(current * usdInr, 2),
        pnl_inr: round(pnl * usdInr, 2),
      });
    }
    items.push(item);
  }
  items.sort((a, b) => b.current_value - a.current_value);

  const totalPnl = round(totalCurrent - totalInvested, 2);
  const wallet = acc.wallet_balance || 0.0;
  const summary: any = {
    invested_value: round(totalInvested, 2),
    current_value: round(totalCurrent, 2),
    holding_count: items.length,
    pnl: totalPnl,
    pnl_percent: totalInvested > 0 ? round((totalPnl / totalInvested) * 100, 2) : 0.0,
    currency_type: acc.currency_type,
    currency_symbol: isUs ? "$" : "₹",
    wallet_balance: round(wallet, 2),
  };
  if (isUs) {
    Object.assign(summary, {
      usd_to_inr_rate: usdInr,
      invested_value_inr: round(totalInvested * usdInr, 2),
      current_value_inr: round(totalCurrent * usdInr, 2),
      pnl_inr: round(totalPnl * usdInr, 2),
      wallet_balance_inr: round(wallet * usdInr, 2),
    });
  }
  return {
    account_id: acc.id,
    account_name: acc.name,
    currency_type: acc.currency_type,
    wallet_balance: round(wallet, 2),
    // Screenshots stay on the laptop; the website never has the file.
    has_screenshot: false,
    last_synced_at: iso(acc.last_synced_at),
    summary,
    items,
  };
}

// ── /api/portfolios ──────────────────────────────────────────────────────────

export function listPortfolios(ctx: Ctx) {
  return ctx.store.portfoliosOf(ctx.view.user.id).map((p) => {
    const accounts = ctx.store.portfolioAccounts(p.id);
    return {
      id: p.id,
      name: p.name,
      created_at: iso(p.created_at),
      account_ids: accounts.map((a) => a.id),
      account_names: accounts.map((a) => a.name),
      account_count: accounts.length,
    };
  });
}

export function portfolioOr404(ctx: Ctx, portfolioId: string): R {
  const portfolio = ctx.store.portfolioOf(ctx.view.user.id, portfolioId);
  if (!portfolio) throw new HttpError(404, "Portfolio not found");
  return portfolio;
}

/** _split */
function split(a: number, b: number): string {
  const total = a + b;
  if (total <= 0) return "—";
  return `${fixed((a / total) * 100, 0)}% : ${fixed((b / total) * 100, 0)}%`;
}

export async function portfolioDetail(ctx: Ctx, portfolioId: string) {
  const portfolio = portfolioOr404(ctx, portfolioId);
  const accounts = ctx.store.portfolioAccounts(portfolioId);
  const holdings = accounts.length ? ctx.store.holdingsIn(accounts.map((a) => a.id)) : [];

  const { live, usdInr } = await priceQuotes(ctx, accounts, holdings);
  const aggregated = aggregateHoldings(accounts, holdings, live, usdInr);
  const sectors = await resolveSectors(ctx, holdings);

  const rows = aggregated.items.map((item: any) => {
    const perAccount: Record<string, any> = {};
    for (const entry of item.accounts_breakdown) {
      const bucket = (perAccount[entry.account_id] ??= { qty: 0, _cost_inr: 0, _cost_native: 0 });
      bucket.qty += entry.quantity;
      bucket._cost_inr += entry.quantity * entry.avg_buy_price_inr;
      bucket._cost_native += entry.quantity * entry.avg_buy_price;
    }
    for (const id of Object.keys(perAccount)) {
      const { qty, _cost_inr: costInr, _cost_native: costNative } = perAccount[id];
      perAccount[id] = {
        qty: round(qty, 4),
        avg_inr: qty > 0 ? round(costInr / qty, 2) : 0.0,
        avg_native: qty > 0 ? round(costNative / qty, 2) : 0.0,
      };
    }
    const klass = sectors.get(pairKey(item.symbol.trim().toUpperCase(), item.country));
    return {
      symbol: item.symbol,
      company_name: item.company_name,
      country: item.country,
      currency: item.currency,
      sector: klass?.sector ?? "",
      section: klass?.section ?? "",
      per_account: perAccount,
      mkt_price_inr: item.current_price_inr,
      portfolio_qty: item.total_quantity,
      portfolio_avg_inr: item.wacp_inr,
      invested_value_inr: item.total_invested_inr,
      current_value_inr: item.current_value_inr,
      pnl_inr: item.pnl_inr,
      pnl_percent: item.pnl_percent,
      allocation_percent: item.allocation_percent,
    };
  });

  const totalWallet = sum(accounts.map((a) => (a.wallet_balance || 0.0) * (a.currency_type === "US" ? usdInr : 1.0)));
  const summary = aggregated.summary;
  const invested = summary.total_invested_inr;
  const current = summary.current_value_inr;

  const ratio = (a: number, b: number) => {
    if (b <= 0) return a <= 0 ? "—" : "100% : 0%";
    return `${fixed(a / b, 2)} : 1`;
  };

  const usCurrent = sum(rows.filter((r) => r.country === "US").map((r) => r.current_value_inr));
  const usWallet = sum(accounts.filter((a) => a.currency_type === "US").map((a) => (a.wallet_balance || 0.0) * usdInr));
  const usTotal = usCurrent + usWallet;
  const indCurrent = sum(rows.filter((r) => r.country === "IND").map((r) => r.current_value_inr));
  const indWallet = sum(accounts.filter((a) => a.currency_type === "IND").map((a) => a.wallet_balance || 0.0));
  const indTotal = indCurrent + indWallet;

  const usInvested = sum(rows.filter((r) => r.country === "US").map((r) => r.invested_value_inr));
  const usPnl = usCurrent - usInvested;
  const usPnlPct = usInvested > 0 ? (usPnl / usInvested) * 100 : 0.0;
  const indInvested = sum(rows.filter((r) => r.country === "IND").map((r) => r.invested_value_inr));
  const indPnl = indCurrent - indInvested;
  const indPnlPct = indInvested > 0 ? (indPnl / indInvested) * 100 : 0.0;

  return {
    portfolio_id: portfolio.id,
    portfolio_name: portfolio.name,
    usd_inr_rate: usdInr,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, currency_type: a.currency_type })),
    summary: {
      total_invested_inr: invested,
      total_current_inr: current,
      total_pnl_inr: summary.total_pnl_inr,
      total_pnl_percent: summary.total_pnl_percent,
      total_wallet_inr: round(totalWallet, 2),
      total_stocks: summary.total_stocks_count,
      invested_to_cash_ratio: ratio(invested, totalWallet),
      invested_to_cash_split: split(invested, totalWallet),
      us_to_ind_ratio: ratio(usTotal, indTotal),
      us_to_ind_split: split(usTotal, indTotal),
      us_total_inr: round(usTotal, 2),
      ind_total_inr: round(indTotal, 2),
      us_metrics: { invested: usInvested, current: usCurrent, pnl: usPnl, pnl_percent: round(usPnlPct, 2), wallet: usWallet },
      ind_metrics: { invested: indInvested, current: indCurrent, pnl: indPnl, pnl_percent: round(indPnlPct, 2), wallet: indWallet },
    },
    rows,
  };
}

// ── /api/classification ──────────────────────────────────────────────────────

export async function classification(ctx: Ctx) {
  const accountsList = ctx.store.accountsOf(ctx.view.user.id);
  const holdings = ctx.store.holdingsIn(accountsList.map((a) => a.id));
  const classified = await resolveSectors(ctx, holdings);
  const accounts = new Map(accountsList.map((a) => [a.id, a.name]));

  const bySymbol = new Map<string, any>();
  for (const h of holdings) {
    const symbol = String(h.symbol).trim().toUpperCase();
    const country = h.country || "IND";
    const key = pairKey(symbol, country);
    let row = bySymbol.get(key);
    if (!row) {
      const meta = classified.get(key);
      row = {
        symbol, company_name: h.company_name, country,
        sector: meta?.sector || DEFAULT_SECTOR,
        section: meta?.section || DEFAULT_SECTION,
        quantity: 0, accounts: [] as string[], held: true,
      };
      bySymbol.set(key, row);
    }
    row.quantity += h.quantity;
    const name = accounts.get(h.account_id);
    if (name && !row.accounts.includes(name)) row.accounts.push(name);
  }

  for (const w of ctx.store.watchOf(ctx.view.user.id)) {
    const symbol = String(w.symbol).trim().toUpperCase();
    const country = w.country || "IND";
    const key = pairKey(symbol, country);
    if (bySymbol.has(key)) continue;
    bySymbol.set(key, {
      symbol, company_name: w.company_name || symbol, country,
      sector: w.sector || DEFAULT_SECTOR, section: w.section || DEFAULT_SECTION,
      quantity: 0, accounts: [], held: false,
    });
  }

  const rows = [...bySymbol.values()].sort((a, b) => compareTuples([a.sector, a.section, a.symbol], [b.sector, b.section, b.symbol]));
  for (const r of rows) r.quantity = round(r.quantity, 4);
  return {
    sectors: SECTORS,
    sections: SECTIONS,
    account_names: [...accounts.values()].sort((a, b) => compareValues(a, b)),
    rows,
  };
}

// ── /api/targets ─────────────────────────────────────────────────────────────

function rulesTree(ctx: Ctx, targetId: string) {
  const rules: Record<string, Record<string, Record<string, number>>> = {
    IND: { sector: {}, section: {} },
    US: { sector: {}, section: {} },
  };
  for (const r of ctx.store.rulesOf(targetId)) {
    if (rules[r.market] && rules[r.market][r.dimension]) rules[r.market][r.dimension][r.key] = r.percent;
  }
  return rules;
}

const targetPayload = (ctx: Ctx, t: R) => ({
  id: t.id,
  name: t.name,
  ind_percent: t.ind_percent,
  us_percent: round(100.0 - (t.ind_percent || 0.0), 2),
  ind_cash_percent: t.ind_cash_percent,
  us_cash_percent: t.us_cash_percent,
  rules: rulesTree(ctx, t.id),
});

export function listTargets(ctx: Ctx) {
  const targets = byKeys(ctx.store.targetsOf(ctx.view.user.id), (t) => [t.name]);
  return { sectors: SECTORS, sections: SECTIONS, targets: targets.map((t) => targetPayload(ctx, t)) };
}

function targetOr404(ctx: Ctx, targetId: string): R {
  const target = ctx.store.targetsOf(ctx.view.user.id).find((t) => t.id === targetId);
  if (!target) throw new HttpError(404, "Target not found");
  return target;
}

// target_engine.py
const MARKET_DIMENSION: Record<string, string> = { IND: "sector", US: "section" };
const keyOf = (row: any, dimension: string) => row[dimension] || (dimension === "sector" ? DEFAULT_SECTOR : DEFAULT_SECTION);

function bucket(rows: any[], market: string, dimension: string) {
  const totals = new Map<string, number>();
  for (const r of rows) {
    if (r.country !== market) continue;
    const key = keyOf(r, dimension);
    totals.set(key, (totals.get(key) ?? 0) + r.current_value_inr);
  }
  return totals;
}

function stocksInBucket(rows: any[], market: string, dimension: string, key: string, bucketTarget: number | null) {
  const members = rows.filter((r) => r.country === market && keyOf(r, dimension) === key);
  if (!members.length) return [];
  const bucketCurrent = sum(members.map((r) => r.current_value_inr));
  const perStock = bucketTarget !== null ? bucketTarget / members.length : null;
  return [...members].sort((a, b) => -a.current_value_inr - -b.current_value_inr).map((r) => {
    const current = r.current_value_inr;
    const share = bucketCurrent > 0 ? (current / bucketCurrent) * 100 : 0.0;
    const entry: any = {
      symbol: r.symbol, company_name: r.company_name,
      current_inr: round(current, 2), current_percent: round(share, 2),
      target_percent: null, target_inr: null, delta_inr: null,
    };
    if (perStock !== null) {
      entry.target_percent = round(100.0 / members.length, 2);
      entry.target_inr = round(perStock, 2);
      entry.delta_inr = round(current - perStock, 2);
    }
    return entry;
  });
}

function lines(actual: Map<string, number>, targetPct: Record<string, number>, investedTotal: number) {
  const keys = [...new Set([...actual.keys(), ...Object.keys(targetPct)])].sort((a, b) => compareValues(a, b));
  return keys.map((key) => {
    const current = round(actual.get(key) ?? 0.0, 2);
    const tgt = key in targetPct ? targetPct[key] : null;
    const currentPct = investedTotal > 0 ? (current / investedTotal) * 100 : 0.0;
    const row: any = {
      key, current_inr: current, current_percent: round(currentPct, 2),
      target_percent: tgt === null ? null : round(tgt, 2),
      target_inr: null, delta_inr: null, delta_percent: null,
    };
    if (tgt !== null) {
      const targetInr = (investedTotal * tgt) / 100;
      row.target_inr = round(targetInr, 2);
      row.delta_inr = round(current - targetInr, 2);
      row.delta_percent = round(currentPct - tgt, 2);
    }
    return row;
  });
}

export function compareTarget(ctx: Ctx, target: R, rows: any[], wallet: Record<string, number>) {
  const invested: Record<string, number> = {};
  for (const m of ["IND", "US"]) invested[m] = sum(rows.filter((r) => r.country === m).map((r) => r.current_value_inr));
  const money: Record<string, number> = {};
  for (const m of ["IND", "US"]) money[m] = invested[m] + (wallet[m] ?? 0.0);
  const totalMoney = money.IND + money.US;

  const indTarget = target.ind_percent || 0.0;
  const market = ([["IND", indTarget], ["US", 100.0 - indTarget]] as [string, number][]).map(([m, tgt]) => {
    const current = money[m];
    const currentPct = totalMoney > 0 ? (current / totalMoney) * 100 : 0.0;
    const targetInr = (totalMoney * tgt) / 100;
    return {
      key: m, current_inr: round(current, 2), current_percent: round(currentPct, 2),
      target_percent: round(tgt, 2), target_inr: round(targetInr, 2),
      delta_inr: round(current - targetInr, 2), delta_percent: round(currentPct - tgt, 2),
    };
  });

  const cashTargets: Record<string, number> = { IND: target.ind_cash_percent || 0.0, US: target.us_cash_percent || 0.0 };
  const cash = ["IND", "US"].map((m) => {
    const c = wallet[m] ?? 0.0;
    const tgt = cashTargets[m];
    const currentPct = money[m] > 0 ? (c / money[m]) * 100 : 0.0;
    const targetInr = (money[m] * tgt) / 100;
    return {
      key: m, current_inr: round(c, 2), current_percent: round(currentPct, 2),
      target_percent: round(tgt, 2), target_inr: round(targetInr, 2),
      delta_inr: round(c - targetInr, 2), delta_percent: round(currentPct - tgt, 2),
    };
  });

  const rules = rulesTree(ctx, target.id);
  const breakdown: Record<string, any> = {};
  for (const m of ["IND", "US"]) {
    const dimension = MARKET_DIMENSION[m];
    const ls = lines(bucket(rows, m, dimension), rules[m][dimension], invested[m]);
    for (const line of ls) line.stocks = stocksInBucket(rows, m, dimension, line.key, line.target_inr);
    breakdown[m] = { dimension, lines: ls };
  }

  return {
    target_id: target.id,
    target_name: target.name,
    total_money_inr: round(totalMoney, 2),
    invested_inr: { IND: round(invested.IND, 2), US: round(invested.US, 2) },
    cash_inr: { IND: round(wallet.IND ?? 0.0, 2), US: round(wallet.US ?? 0.0, 2) },
    market,
    cash,
    breakdown,
  };
}

export async function compareTargetPage(ctx: Ctx, targetId: string, portfolioId: string) {
  const target = targetOr404(ctx, targetId);
  const detail = await portfolioDetail(ctx, portfolioId);
  const ids = new Set(detail.accounts.map((a) => a.id));
  // An unscoped query on accounts: full scan, rowid order.
  const accounts = ctx.store.table("accounts").filter((a) => ids.has(a.id));
  const usdInr = detail.usd_inr_rate;
  const wallet: Record<string, number> = { IND: 0.0, US: 0.0 };
  for (const a of accounts) {
    const isUs = a.currency_type === "US";
    wallet[isUs ? "US" : "IND"] += (a.wallet_balance || 0.0) * (isUs ? usdInr : 1.0);
  }
  return { ...compareTarget(ctx, target, detail.rows, wallet), portfolio_id: portfolioId, portfolio_name: detail.portfolio_name };
}

// ── /api/sync-logs ───────────────────────────────────────────────────────────

export function syncLogs(ctx: Ctx) {
  const names = new Map(ctx.store.accountsOf(ctx.view.user.id).map((a) => [a.id, a.name]));
  if (!names.size) return [];
  const logs = ctx.store.table("sync_logs").filter((l) => names.has(l.account_id));
  logs.sort((a, b) => compareValues(b.synced_at, a.synced_at));
  return logs.slice(0, 50).map((log) => ({
    id: log.id,
    account_id: log.account_id,
    account_name: names.get(log.account_id) ?? "Deleted account",
    status: log.status,
    holdings_count: log.holdings_count,
    synced_at: iso(log.synced_at),
  }));
}
