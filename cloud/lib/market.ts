// Daily price history, ported from backend/services/history_source.py (close
// series for the performance chart) and stock_detail.py (5-year candles for
// daily P&L, price moves and the stock page).
//
// Same providers, URLs and parsing as the laptop. Results are cached in memory
// for the laptop's TTLs, and in Netlify Blobs so a fresh function instance does
// not re-download a portfolio's worth of history.
import { getStore } from "@netlify/blobs";
import constants from "../generated/constants.json";
import { resolveQuoteSymbol } from "./quotes.ts";

export const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
};
export const NASDAQ_HEADERS = { ...BROWSER_HEADERS, Referer: "https://www.nasdaq.com/" };
const SERIES_TIMEOUT = 12_000;
const CANDLE_TIMEOUT = 20_000;
const SERIES_TTL = 6 * 3600_000;
const CANDLE_TTL = 6 * 3600_000;
const IST_OFFSET_S = 5.5 * 3600;
const DAY_MS = 86_400_000;

export const RANGE_DAYS: Record<string, number> = { "1mo": 31, "3mo": 93, "6mo": 186, "1y": 366 };
export const CANDLE_RANGES: Record<string, number> = { "1M": 31, "6M": 186, "1Y": 366, "3Y": 1096, "5Y": 1827 };
export const DEFAULT_CANDLE_RANGE = "1Y";
const MAX_RANGE_DAYS = CANDLE_RANGES["5Y"];
const ETFS = new Set(constants.ETF_SYMBOLS);

export type Series = Record<string, number>;
export interface Candle { time: string; open: number; high: number; low: number; close: number; volume: number }

export interface Market {
  growwDaily(symbol: string, days: number): Promise<Series>;
  nasdaqDaily(symbol: string, days: number, assetClass?: string): Promise<Series>;
  fxDaily(days: number): Promise<Series>;
  candles(symbol: string, country: string): Promise<Candle[]>;
}

// ── dates ────────────────────────────────────────────────────────────────────

/** datetime.fromtimestamp(seconds, tz=IST).strftime("%Y-%m-%d") */
export const istDay = (epochSeconds: number) => new Date((epochSeconds + IST_OFFSET_S) * 1000).toISOString().slice(0, 10);
/** datetime.now(timezone.utc).date() */
export const utcToday = () => new Date().toISOString().slice(0, 10);
/** date.today() on the laptop, which runs on India time. */
export const laptopToday = () => istDay(Date.now() / 1000);
/** ISO date plus/minus whole days. */
export const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
/** date.weekday(): Monday 0 .. Sunday 6 */
export const weekday = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;

/** datetime.strptime(text, "%m/%d/%Y") as YYYY-MM-DD, or null. */
function usDate(text: unknown): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(text ?? ""));
  if (!match) return null;
  const [, m, d, y] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** stock_detail._num: the first number in the text, sign-aware. */
export function num(text: unknown): number | null {
  if (text === null || text === undefined) return null;
  if (typeof text === "number") return text;
  const cleaned = String(text).replace(/,/g, "").replace(/ /g, " ");
  const match = /-?\d+(?:\.\d+)?/.exec(cleaned);
  if (!match) return null;
  let value = Number(match[0]);
  const escaped = match[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`^\\s*-\\s*[^\\d-]*${escaped}`).test(cleaned)) value = -Math.abs(value);
  return value;
}

/** Python's float() of a string: whitespace allowed, nothing else. */
function pyFloat(text: string): number | null {
  const t = text.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null;
  return Number(t);
}

// ── caching ──────────────────────────────────────────────────────────────────

const memory = new Map<string, { at: number; value: unknown }>();

export async function cached<T>(key: string, ttl: number, isEmpty: (v: T) => boolean, load: () => Promise<T>): Promise<T> {
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  try {
    const stored = (await getStore("market-cache").get(key, { type: "json" })) as { at: number; value: T } | null;
    if (stored && Date.now() - stored.at < ttl) {
      memory.set(key, stored);
      return stored.value;
    }
  } catch { /* Blobs unavailable: fetch instead */ }
  const value = await load();
  if (!isEmpty(value)) {
    const entry = { at: Date.now(), value };
    memory.set(key, entry);
    try { await getStore("market-cache").setJSON(key, entry); } catch { /* memory cache still holds it */ }
  }
  return value;
}

export async function getJson(url: string, headers: Record<string, string>, timeout: number): Promise<any | null> {
  try {
    const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(timeout) });
    if (response.status !== 200) return null;
    return await response.json();
  } catch {
    return null;
  }
}

