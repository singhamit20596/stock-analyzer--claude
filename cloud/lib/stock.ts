// The stock deep-dive page, ported from stock_detail.py, position_engine.py
// and main.py's _position_context.
import constants from "../generated/constants.json";
import { iso, round } from "./py.ts";
import {
  BROWSER_HEADERS, CANDLE_RANGES, DEFAULT_CANDLE_RANGE, NASDAQ_HEADERS, addDays, cached, getJson, num, utcToday,
  type Candle, type Market,
} from "./market.ts";
import { pairKey, resolveQuoteSymbol } from "./quotes.ts";
import { aggregateHoldings, compareTarget, HttpError, portfolioOr404, priceQuotes, resolveSectors, type Ctx } from "./pages.ts";
import type { R } from "./store.ts";

const HTML_HEADERS = { ...BROWSER_HEADERS, Accept: "text/html,application/xhtml+xml" };
const TIMEOUT = 20_000;
const FUNDAMENTAL_TTL = 12 * 3600_000;
const ETFS = new Set(constants.ETF_SYMBOLS);
export const isEtf = (symbol: string) => ETFS.has(resolveQuoteSymbol(symbol));

/** The provider calls the page makes, at the same boundaries as the laptop's
 *  functions, so a test can replay what the laptop fetched. */
export interface StockSources {
  screenerPage(symbol: string): Promise<string>;
  tickertapeInfo(symbol: string): Promise<Record<string, any>>;
  nasdaqSummary(symbol: string, assetClass: string): Promise<Record<string, any>>;
  nasdaqInfo(symbol: string, assetClass: string): Promise<Record<string, any>>;
  nasdaqFinancials(symbol: string, frequency: number): Promise<Record<string, any>>;
}

export interface StockCtx extends Ctx {
  market: Market;
  sources: StockSources;
}

const r2 = (v: number | null | undefined, digits = 2) => (v === null || v === undefined ? null : round(v, digits));
const div = (a: number | null | undefined, b: number | null | undefined) => (a === null || a === undefined || !b ? null : a / b);
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const isEmpty = (v: unknown) => !v || (typeof v === "object" && Object.keys(v as object).length === 0);

// ── html ─────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", times: "×", deg: "°", middot: "·", bull: "•", copy: "©",
  reg: "®", trade: "™", rarr: "→", larr: "←", uarr: "↑", darr: "↓", percnt: "%", plus: "+", minus: "−",
};

/** html.unescape, for the entities these providers emit. */
function unescape(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

const stripTags = (markup: string) =>
  unescape(markup.replace(/<[^>]+>/g, " ")).replace(/ /g, " ").replace(/\s+/g, " ").trim();

// ── live sources ─────────────────────────────────────────────────────────────

async function getText(url: string, headers: Record<string, string>): Promise<{ status: number; text: string } | null> {
  try {
    const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT) });
    return { status: response.status, text: await response.text() };
  } catch {
    return null;
  }
}

const SECURITY_TYPE = /\s+(Common Stock|Common Shares|Ordinary Shares|American Depositary Shares?)\s*$/i;
const cleanCompanyName = (name: unknown) => (!name ? null : String(name).replace(SECURITY_TYPE, "").trim() || String(name));

