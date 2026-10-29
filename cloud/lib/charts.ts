// The chart pages, ported from history_engine.py, daily_engine.py,
// price_moves.py and the change-log readers in holdings_history.py.
import { fixed, round } from "./py.ts";
import { addDays, laptopToday, RANGE_DAYS, utcToday, weekday, type Candle, type Market, type Series } from "./market.ts";
import { pairKey, resolveQuoteSymbol, type Pair, type Quotes } from "./quotes.ts";
import { accountCurrency, portfolioOr404, type Ctx } from "./pages.ts";
import { byKeys, compareTuples, compareValues, type R, type Store } from "./store.ts";

export interface ChartCtx extends Ctx {
  market: Market;
}

const OPENING = "OPENING";
const QUANTITY_EPSILON = 1e-6;

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Like the laptop's thread pools: at most `limit` provider calls at once,
 *  which is also what keeps Nasdaq from refusing a burst. */
async function pooled<T, U>(items: T[], limit: number, work: (item: T) => Promise<U>): Promise<U[]> {
  const out: U[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]);
    }
  }));
  return out;
}
const asDate = (value: unknown) => String(value).slice(0, 10);

// ── holdings_history ─────────────────────────────────────────────────────────

/** The change log for these accounts, oldest first. SQLite reads it through
 *  the account_id index (account, then rowid) and sorts on changed_at, keeping
 *  ties in that order. */
function changeLog(store: Store, accountIds: string[]): R[] {
  const wanted = new Set(accountIds);
  const scanned = byKeys(store.table("holding_changes").map((row, rowid) => ({ row, rowid }))
    .filter(({ row }) => wanted.has(row.account_id)), ({ row, rowid }) => [row.account_id, rowid]);
  scanned.sort((a, b) => compareValues(a.row.changed_at, b.row.changed_at));
  return scanned.map(({ row }) => row);
}

export interface Flow { day: string; symbol: string; country: string; quantity_delta: number; cost_delta: number }

/** holdings_history.flow_events */
export function flowEvents(store: Store, accountIds: string[]): Flow[] {
  if (!accountIds.length) return [];
  const merged = new Map<string, Flow>();
  for (const event of changeLog(store, accountIds)) {
    if (event.change_type === OPENING) continue;
    const before = event.quantity_before || 0.0;
    const after = event.quantity_after || 0.0;
    const delta = after - before;
    if (Math.abs(delta) <= QUANTITY_EPSILON) continue;
    const day = asDate(event.changed_at);
    const symbol = String(event.symbol).trim().toUpperCase();
    const country = String(event.country || "IND").toUpperCase();
    const key = `${day}|${symbol}|${country}`;
    if (!merged.has(key)) merged.set(key, { day, symbol, country, quantity_delta: 0, cost_delta: 0 });
    const row = merged.get(key)!;
    row.quantity_delta += delta;
    row.cost_delta += after * (event.avg_price_after || 0.0) - before * (event.avg_price_before || 0.0);
  }
  return [...merged.values()].sort((a, b) => compareTuples([a.day, a.symbol], [b.day, b.symbol]));
}

/** bisect_right */
function bisectRight(sorted: string[], value: string): number {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (value < sorted[mid]) hi = mid; else lo = mid + 1;
  }
  return lo;
}

export type QuantityAt = (symbol: string, country: string, day: string, fallback: number) => number;

