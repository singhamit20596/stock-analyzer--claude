// Live prices, the USD->INR rate and scraped sectors, from the same providers
// and in the same order as backend/services/quote_service.py.
//
// Caches live in memory for the life of a function instance (minutes), with
// the laptop's TTLs. A price of 0 means "no live quote"; callers fall back to
// the last price the laptop published, exactly as the laptop falls back to the
// last price it stored.
import constants from "../generated/constants.json";

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};
const REQUEST_TIMEOUT = 2000;
const PAGE_TIMEOUT = 6000;
const CACHE_TTL = 120_000;
const USD_INR_TTL = 300_000;
const FALLBACK_USD_INR = 95.5;
const YAHOO_COOLDOWN = 600_000;
const US_EXCHANGES = ["NASDAQ", "NYSE", "NYSEARCA", "BATS"];
const MAX_PARALLEL = 15;

const GOOGLE_PRICE_PATTERNS = [
  /jsname="Pdsbrc"[^>]*>(?:\s*<span[^>]*>)?\s*(?:\$|₹|Rs\.?)\s*([\d,]+\.\d{2})/,
  /data-last-price="([\d.]+)"/,
  /class="YMlKec fxfaPl">\s*(?:\$|₹|Rs\.?)\s*([\d,]+\.?\d*)/,
];
const SECTOR_PATTERN = /\{t:"Sector",v:"([^"]+)"/;

const aliases = constants.TICKER_ALIASES as Record<string, string>;
export const resolveQuoteSymbol = (symbol: string) => {
  const sym = (symbol ?? "").trim().toUpperCase();
  return aliases[sym] ?? sym;
};

export type Pair = [symbol: string, country: string];
export const pairKey = (symbol: string, country: string) => `${symbol}|${country}`;

export interface Quotes {
  prices(pairs: Iterable<Pair>): Promise<Map<string, number>>;
  usdInr(): Promise<number>;
  sectors(pairs: Iterable<Pair>): Promise<Map<string, string>>;
}

async function get(url: string, timeout: number): Promise<Response | null> {
  try {
    return await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow", signal: AbortSignal.timeout(timeout) });
  } catch {
    return null;
  }
}

/** Runs `work` over `items`, at most MAX_PARALLEL at a time. */
async function inParallel<T>(items: T[], work: (item: T) => Promise<void>) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(MAX_PARALLEL, items.length) }, async () => {
    while (next < items.length) await work(items[next++]).catch(() => undefined);
  });
  await Promise.all(lanes);
}

const priceCache = new Map<string, { price: number; at: number }>();
const fx = { rate: FALLBACK_USD_INR, at: 0 };
const sectorCache = new Map<string, string>();
let yahooBlockedUntil = 0;

async function scrapeGoogleFinance(path: string): Promise<number> {
  const response = await get(`https://www.google.com/finance/quote/${path}`, PAGE_TIMEOUT);
  if (!response) return 0;
  const text = await response.text().catch(() => "");
  for (const pattern of GOOGLE_PRICE_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      const value = Number(match[1].replace(/,/g, ""));
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return 0;
}

async function yahooChart(ticker: string): Promise<number> {
  if (Date.now() < yahooBlockedUntil) return 0;
  const response = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=1d`, REQUEST_TIMEOUT);
  if (!response) return 0;
  if (response.status === 429) {
    yahooBlockedUntil = Date.now() + YAHOO_COOLDOWN;
    return 0;
  }
  if (response.status !== 200) return 0;
  try {
    const meta = (await response.json())?.chart?.result?.[0]?.meta ?? {};
    const price = Number(meta.regularMarketPrice || meta.previousClose);
    return price > 0 ? price : 0;
  } catch {
    return 0;
  }
}

async function usQuote(symbol: string): Promise<number> {
  for (const exchange of US_EXCHANGES) {
    const price = await scrapeGoogleFinance(`${symbol}:${exchange}`);
    if (price > 0) return price;
  }
  return yahooChart(symbol);
}

async function indianQuote(symbol: string): Promise<number> {
  const response = await get(
    `https://groww.in/v1/api/stocks_data/v1/tr_live_prices/exchange/NSE/segment/CASH/${symbol}/latest`, REQUEST_TIMEOUT);
  if (response?.status === 200) {
    try {
      const data = await response.json();
      const ltp = Number(data.ltp || data.close);
      if (ltp > 0) return ltp;
    } catch { /* fall through */ }
  }
  return yahooChart(`${symbol}.NS`);
}

async function singleQuote(symbol: string, country: string): Promise<number> {
  const sym = resolveQuoteSymbol(symbol);
  if (!sym) return 0;
  const isUs = (country || "IND").toUpperCase() === "US";
  const key = pairKey(sym, isUs ? "US" : "IND");
  const cached = priceCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.price;
  const price = isUs ? await usQuote(sym) : await indianQuote(sym);
  if (price > 0) priceCache.set(key, { price, at: Date.now() });
  return price;
}

async function scrapeSector(path: string): Promise<string> {
  const response = await get(`https://stockanalysis.com/${path}`, PAGE_TIMEOUT);
  if (response?.status !== 200) return "";
  return SECTOR_PATTERN.exec(await response.text().catch(() => ""))?.[1] ?? "";
}

function wanted(pairs: Iterable<Pair>): Pair[] {
  const seen = new Map<string, Pair>();
  for (const [symbol, country] of pairs) {
    if (!symbol || !symbol.trim()) continue;
    const pair: Pair = [symbol.trim().toUpperCase(), (country || "IND").toUpperCase()];
    seen.set(pairKey(...pair), pair);
  }
  return [...seen.values()];
}

export const liveQuotes: Quotes = {
  async prices(pairs) {
    const results = new Map<string, number>();
    await inParallel(wanted(pairs), async ([symbol, country]) => {
      results.set(pairKey(symbol, country), await singleQuote(symbol, country).catch(() => 0));
    });
    return results;
  },

  async usdInr() {
    if (Date.now() - fx.at < USD_INR_TTL) return fx.rate;
    let rate = 0;
    const response = await get("https://open.er-api.com/v6/latest/USD", REQUEST_TIMEOUT);
    if (response?.status === 200) {
      try { rate = Number((await response.json())?.rates?.INR) || 0; } catch { rate = 0; }
    }
    if (!(rate > 0)) rate = await yahooChart("USDINR=X");
    if (rate > 0) Object.assign(fx, { rate, at: Date.now() });
    return fx.rate;
  },

  async sectors(pairs) {
    const all = wanted(pairs);
    await inParallel(all.filter(([s, c]) => !sectorCache.has(pairKey(s, c))), async ([symbol, country]) => {
      const sym = resolveQuoteSymbol(symbol) || symbol;
      const sector = country === "US"
        ? await scrapeSector(`stocks/${sym}/`)
        : (await scrapeSector(`quote/nse/${sym}/`)) || (await scrapeSector(`quote/bse/${sym}/`));
      sectorCache.set(pairKey(symbol, country), sector);
    });
    return new Map(all.map(([s, c]) => [pairKey(s, c), sectorCache.get(pairKey(s, c)) ?? ""]));
  },
};