export const liveSources: StockSources = {
  screenerPage(symbol) {
    return cached(`fundamentals/screener/${symbol}`, FUNDAMENTAL_TTL, (v: string) => !v, async () => {
      for (const path of [`https://www.screener.in/company/${symbol}/`, `https://www.screener.in/company/${symbol}/consolidated/`]) {
        const page = await getText(path, HTML_HEADERS);
        if (page && page.status === 200 && page.text.includes("top-ratios")) return page.text;
      }
      return "";
    });
  },

  tickertapeInfo(symbol) {
    return cached(`fundamentals/tickertape/${symbol}`, FUNDAMENTAL_TTL, isEmpty, async () => {
      const found = await getJson(`https://api.tickertape.in/search?text=${symbol}&types=stock`, BROWSER_HEADERS, TIMEOUT);
      if (!found) return {};
      const stocks: any[] = found?.data?.stocks ?? [];
      const match = stocks.find((s) => String(s.ticker ?? "").toUpperCase() === symbol.toUpperCase());
      if (!match || !match.sid) return {};
      const detail = await getJson(`https://api.tickertape.in/stocks/info/${match.sid}`, BROWSER_HEADERS, TIMEOUT);
      const info = detail?.data?.info ?? {};
      // `?? null` where Python's dict.get would give None, so the key is kept.
      return {
        name: info.name || (match.name ?? null),
        description: info.description ?? null,
        industry: info.sector ?? null,
        exchange: info.exchange ?? null,
      };
    });
  },

  nasdaqSummary(symbol, assetClass) {
    return cached(`fundamentals/nasdaq-summary/${symbol}/${assetClass}`, FUNDAMENTAL_TTL, isEmpty, async () => {
      const data = await getJson(`https://api.nasdaq.com/api/quote/${symbol}/summary?assetclass=${assetClass}`, NASDAQ_HEADERS, TIMEOUT);
      if (!data) return {};
      const summary = data?.data?.summaryData ?? {};
      return Object.fromEntries(Object.entries<any>(summary).map(([k, v]) =>
        [k, v !== null && typeof v === "object" && !Array.isArray(v) ? (v.value ?? null) : v]));
    });
  },

  nasdaqInfo(symbol, assetClass) {
    return cached(`fundamentals/nasdaq-info/${symbol}/${assetClass}`, FUNDAMENTAL_TTL, isEmpty, async () => {
      const data = await getJson(`https://api.nasdaq.com/api/quote/${symbol}/info?assetclass=${assetClass}`, NASDAQ_HEADERS, TIMEOUT);
      if (!data) return {};
      const d = data.data ?? {};
      return { name: cleanCompanyName(d.companyName), exchange: d.exchange ?? null };
    });
  },

  nasdaqFinancials(symbol, frequency) {
    return cached(`fundamentals/nasdaq-fin/${symbol}/${frequency}`, FUNDAMENTAL_TTL, isEmpty, async () => {
      const data = await getJson(`https://api.nasdaq.com/api/company/${symbol}/financials?frequency=${frequency}`, NASDAQ_HEADERS, TIMEOUT);
      return data?.data ?? {};
    });
  },
};

// ── candles and technicals ───────────────────────────────────────────────────

export function sliceRange(candles: Candle[], rangeKey: string) {
  const days = CANDLE_RANGES[rangeKey.toUpperCase()] ?? CANDLE_RANGES[DEFAULT_CANDLE_RANGE];
  if (!candles.length) return { range: rangeKey, candles: [], change_percent: null, change_absolute: null };
  const cutoff = addDays(utcToday(), -days);
  let window = candles.filter((c) => c.time >= cutoff);
  if (!window.length) window = candles.slice(-2);
  const first = window[0].close;
  const last = window[window.length - 1].close;
  const change = last - first;
  return {
    range: rangeKey,
    candles: window,
    change_absolute: r2(change),
    change_percent: first ? r2((change / first) * 100) : null,
    period_high: r2(Math.max(...window.map((c) => c.high))),
    period_low: r2(Math.min(...window.map((c) => c.low))),
  };
}

const sma = (closes: number[], period: number) => (closes.length < period ? null : sum(closes.slice(-period)) / period);

function emaSeries(values: number[], period: number): number[] {
  if (!values.length) return [];
  const k = 2.0 / (period + 1);
  const out = [values[0]];
  for (const value of values.slice(1)) out.push(value * k + out[out.length - 1] * (1 - k));
  return out;
}

function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const deltas = closes.slice(1).map((c, i) => c - closes[i]);
  const gains = deltas.map((d) => Math.max(d, 0.0));
  const losses = deltas.map((d) => Math.abs(Math.min(d, 0.0)));
  let avgGain = sum(gains.slice(0, period)) / period;
  let avgLoss = sum(losses.slice(0, period)) / period;
  for (let i = period; i < deltas.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }
  if (avgLoss === 0) return 100.0;
  return 100.0 - 100.0 / (1.0 + avgGain / avgLoss);
}