/** holdings_history.quantity_reader(...).at */
export function quantityReader(store: Store, accountIds: string[]): QuantityAt {
  const timeline = new Map<string, [string, number][]>();
  const preHistory = new Map<string, number>();
  if (accountIds.length) {
    const byAccount = new Map<string, Map<string, number>>();
    const opened = new Set<string>();
    for (const event of changeLog(store, accountIds)) {
      const key = pairKey(String(event.symbol).trim().toUpperCase(), String(event.country || "IND").toUpperCase());
      if (!byAccount.has(key)) byAccount.set(key, new Map());
      const holders = byAccount.get(key)!;
      const accountKey = `${event.account_id}|${key}`;
      if (!opened.has(accountKey)) {
        opened.add(accountKey);
        if (event.change_type === OPENING) preHistory.set(key, (preHistory.get(key) ?? 0.0) + (event.quantity_after || 0.0));
      }
      holders.set(event.account_id, event.quantity_after || 0.0);
      const total = sum([...holders.values()]);
      const day = asDate(event.changed_at);
      if (!timeline.has(key)) timeline.set(key, []);
      const entries = timeline.get(key)!;
      if (entries.length && entries[entries.length - 1][0] === day) entries[entries.length - 1] = [day, total];
      else entries.push([day, total]);
    }
  }
  const days = new Map([...timeline].map(([k, entries]) => [k, entries.map(([d]) => d)]));
  return (symbol, country, day, fallback = 0.0) => {
    const key = pairKey(symbol.trim().toUpperCase(), (country || "IND").toUpperCase());
    const entries = timeline.get(key);
    if (!entries || !entries.length) return fallback;
    const index = bisectRight(days.get(key)!, day);
    if (index === 0) return preHistory.get(key) ?? 0.0;
    return entries[index - 1][1];
  };
}

// ── main.py helpers ──────────────────────────────────────────────────────────

const countryOf = (accounts: Map<string, R>, h: R) => (accountCurrency(accounts.get(h.account_id)) === "USD" ? "US" : "IND");

/** _holding_rows_for_history */
function holdingRowsForHistory(ctx: Ctx, accounts: R[]) {
  const map = new Map(accounts.map((a) => [a.id, a]));
  const holdings = accounts.length ? ctx.store.holdingsIn(accounts.map((a) => a.id)) : [];
  return holdings.map((h) => ({ symbol: h.symbol, quantity: h.quantity, country: countryOf(map, h) }));
}

/** _positions_for_pnl */
function positionsForPnl(ctx: Ctx, accounts: R[]) {
  const map = new Map(accounts.map((a) => [a.id, a]));
  if (!map.size) return [];
  const totals = new Map<string, { symbol: string; country: string; quantity: number; cost: number }>();
  for (const h of ctx.store.holdingsIn([...map.keys()])) {
    const symbol = String(h.symbol || "").trim().toUpperCase();
    if (!symbol || !h.quantity) continue;
    const country = countryOf(map, h);
    const key = pairKey(symbol, country);
    if (!totals.has(key)) totals.set(key, { symbol, country, quantity: 0, cost: 0 });
    const bucket = totals.get(key)!;
    bucket.quantity += Number(h.quantity);
    bucket.cost += Number(h.quantity) * Number(h.avg_buy_price || 0.0);
  }
  return [...totals.values()].map((b) => ({
    symbol: b.symbol,
    country: b.country,
    quantity: round(b.quantity, 6),
    avg_cost_native: b.quantity ? round(b.cost / b.quantity, 4) : 0.0,
  }));
}

// ── history_engine ───────────────────────────────────────────────────────────

const BENCHMARK_LABELS: [string, string][] = [["nifty50", "Nifty 50"], ["nasdaq", "Nasdaq Composite"], ["sp500", "S&P 500"]];

function forwardFill(series: Series, dates: string[]): Series {
  const out: Series = {};
  let last: number | null = null;
  for (const day of dates) {
    if (day in series) last = series[day];
    if (last !== null) out[day] = last;
  }
  return out;
}

function chainLinked(values: number[], flows: Map<string, number>, dates: string[]): (number | null)[] {
  const out: (number | null)[] = [];
  let level: number | null = null;
  dates.forEach((day, i) => {
    const value = values[i];
    if (level === null) {
      level = value > 0 ? 100.0 : null;
      out.push(level !== null ? round(level, 3) : null);
      return;
    }
    const previous = values[i - 1];
    if (previous > 0) level *= 1 + ((value - (flows.get(day) ?? 0.0)) / previous - 1);
    out.push(round(level, 3));
  });
  return out;
}