const emptySeries = (s: Series) => Object.keys(s).length === 0;
const growwUrl = (symbol: string, days: number) => {
  const now = Date.now();
  return `https://groww.in/v1/api/charting_service/v1/chart/exchange/NSE/segment/CASH/${symbol}` +
    `?intervalInMinutes=1440&startTimeInMillis=${now - days * DAY_MS}&endTimeInMillis=${now}`;
};
const nasdaqUrl = (symbol: string, cls: string, days: number) => {
  const today = utcToday();
  return `https://api.nasdaq.com/api/quote/${symbol}/historical?assetclass=${cls}` +
    `&fromdate=${addDays(today, -days)}&todate=${today}&limit=9999`;
};

export const liveMarket: Market = {
  growwDaily(symbol, days) {
    return cached(`series/groww/${symbol}/${days}`, SERIES_TTL, emptySeries, async () => {
      const data = await getJson(growwUrl(symbol, days), BROWSER_HEADERS, SERIES_TIMEOUT);
      if (!data) return {};
      const series: Series = {};
      for (const candle of data.candles ?? []) {
        if (candle.length < 5 || candle[4] === null || candle[4] === 0) continue;
        series[istDay(candle[0])] = Number(candle[4]);
      }
      return series;
    });
  },

  nasdaqDaily(symbol, days, assetClass = "") {
    return cached(`series/nasdaq/${symbol}:${assetClass}/${days}`, SERIES_TTL, emptySeries, async () => {
      for (const cls of assetClass ? [assetClass] : ["stocks", "etf"]) {
        const data = await getJson(nasdaqUrl(symbol, cls, days), NASDAQ_HEADERS, SERIES_TIMEOUT);
        if (!data) continue;
        const series: Series = {};
        for (const row of data?.data?.tradesTable?.rows ?? []) {
          const raw = String(row.close ?? "").replace(/\$/g, "").replace(/,/g, "").trim();
          if (!raw) continue;
          const close = pyFloat(raw);
          const day = usDate(row.date);
          if (close === null || day === null) continue;
          if (close > 0) series[day] = close;
        }
        if (!emptySeries(series)) return series;
      }
      return {};
    });
  },

  fxDaily(days) {
    return cached(`series/fx/USDINR/${days}`, SERIES_TTL, emptySeries, async () => {
      const today = utcToday();
      const data = await getJson(`https://api.frankfurter.dev/v1/${addDays(today, -days)}..${today}?base=USD&symbols=INR`,
        {}, SERIES_TIMEOUT);
      const series: Series = {};
      for (const [day, values] of Object.entries<any>(data?.rates ?? {})) {
        if (values?.INR) series[day] = Number(values.INR);
      }
      return series;
    });
  },

  candles(symbol, country) {
    const resolved = resolveQuoteSymbol(symbol);
    const isUs = country.toUpperCase() === "US";
    const assetClass = isUs && ETFS.has(resolved) ? "etf" : "";
    const key = isUs ? `candles/nasdaq/${resolved}/${assetClass}` : `candles/groww/${resolved}`;
    return cached(key, CANDLE_TTL, (c: Candle[]) => c.length === 0, async () => {
      if (!isUs) {
        const data = await getJson(growwUrl(resolved, MAX_RANGE_DAYS), BROWSER_HEADERS, CANDLE_TIMEOUT);
        if (!data) return [];
        const out: Candle[] = [];
        for (const row of data.candles ?? []) {
          if (row.length < 5 || !row[4]) continue;
          out.push({
            time: istDay(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]),
            close: Number(row[4]), volume: row.length > 5 && row[5] ? Number(row[5]) : 0.0,
          });
        }
        return out.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
      }
      for (const cls of assetClass ? [assetClass] : ["stocks", "etf"]) {
        const data = await getJson(nasdaqUrl(resolved, cls, MAX_RANGE_DAYS), NASDAQ_HEADERS, CANDLE_TIMEOUT);
        if (!data) continue;
        const out: Candle[] = [];
        for (const row of data?.data?.tradesTable?.rows ?? []) {
          const close = num(row.close);
          if (!close) continue;
          const day = usDate(row.date);
          if (day === null) continue;
          out.push({
            time: day, open: num(row.open) || close, high: num(row.high) || close, low: num(row.low) || close,
            close, volume: num(row.volume) || 0.0,
          });
        }
        if (out.length) return out.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
      }
      return [];
    });
  },
};