function macd(closes: number[]) {
  if (closes.length < 35) return { macd: null, signal: null, histogram: null };
  const fast = emaSeries(closes, 12);
  const slow = emaSeries(closes, 26);
  const line = fast.map((f, i) => f - slow[i]);
  const signal = emaSeries(line, 9);
  return {
    macd: r2(line[line.length - 1], 3),
    signal: r2(signal[signal.length - 1], 3),
    histogram: r2(line[line.length - 1] - signal[signal.length - 1], 3),
  };
}

function supportResistance(candles: Candle[], lookback = 120) {
  const window = candles.slice(-lookback);
  if (window.length < 11) return { support: null, resistance: null, recent_low: null, recent_high: null };
  const last = window[window.length - 1].close;
  const supports: number[] = [];
  const resistances: number[] = [];
  for (let i = 2; i < window.length - 2; i++) {
    const lows = window.slice(i - 2, i + 3).map((c) => c.low);
    const highs = window.slice(i - 2, i + 3).map((c) => c.high);
    if (window[i].low === Math.min(...lows) && window[i].low < last) supports.push(window[i].low);
    if (window[i].high === Math.max(...highs) && window[i].high > last) resistances.push(window[i].high);
  }
  return {
    support: supports.length ? r2(Math.max(...supports)) : null,
    resistance: resistances.length ? r2(Math.min(...resistances)) : null,
    recent_low: r2(Math.min(...window.map((c) => c.low))),
    recent_high: r2(Math.max(...window.map((c) => c.high))),
    lookback_sessions: window.length,
  };
}

function computeTechnicals(candles: Candle[]) {
  const closes = candles.map((c) => c.close);
  if (!closes.length) return {};
  const last = closes[closes.length - 1];
  const [s20, s50, s200] = [sma(closes, 20), sma(closes, 50), sma(closes, 200)];
  return {
    rsi_14: r2(rsi(closes)),
    macd: macd(closes),
    sma_20: r2(s20),
    sma_50: r2(s50),
    sma_200: r2(s200),
    price_vs_sma_20: s20 ? r2((last / s20 - 1) * 100) : null,
    price_vs_sma_50: s50 ? r2((last / s50 - 1) * 100) : null,
    price_vs_sma_200: s200 ? r2((last / s200 - 1) * 100) : null,
    levels: supportResistance(candles),
    sessions_used: closes.length,
  };
}

// ── India: screener.in ───────────────────────────────────────────────────────

function screenerRatios(html: string) {
  const block = /<ul[^>]*id="top-ratios"[^>]*>(.*?)<\/ul>/s.exec(html);
  if (!block) return {};
  const found = new Map<string, number[]>();
  for (const [, item] of block[1].matchAll(/<li[^>]*>(.*?)<\/li>/gs)) {
    const name = /class="name"[^>]*>(.*?)<\/span>/s.exec(item);
    if (!name) continue;
    const label = stripTags(name[1]).replace(/:+$/, "").trim();
    const numbers = [...item.matchAll(/class="number"[^>]*>([^<]*)</g)].map((m) => num(m[1])).filter((n): n is number => n !== null);
    if (numbers.length) found.set(label, numbers);
  }
  const one = (label: string) => found.get(label)?.[0] ?? null;
  const highLow = found.get("High / Low") ?? [];
  const price = one("Current Price");
  const bookValue = one("Book Value");
  return {
    market_cap: one("Market Cap"),
    market_cap_unit: "crore",
    current_price: price,
    pe: one("Stock P/E"),
    book_value: bookValue,
    pb: r2(div(price, bookValue)),
    dividend_yield: one("Dividend Yield"),
    roce: one("ROCE"),
    roe: one("ROE"),
    face_value: one("Face Value"),
    week52_high: highLow.length > 0 ? highLow[0] : null,
    week52_low: highLow.length > 1 ? highLow[1] : null,
  };
}

const QUARTER_ROWS: [string, string[]][] = [
  ["revenue", ["Sales", "Revenue"]],
  ["operating_profit", ["Operating Profit", "Financing Profit"]],
  ["net_profit", ["Net Profit"]],
  ["eps", ["EPS in Rs"]],
];

type Quarters = { columns: string[]; series: Record<string, (number | null)[]> } | Record<string, never>;