function indexed(values: number[]): (number | null)[] {
  const base = values.find((v) => v && v > 0) ?? 0.0;
  if (base <= 0) return values.map(() => null);
  return values.map((v) => (v && v > 0 ? round((v / base) * 100, 3) : null));
}

async function fetchHoldingHistories(market: Market, pairs: Pair[], days: number) {
  const seen = new Map<string, Pair>();
  for (const [s, c] of pairs) if (s && s.trim()) seen.set(pairKey(s.trim().toUpperCase(), (c || "IND").toUpperCase()), [s.trim().toUpperCase(), (c || "IND").toUpperCase()]);
  const out = new Map<string, Series>();
  await pooled([...seen.entries()], 10, async ([key, [symbol, country]]) => {
    const resolved = resolveQuoteSymbol(symbol);
    out.set(key, await (country === "US" ? market.nasdaqDaily(resolved, days) : market.growwDaily(resolved, days)).catch(() => ({})));
  });
  return out;
}

export async function buildHistory(market: Market, quotes: Quotes, holdings: { symbol: string; country: string; quantity: number }[],
                                   rangeIn: string, quantityAt?: QuantityAt, flows?: Flow[]) {
  let range = rangeIn;
  let days = RANGE_DAYS[range];
  if (days === undefined) { range = "3mo"; days = RANGE_DAYS["3mo"]; }

  const quantities = new Map<string, number>();
  const keys = new Map<string, Pair>();
  for (const h of holdings) {
    const qty = Number(h.quantity || 0);
    const symbol = String(h.symbol || "").trim().toUpperCase();
    if (qty <= 0 || !symbol) continue;
    const country = String(h.country || "IND").toUpperCase();
    const key = pairKey(symbol, country);
    keys.set(key, [symbol, country]);
    quantities.set(key, (quantities.get(key) ?? 0.0) + qty);
  }
  if (!quantities.size) {
    return { range, dates: [], series: {}, sessions: [], coverage: { priced: 0, total: 0 }, warnings: ["This portfolio has no holdings."] };
  }

  const [histories, benchmarks, fx] = await Promise.all([
    fetchHoldingHistories(market, [...keys.values()], days),
    Promise.all([
      market.growwDaily("NIFTY", days).catch(() => ({})),
      market.nasdaqDaily("COMP", days, "index").catch(() => ({})),
      market.nasdaqDaily("SPY", days, "etf").catch(() => ({})),
    ]).then(([nifty50, nasdaq, sp500]) => ({ nifty50, nasdaq, sp500 } as Record<string, Series>)),
    market.fxDaily(days).catch(() => ({})),
  ]);

  // Python iterates histories in sorted (symbol, country) order.
  const pricedKeys = [...histories.keys()].filter((k) => Object.keys(histories.get(k)!).length)
    .sort((a, b) => compareTuples(a.split("|"), b.split("|")));
  const priced = new Map(pricedKeys.map((k) => [k, histories.get(k)!]));
  if (!priced.size) {
    return { range, dates: [], series: {}, sessions: [], coverage: { priced: 0, total: quantities.size },
      warnings: ["No price history could be fetched. The data providers may be unreachable."] };
  }

  let dates = [...new Set([...priced.values()].flatMap((s) => Object.keys(s)))].sort().filter((d) => weekday(d) < 5);

  const starts = [...priced.values()].map((s) => Object.keys(s).sort()[0]);
  const lateCutoff = dates.length ? dates[Math.min(Math.floor(dates.length / 4), dates.length - 1)] : null;
  const onTime = starts.filter((d) => lateCutoff === null || d <= lateCutoff);
  const firstFull = onTime.length ? onTime.sort()[onTime.length - 1] : null;
  let trimmed = 0;
  if (firstFull && firstFull > dates[0]) {
    trimmed = dates.filter((d) => d < firstFull).length;
    dates = dates.filter((d) => d >= firstFull);
  }

  const filled = new Map([...priced].map(([k, s]) => [k, forwardFill(s, dates)]));
  let fxFilled: Series = Object.keys(fx).length ? forwardFill(fx, dates) : {};

  const warnings: string[] = [];
  const hasUs = [...priced.keys()].some((k) => k.endsWith("|US"));
  if (hasUs && !Object.keys(fxFilled).length) {
    const spot = await quotes.usdInr();
    if (spot > 0) {
      fxFilled = Object.fromEntries(dates.map((d) => [d, spot]));
      warnings.push(`USD/INR history unavailable; US positions valued at today's rate (₹${fixed(spot, 2)}) throughout.`);
    } else {
      warnings.push("USD/INR unavailable; US positions are excluded.");
    }
  }

  const portfolio: number[] = [];
  for (const day of dates) {
    const rate = fxFilled[day] ?? 0.0;
    let total = 0.0;
    for (const [key, qty] of quantities) {
      let close = filled.get(key)?.[day];
      if (close === undefined) continue;
      const [symbol, country] = keys.get(key)!;
      const held = quantityAt ? quantityAt(symbol, country, day, qty) : qty;
      if (held <= 0) continue;
      if (country === "US") {
        if (rate <= 0) continue;
        close *= rate;
      }
      total += held * close;
    }
    portfolio.push(round(total, 2));
  }

  const dateSet = new Set(dates);
  const flowByDay = new Map<string, number>();
  const charged = new Set<string>();
  for (const row of flows ?? []) {
    const day = row.day;
    if (!dateSet.has(day)) continue;
    const key = pairKey(row.symbol, row.country);
    const close = filled.get(key)?.[day];
    if (close === undefined) continue;
    const delta = row.quantity_delta;
    let amount: number;
    if (delta > 0) {
      amount = row.cost_delta;
      if (amount <= 0 || !(close / 3 <= amount / delta && amount / delta <= close * 3)) amount = delta * close;
    } else {
      amount = delta * close;
    }
    if (row.country === "US") {
      const rate = fxFilled[day] ?? 0.0;
      if (rate <= 0) continue;
      amount *= rate;
    }
    flowByDay.set(day, (flowByDay.get(day) ?? 0.0) + amount);
    charged.add(`${day}|${key}`);
  }

  for (const key of priced.keys()) {
    const series = filled.get(key) ?? {};
    const entry = dates.find((d) => d in series);
    if (entry === undefined || entry === dates[0] || charged.has(`${entry}|${key}`)) continue;
    const [symbol, country] = key.split("|");
    const held = quantityAt ? quantityAt(symbol, country, entry, quantities.get(key)!) : quantities.get(key)!;
    if (held <= 0) continue;
    let amount = held * series[entry];
    if (country === "US") {
      const rate = fxFilled[entry] ?? 0.0;
      if (rate <= 0) continue;
      amount *= rate;
    }
    flowByDay.set(entry, (flowByDay.get(entry) ?? 0.0) + amount);
  }

  if (trimmed) {
    warnings.push(`${trimmed} early session(s) dropped: not every holding had price history that far back, ` +
      "so they would have priced only part of the portfolio.");
  }

  const series: Record<string, any> = {
    portfolio: {
      label: "My Portfolio",
      values_inr: portfolio,
      flows_inr: dates.map((d) => round(flowByDay.get(d) ?? 0.0, 2)),
      indexed: chainLinked(portfolio, flowByDay, dates),
    },
  };
  for (const [key, label] of BENCHMARK_LABELS) {
    const raw = benchmarks[key] ?? {};
    if (!Object.keys(raw).length) {
      warnings.push(`${label} history unavailable.`);
      continue;
    }
    const aligned = forwardFill(raw, dates);
    series[key] = { label, indexed: indexed(dates.map((d) => aligned[d] || 0.0)) };
  }

  const missing = quantities.size - priced.size;
  if (missing > 0) {
    warnings.push(`${missing} of ${quantities.size} holdings had no price history and are excluded from the portfolio line.`);
  }

  return { range, dates, series, coverage: { priced: priced.size, total: quantities.size }, warnings };
}

