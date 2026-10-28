// Temporary: answers "will the data providers talk to Netlify's servers?"
//
// Everything the live website does depends on Groww, Nasdaq and friends
// answering requests from a datacenter, and that cannot be known from the
// laptop — Yahoo already refuses its home connection, and cloud addresses are
// refused far more often. So before any of the read logic is ported, this
// calls each provider exactly the way backend/services does (same URLs, same
// headers) and checks the body for real data: a 200 carrying a block page or
// a captcha is a failure, not a success. Delete once the answer is in.

import type { Config } from "@netlify/functions";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const BROWSER = { "User-Agent": UA };
const JSON_ACCEPT = { ...BROWSER, Accept: "application/json" };
const NASDAQ = { ...JSON_ACCEPT, Referer: "https://www.nasdaq.com/" };
const HTML = { ...BROWSER, Accept: "text/html,application/xhtml+xml" };

const day = 86_400_000;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

type Check = { name: string; used_for: string; url: string; headers: Record<string, string>; ok: (body: string) => boolean };

const CHECKS: Check[] = [
  { name: "groww_live_price", used_for: "IND live quotes",
    url: "https://groww.in/v1/api/stocks_data/v1/tr_live_prices/exchange/NSE/segment/CASH/HDFCBANK/latest",
    headers: BROWSER, ok: (b) => /"ltp"\s*:\s*\d/.test(b) },
  { name: "groww_chart_stock", used_for: "IND history, candles, daily P&L",
    url: `https://groww.in/v1/api/charting_service/v1/chart/exchange/NSE/segment/CASH/HDFCBANK?intervalInMinutes=1440&startTimeInMillis=${now - 30 * day}&endTimeInMillis=${now}`,
    headers: BROWSER, ok: (b) => /"candles"\s*:\s*\[\s*\[/.test(b) },
  { name: "groww_chart_nifty", used_for: "Nifty 50 benchmark",
    url: `https://groww.in/v1/api/charting_service/v1/chart/exchange/NSE/segment/CASH/NIFTY?intervalInMinutes=1440&startTimeInMillis=${now - 30 * day}&endTimeInMillis=${now}`,
    headers: BROWSER, ok: (b) => /"candles"\s*:\s*\[\s*\[/.test(b) },
  { name: "nasdaq_historical", used_for: "US history and candles",
    url: `https://api.nasdaq.com/api/quote/AAPL/historical?assetclass=stocks&fromdate=${iso(now - 30 * day)}&todate=${iso(now)}&limit=9999`,
    headers: NASDAQ, ok: (b) => /"tradesTable"/.test(b) && /"rows"\s*:\s*\[\s*\{/.test(b) },
  { name: "nasdaq_index_comp", used_for: "Nasdaq Composite benchmark",
    url: `https://api.nasdaq.com/api/quote/COMP/historical?assetclass=index&fromdate=${iso(now - 30 * day)}&todate=${iso(now)}&limit=9999`,
    headers: NASDAQ, ok: (b) => /"rows"\s*:\s*\[\s*\{/.test(b) },
  { name: "nasdaq_summary", used_for: "US ratios on the deep-dive",
    url: "https://api.nasdaq.com/api/quote/AAPL/summary?assetclass=stocks",
    headers: NASDAQ, ok: (b) => /"summaryData"/.test(b) },
  { name: "google_finance", used_for: "US live quotes",
    url: "https://www.google.com/finance/quote/AAPL:NASDAQ",
    // The same three patterns quote_service tries, in order. Checking only one
    // reported a working page as broken: Google moves the price between them.
    headers: BROWSER, ok: (b) => [
      /jsname="Pdsbrc"[^>]*>(?:\s*<span[^>]*>)?\s*(?:\$|₹|Rs\.?)\s*[\d,]+\.\d{2}/,
      /data-last-price="[\d.]+"/,
      /class="YMlKec fxfaPl">\s*(?:\$|₹|Rs\.?)\s*[\d,]+\.?\d*/,
    ].some((re) => re.test(b)) },
  { name: "screener_in", used_for: "IND fundamentals on the deep-dive",
    url: "https://www.screener.in/company/HDFCBANK/",
    headers: HTML, ok: (b) => /id="top-ratios"/.test(b) },
  { name: "tickertape_search", used_for: "IND company names",
    url: "https://api.tickertape.in/search?text=HDFCBANK&types=stock",
    headers: JSON_ACCEPT, ok: (b) => /"ticker"/.test(b) },
  { name: "stockanalysis", used_for: "US sector lookup",
    url: "https://stockanalysis.com/stocks/aapl/",
    headers: HTML, ok: (b) => /Sector/i.test(b) },
  { name: "frankfurter_fx", used_for: "USD/INR history",
    url: `https://api.frankfurter.dev/v1/${iso(now - 10 * day)}..${iso(now)}?base=USD&symbols=INR`,
    headers: JSON_ACCEPT, ok: (b) => /"INR"\s*:\s*\d/.test(b) },
  { name: "er_api_fx", used_for: "USD/INR live rate",
    url: "https://open.er-api.com/v6/latest/USD",
    headers: JSON_ACCEPT, ok: (b) => /"INR"\s*:\s*\d/.test(b) },
  { name: "google_news_rss", used_for: "news section",
    url: "https://news.google.com/rss/search?q=HDFC%20Bank&hl=en-IN&gl=IN&ceid=IN:en",
    headers: BROWSER, ok: (b) => /<item>/.test(b) },
  { name: "yahoo_chart", used_for: "last-resort quote fallback (already blocked at home)",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/HDFCBANK.NS?interval=1m&range=1d",
    headers: BROWSER, ok: (b) => /"regularMarketPrice"/.test(b) },
];

async function run(check: Check) {
  const started = Date.now();
  try {
    const res = await fetch(check.url, { headers: check.headers, signal: AbortSignal.timeout(15_000) });
    const body = await res.text();
    return {
      name: check.name, used_for: check.used_for,
      status: res.status, ms: Date.now() - started, bytes: body.length,
      has_data: res.ok && check.ok(body),
      // Enough to recognise a block page or captcha, never the whole body.
      sample: body.slice(0, 160).replace(/\s+/g, " "),
    };
  } catch (error) {
    return { name: check.name, used_for: check.used_for, status: 0,
             ms: Date.now() - started, bytes: 0, has_data: false,
             sample: String((error as Error)?.message ?? error) };
  }
}

export default async (_req: Request, context: { geo?: unknown }) => {
  const results = await Promise.all(CHECKS.map(run));
  const verdict = results.every((r) => r.has_data || r.name === "yahoo_chart")
    ? "all required providers answered with data"
    : "some providers did NOT return data — see has_data=false";
  return Response.json({
    checked_at: new Date().toISOString(),
    region: process.env.AWS_REGION ?? "unknown",
    verdict,
    results,
  }, { headers: { "Cache-Control": "no-store" } });
};

export const config: Config = { path: "/api/_probe" };