function screenerQuarters(html: string): Quarters {
  const section = /<section[^>]*id="quarters".*?<\/section>/s.exec(html);
  if (!section) return {};
  const table = /<table.*?<\/table>/s.exec(section[0]);
  if (!table) return {};
  const head = /<thead.*?<\/thead>/s.exec(table[0]);
  let columns = head ? [...head[0].matchAll(/<th[^>]*>(.*?)<\/th>/gs)].map((m) => stripTags(m[1])) : [];
  columns = columns.slice(1).filter(Boolean);
  const body = /<tbody.*?<\/tbody>/s.exec(table[0]);
  if (!body || !columns.length) return {};

  const raw = new Map<string, (number | null)[]>();
  for (const [, row] of body[0].matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)) {
    const cells = [...row.matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/gs)].map((m) => m[1]);
    if (!cells.length) continue;
    const label = stripTags(cells[0]).replace(/\+/g, "").trim();
    raw.set(label, cells.slice(1).map((c) => num(stripTags(c))));
  }
  const series: Record<string, (number | null)[]> = {};
  for (const [field, labels] of QUARTER_ROWS) {
    const label = labels.find((l) => raw.has(l));
    if (label !== undefined) series[field] = raw.get(label)!;
  }
  if (!Object.keys(series).length) return {};
  return { columns, series };
}

// ── US: Nasdaq ───────────────────────────────────────────────────────────────

function tableRow(table: any, label: string, column = "value2"): number | null {
  for (const row of table?.rows ?? []) {
    if (String(row.value1 ?? "").trim().toLowerCase() === label.toLowerCase()) return num(row[column]);
  }
  return null;
}

const STATEMENT_SCALE = 1000.0;

function usRatios(summary: Record<string, any>, annual: Record<string, any>, price: number | null) {
  const income = annual.incomeStatementTable || {};
  const balance = annual.balanceSheetTable || {};
  const ratios = annual.financialRatiosTable || {};
  const absolute = (label: string, table: any) => {
    const value = tableRow(table, label);
    return value === null ? null : value * STATEMENT_SCALE;
  };
  const marketCap = num(summary.MarketCap);
  const netIncome = absolute("Net Income", income);
  const totalEquity = absolute("Total Equity", balance);
  const ebit = tableRow(income, "Earnings Before Interest and Tax");
  const totalAssets = tableRow(balance, "Total Assets");
  const currentLiabilities = tableRow(balance, "Total Current Liabilities");
  const shares = div(marketCap, price);
  const capitalEmployed = totalAssets !== null && currentLiabilities !== null ? totalAssets - currentLiabilities : null;
  const week52 = String(summary.FiftTwoWeekHighLow || "");
  const highLow = week52.includes("/") ? week52.split("/").map(num) : [];
  const roce = div(ebit, capitalEmployed);
  return {
    market_cap: marketCap,
    market_cap_unit: "absolute",
    current_price: price,
    pe: r2(div(marketCap, netIncome)),
    pb: r2(div(marketCap, totalEquity)),
    book_value: r2(div(totalEquity, shares)),
    dividend_yield: num(summary.Yield),
    roe: r2(tableRow(ratios, "After Tax ROE")),
    roce: roce ? r2(roce * 100) : null,
    week52_high: highLow.length > 0 ? highLow[0] : null,
    week52_low: highLow.length > 1 ? highLow[1] : null,
    analyst_target: num(summary.OneYrTarget),
  };
}

const US_QUARTER_ROWS: [string, string][] = [
  ["revenue", "Total Revenue"], ["gross_profit", "Gross Profit"], ["operating_profit", "Operating Income"], ["net_profit", "Net Income"],
];

function usQuarters(quarterly: Record<string, any>): Quarters {
  const income = quarterly.incomeStatementTable || {};
  const headers = income.headers || {};
  if (!income.rows || !income.rows.length) return {};
  const keys = ["value5", "value4", "value3", "value2"].filter((k) => headers[k]);
  const columns = keys.map((k) => headers[k]);
  const series: Record<string, (number | null)[]> = {};
  for (const [field, label] of US_QUARTER_ROWS) {
    const values = keys.map((k) => tableRow(income, label, k));
    if (values.some((v) => v !== null)) series[field] = values;
  }
  if (!Object.keys(series).length) return {};
  return { columns, series };
}