export async function portfolioHistory(ctx: ChartCtx, portfolioId: string, range: string) {
  const portfolio = portfolioOr404(ctx, portfolioId);
  const accounts = ctx.store.portfolioAccounts(portfolioId);
  const ids = accounts.map((a) => a.id);
  const result = await buildHistory(ctx.market, ctx.quotes, holdingRowsForHistory(ctx, accounts), range,
    quantityReader(ctx.store, ids), flowEvents(ctx.store, ids));
  return { ...result, portfolio_id: portfolioId, portfolio_name: portfolio.name };
}

// ── daily_engine ─────────────────────────────────────────────────────────────

const DISPLAY_DAYS = 30;
const LOOKBACK_DAYS = 95;

async function closes(market: Market, symbol: string, country: string): Promise<Series> {
  const candles = await market.candles(symbol, country).catch(() => [] as Candle[]);
  const out: Series = {};
  for (const c of candles) if (c.close) out[c.time] = c.close;
  return out;
}

export async function portfolioDaily(ctx: ChartCtx, portfolioId: string, limit: number) {
  const portfolio = portfolioOr404(ctx, portfolioId);
  const accounts = ctx.store.portfolioAccounts(portfolioId);
  const holdings = positionsForPnl(ctx, accounts);
  const quantityAt = quantityReader(ctx.store, accounts.map((a) => a.id));
  const storedTotal = ctx.store.table("portfolio_daily_snapshots").filter((s) => s.portfolio_id === portfolioId).length;
  const name = { portfolio_name: portfolio.name };

  if (!holdings.length) return { portfolio_id: portfolioId, days: [], shown: 0, stored_total: storedTotal, holdings: 0, ...name };

  const prices = new Map<string, Series>();
  await pooled(holdings, 8, async (h) => prices.set(pairKey(h.symbol, h.country), await closes(ctx.market, h.symbol, h.country)));
  // Python builds this dict in holdings order.
  const priced = new Map(holdings.map((h) => pairKey(h.symbol, h.country))
    .filter((k) => Object.keys(prices.get(k)!).length).map((k) => [k, prices.get(k)!]));
  if (!priced.size) {
    return { portfolio_id: portfolioId, days: [], shown: 0, stored_total: storedTotal, holdings: holdings.length,
      warnings: ["No price history could be fetched for these holdings."], ...name };
  }

  const cutoff = addDays(laptopToday(), -LOOKBACK_DAYS);
  const dates = [...new Set([...priced.values()].flatMap((s) => Object.keys(s).filter((d) => d >= cutoff)))].sort();
  if (dates.length < 2) return { portfolio_id: portfolioId, days: [], shown: 0, stored_total: storedTotal, holdings: holdings.length, ...name };

  const filled = new Map([...priced].map(([k, s]) => [k, forwardFill(s, dates)]));
  const needsFx = [...priced.keys()].some((k) => k.endsWith("|US"));
  const fx = needsFx ? forwardFill(await ctx.market.fxDaily(LOOKBACK_DAYS + 10).catch(() => ({})), dates) : {};
  const warnings: string[] = [];
  if (needsFx && !Object.keys(fx).length) warnings.push("USD/INR history unavailable; US holdings are excluded from these days.");

  const byKey = new Map(holdings.map((h) => [pairKey(h.symbol, h.country), h]));
  const rows: any[] = [];
  for (let i = 1; i < dates.length; i++) {
    const today = dates[i], prev = dates[i - 1];
    const rate = fx[today] ?? 0.0;
    let pnl = 0.0, base = 0.0, value = 0.0;
    const contributors = new Set<string>();
    for (const [key, series] of filled) {
      const [symbol, country] = key.split("|");
      const close = series[today];
      const previousClose = series[prev];
      if (close === undefined) continue;
      const toInr = country === "US" ? rate : 1.0;
      if (country === "US" && toInr <= 0) continue;
      const holding = byKey.get(key)!;
      const heldToday = quantityAt(symbol, country, today, holding.quantity);
      if (heldToday <= 0) continue;
      const heldBefore = quantityAt(symbol, country, prev, holding.quantity);
      const priceNow = close * toInr;
      value += heldToday * priceNow;
      const carried = Math.min(heldToday, heldBefore);
      const added = Math.max(0.0, heldToday - heldBefore);
      if (carried > 0 && previousClose !== undefined) {
        const priceThen = previousClose * toInr;
        pnl += carried * (priceNow - priceThen);
        base += carried * priceThen;
        contributors.add(key);
      }
      if (added > 0) {
        const cost = (holding.avg_cost_native || 0.0) * toInr;
        if (cost > 0) {
          pnl += added * (priceNow - cost);
          base += added * cost;
          contributors.add(key);
        }
      }
    }
    if (!contributors.size) continue;
    rows.push({
      date: today,
      value_inr: round(value, 2),
      change_inr: round(pnl, 2),
      change_percent: base > 0 ? round((pnl / base) * 100, 2) : null,
      positions: contributors.size,
    });
  }

  return {
    portfolio_id: portfolioId,
    days: rows.slice(-limit).reverse(),
    shown: Math.min(rows.length, limit),
    stored_total: storedTotal,
    holdings: holdings.length,
    warnings,
    ...name,
  };
}