function growth(values: (number | null)[], lag: number) {
  return values.map((value, i) => {
    const previous = i >= lag ? values[i - lag] : null;
    if (value === null || previous === null || previous <= 0) return null;
    return r2(((value - previous) / previous) * 100);
  });
}

function buildQuarters(parsed: any, maxColumns = 8) {
  if (!parsed || !parsed.columns || !parsed.columns.length) return null;
  const columns: string[] = parsed.columns;
  const lag = columns.length > 4 ? 4 : 1;
  const rows = Object.entries<(number | null)[]>(parsed.series).map(([field, values]) => {
    const padded = [...values, ...new Array(Math.max(0, columns.length - values.length)).fill(null)];
    return { key: field, values: padded.slice(-maxColumns), growth: growth(padded, lag).slice(-maxColumns) };
  });
  return { columns: columns.slice(-maxColumns), rows, growth_basis: lag === 4 ? "yoy" : "qoq" };
}

function candleFacts(candles: Candle[]) {
  const year = candles.slice(-252);
  if (!year.length) return {};
  return {
    week52_high: r2(Math.max(...year.map((c) => c.high))),
    week52_low: r2(Math.min(...year.map((c) => c.low))),
    average_volume: r2(sum(year.slice(-50).map((c) => c.volume)) / Math.min(50, year.length), 0),
  };
}

function splitHighLow(value: unknown): (number | null)[] {
  const text = String(value ?? "");
  if (!text.includes("/")) return [null, null];
  const parts = text.split("/");
  return [num(parts[0]), num(parts[1])];
}

async function indFundamentals(sources: StockSources, symbol: string, etf: boolean): Promise<Record<string, any>> {
  if (etf) return { sources: ["Groww"], company: {}, ratios: {}, etf_facts: {} };
  const [html, company] = await Promise.all([sources.screenerPage(symbol), sources.tickertapeInfo(symbol)]);
  const list = ["Groww"];
  if (html) list.push("screener.in");
  if (!isEmpty(company)) list.push("Tickertape");
  return {
    company,
    ratios: html ? screenerRatios(html) : {},
    quarters: html ? screenerQuarters(html) : {},
    sources: list,
  };
}

async function usFundamentals(sources: StockSources, symbol: string, etf: boolean): Promise<Record<string, any>> {
  const assetClass = etf ? "etf" : "stocks";
  if (etf) {
    const [summary, info] = await Promise.all([sources.nasdaqSummary(symbol, assetClass), sources.nasdaqInfo(symbol, assetClass)]);
    const hl = splitHighLow(summary.FiftTwoWeekHighLow);
    return {
      sources: ["Nasdaq"],
      company: { name: info.name ?? null, exchange: summary.Exchange || (info.exchange ?? null) },
      ratios: {},
      etf_facts: {
        aum_thousands: num(summary.AUM),
        expense_ratio: num(summary.ExpenseRatio),
        beta: num(summary.Beta),
        market_cap: num(summary.MarketCap),
        market_cap_unit: "absolute",
        week52_high: hl[0],
        week52_low: hl[1],
        average_volume: num(summary.FiftyDayAvgDailyVol),
      },
    };
  }
  const [summary, info, annual, quarterly] = await Promise.all([
    sources.nasdaqSummary(symbol, assetClass), sources.nasdaqInfo(symbol, assetClass),
    sources.nasdaqFinancials(symbol, 1), sources.nasdaqFinancials(symbol, 2),
  ]);
  return {
    company: {
      name: info.name ?? null,
      industry: summary.Industry ?? null,
      sector_provider: summary.Sector ?? null,
      exchange: summary.Exchange || (info.exchange ?? null),
    },
    summary,
    annual,
    quarters: usQuarters(quarterly),
    sources: ["Nasdaq"],
  };
}

/** stock_detail.get_stock_detail */
export async function getStockDetail(market: Market, sources: StockSources, symbol: string, countryIn: string) {
  const country = (countryIn || "IND").toUpperCase();
  const resolved = resolveQuoteSymbol(symbol);
  const etf = isEtf(resolved);
  const warnings: string[] = [];

  const [candles, fundamentals] = await Promise.all([
    market.candles(symbol, country).catch(() => [] as Candle[]),
    country === "US" ? usFundamentals(sources, resolved, etf) : indFundamentals(sources, resolved, etf),
  ]);
  if (!candles.length) warnings.push(`No price history available for ${resolved} from ${country === "US" ? "Nasdaq" : "Groww"}.`);

  let ratios: any = fundamentals.ratios || {};
  const price = candles.length ? candles[candles.length - 1].close : (ratios.current_price ?? null);
  if (country === "US" && !etf) ratios = usRatios(fundamentals.summary || {}, fundamentals.annual || {}, price);

  const previousClose = candles.length > 1 ? candles[candles.length - 2].close : null;
  const quarters = etf ? null : buildQuarters(isEmpty(fundamentals.quarters) ? {} : fundamentals.quarters);
  const etfFacts = etf ? { ...candleFacts(candles), ...(fundamentals.etf_facts || {}) } : null;
  if (!etf && quarters === null && candles.length) warnings.push("Quarterly results were not available from the provider.");

  return {
    symbol: resolved,
    requested_symbol: symbol.toUpperCase(),
    country,
    currency: country === "US" ? "USD" : "INR",
    is_etf: etf,
    company: isEmpty(fundamentals.company) ? {} : fundamentals.company,
    price: {
      current: r2(price),
      previous_close: r2(previousClose),
      change: price && previousClose ? r2(price - previousClose) : null,
      change_percent: price && previousClose ? r2((price / previousClose - 1) * 100) : null,
      as_of: candles.length ? candles[candles.length - 1].time : null,
    },
    chart: sliceRange(candles, DEFAULT_CANDLE_RANGE),
    ratios,
    etf_facts: etfFacts,
    quarterly: quarters,
    technicals: computeTechnicals(candles),
    sources: fundamentals.sources || [],
    warnings,
    // Python's datetime.now(timezone.utc).isoformat()
    fetched_at: new Date().toISOString().replace("Z", "000+00:00"),
  };
}

// ── position_engine ──────────────────────────────────────────────────────────

function buildPosition(symbolIn: string, countryIn: string, aggregated: any, klass: { sector?: string; section?: string },
                       holdings: R[], usdInr: number) {
  const symbol = symbolIn.trim().toUpperCase();
  const country = (countryIn || "IND").toUpperCase();
  const item = aggregated.items.find((i: any) => i.symbol === symbol && i.country === country);
  if (!item) return { held: false, symbol, country, sector: klass.sector ?? "", section: klass.section ?? "" };

  const priceInr = item.current_price_inr;
  const seen = holdings.filter((h) => h.symbol && String(h.symbol).trim().toUpperCase() === symbol && h.first_seen_at)
    .map((h) => String(h.first_seen_at)).sort();
  const isUsd = item.currency === "USD";
  return {
    held: true,
    symbol,
    country,
    company_name: item.company_name,
    currency: item.currency,
    usd_inr_rate: isUsd ? usdInr : null,
    quantity: item.total_quantity,
    avg_cost_inr: item.wacp_inr,
    avg_cost_native: isUsd && usdInr ? round(item.wacp_inr / usdInr, 2) : item.wacp_inr,
    current_price_inr: priceInr,
    current_price_native: isUsd && usdInr ? round(priceInr / usdInr, 2) : priceInr,
    invested_inr: item.total_invested_inr,
    current_value_inr: item.current_value_inr,
    pnl_inr: item.pnl_inr,
    pnl_percent: item.pnl_percent,
    portfolio_percent: item.allocation_percent,
    sector: klass.sector ?? "",
    section: klass.section ?? "",
    accounts: item.accounts_breakdown.map((e: any) => ({
      account_id: e.account_id,
      account_name: e.account_name,
      currency_type: e.currency_type,
      quantity: e.quantity,
      avg_cost_native: e.avg_buy_price,
      avg_cost_inr: e.avg_buy_price_inr,
      invested_inr: e.invested_inr,
      current_value_inr: round(e.quantity * priceInr, 2),
    })),
    first_seen_at: seen.length ? iso(seen[0]) : null,
  };
}