// ── price_moves ──────────────────────────────────────────────────────────────

const WINDOWS: [string, number][] = [["d7", 7], ["d30", 30], ["m6", 182], ["y1", 365]];
const LIVE_SANITY = 0.25;

const percent = (now: number, then: number | null | undefined) =>
  !then || then <= 0 ? null : round(((now - then) / then) * 100, 2);

function closeOnOrBefore(candles: Candle[], cutoff: string): number | null {
  let found: number | null = null;
  for (const c of candles) {
    if (c.time <= cutoff) found = c.close;
    else break;
  }
  return found;
}

export async function changesFor(market: Market, symbol: string, country: string, livePrice?: number) {
  const candles = await market.candles(symbol, country).catch(() => [] as Candle[]);
  if (candles.length < 2) return {};
  const latest = candles[candles.length - 1];
  const lastClose = latest.close;
  const today = utcToday();

  let live = false;
  let now = lastClose;
  let reference = candles[candles.length - 2].close;
  let referenceDate = candles[candles.length - 2].time;
  if (livePrice && livePrice > 0 && lastClose > 0 &&
      Math.abs(livePrice - lastClose) / lastClose < LIVE_SANITY && Math.abs(livePrice - lastClose) > 1e-9) {
    now = livePrice;
    reference = lastClose;
    referenceDate = latest.time;
    live = true;
  }
  const moves: Record<string, number | null> = { d1: percent(now, reference) };
  for (const [label, days] of WINDOWS) moves[label] = percent(now, closeOnOrBefore(candles, addDays(today, -days)));

  return {
    symbol: symbol.trim().toUpperCase(),
    country: (country || "IND").toUpperCase(),
    as_of: live ? "live" : latest.time,
    last_close_date: latest.time,
    reference_date: referenceDate,
    is_live: live,
    close: round(now, 4),
    ...moves,
  };
}

export async function priceChanges(ctx: ChartCtx, portfolioId: string) {
  portfolioOr404(ctx, portfolioId);
  const rows = holdingRowsForHistory(ctx, ctx.store.portfolioAccounts(portfolioId));
  const seen = new Map<string, Pair>();
  for (const r of rows) {
    if (!r.symbol || !String(r.symbol).trim()) continue;
    const pair: Pair = [String(r.symbol).trim().toUpperCase(), String(r.country || "IND").toUpperCase()];
    seen.set(pairKey(...pair), pair);
  }
  const wanted = [...seen.values()].sort((a, b) => compareTuples(a, b));
  const live = wanted.length ? await ctx.quotes.prices(wanted).catch(() => new Map<string, number>()) : new Map<string, number>();
  const results = await pooled(wanted, 8, ([s, c]) => changesFor(ctx.market, s, c, live.get(pairKey(s, c))).catch(() => ({})));
  const changes: Record<string, any> = {};
  wanted.forEach(([s, c], i) => {
    if (Object.keys(results[i]).length) changes[`${s}:${c}`] = results[i];
  });
  return { portfolio_id: portfolioId, changes };
}