function locateInTarget(comparison: any, symbolIn: string, country: string) {
  const market = (comparison.breakdown || {})[country.toUpperCase()];
  if (!market) return null;
  const symbol = symbolIn.trim().toUpperCase();
  for (const line of market.lines || []) {
    const stock = (line.stocks || []).find((s: any) => s.symbol.trim().toUpperCase() === symbol);
    if (!stock) continue;
    if (stock.target_inr === null || stock.target_inr === undefined) {
      return { target_name: comparison.target_name, dimension: market.dimension, bucket: line.key, has_target: false };
    }
    return {
      target_name: comparison.target_name,
      dimension: market.dimension,
      bucket: line.key,
      has_target: true,
      bucket_current_inr: line.current_inr,
      bucket_current_percent: line.current_percent,
      bucket_target_percent: line.target_percent,
      bucket_delta_inr: line.delta_inr,
      stock_current_inr: stock.current_inr,
      stock_current_percent: stock.current_percent,
      stock_target_percent: stock.target_percent,
      stock_target_inr: stock.target_inr,
      stock_delta_inr: stock.delta_inr,
    };
  }
  return null;
}

/** main._position_context */
async function positionContext(ctx: StockCtx, symbol: string, country: string, portfolioId: string | null, targetId: string | null) {
  const accounts = portfolioId
    ? (portfolioOr404(ctx, portfolioId), ctx.store.portfolioAccounts(portfolioId))
    : ctx.store.accountsOf(ctx.view.user.id);
  const holdings = accounts.length ? ctx.store.holdingsIn(accounts.map((a) => a.id)) : [];
  const { live, usdInr } = await priceQuotes(ctx, accounts, holdings);
  const aggregated = aggregateHoldings(accounts, holdings, live, usdInr);
  const sectors = await resolveSectors(ctx, holdings);
  const key = pairKey(symbol.trim().toUpperCase(), country.trim().toUpperCase());
  const position = buildPosition(symbol, country, aggregated, sectors.get(key) ?? {}, holdings, usdInr);

  // _pick_target: the named one, or the only one there is.
  const owned = ctx.store.targetsOf(ctx.view.user.id);
  const target = targetId ? owned.find((t) => t.id === targetId) : owned.length === 1 ? owned[0] : undefined;
  let tracking = null;
  if (target && position.held) {
    const rows = aggregated.items.map((item: any) => ({
      symbol: item.symbol, company_name: item.company_name, country: item.country, current_value_inr: item.current_value_inr,
      ...(sectors.get(pairKey(item.symbol, item.country)) ?? {}),
    }));
    const wallet: Record<string, number> = { IND: 0.0, US: 0.0 };
    for (const a of accounts) {
      const isUs = a.currency_type === "US";
      wallet[isUs ? "US" : "IND"] += (a.wallet_balance || 0.0) * (isUs ? usdInr : 1.0);
    }
    tracking = locateInTarget(compareTarget(ctx, target, rows, wallet), symbol, country);
  }
  return { position, target_tracking: tracking };
}

export async function stockAnalysis(ctx: StockCtx, symbol: string, params: URLSearchParams) {
  const country = params.get("country") ?? "IND";
  const detail = await getStockDetail(ctx.market, ctx.sources, symbol, country);
  return { ...detail, ...(await positionContext(ctx, symbol, country, params.get("portfolio_id"), params.get("target_id"))) };
}

export async function stockCandles(ctx: StockCtx, symbol: string, params: URLSearchParams) {
  const country = params.get("country") ?? "IND";
  const range = params.get("range") ?? DEFAULT_CANDLE_RANGE;
  if (!(range.toUpperCase() in CANDLE_RANGES)) {
    throw new HttpError(400, `Unsupported range. Use one of: ${Object.keys(CANDLE_RANGES).join(", ")}`);
  }
  return sliceRange(await ctx.market.candles(symbol, country).catch(() => []), range.toUpperCase());
}
