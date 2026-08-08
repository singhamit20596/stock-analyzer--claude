// Shared formatting for the deep-dive page.
//
// Two currencies meet on this page: the position band is always INR (the whole
// app is), while the market data is in the instrument's own currency. Every
// helper therefore takes the currency rather than assuming one.

export const DASH = '—';

const isNil = (value) => value === null || value === undefined || Number.isNaN(value);

export const symbolFor = (currency) => (currency === 'USD' ? '$' : '₹');

/** Indian numbering for rupees, Western for everything else. */
export function compact(value, currency = 'INR') {
  if (isNil(value)) return DASH;
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (currency === 'INR') {
    if (abs >= 1e7) return `${sign}${(abs / 1e7).toFixed(2)}Cr`;
    if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(2)}L`;
    if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  } else {
    if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  }
  return `${sign}${abs.toFixed(2)}`;
}

export function money(value, currency = 'INR') {
  if (isNil(value)) return DASH;
  return `${symbolFor(currency)}${compact(value, currency)}`;
}

/** Exact amount with separators — for figures that should not be rounded away. */
export function exact(value, currency = 'INR') {
  if (isNil(value)) return DASH;
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  return `${symbolFor(currency)}${value.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function percent(value, { sign = false, digits = 2 } = {}) {
  if (isNil(value)) return DASH;
  const prefix = sign && value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(digits)}%`;
}

export function ratio(value, digits = 2) {
  if (isNil(value)) return DASH;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function volume(value) {
  if (isNil(value)) return DASH;
  return compact(value, 'USD').replace(/^\$/, '');
}

/** screener reports market cap in ₹ crore; Nasdaq reports an absolute figure.
 *  Indian market caps stay in crore — that is how they are quoted, and the
 *  compact scale would render ₹11.3 lakh crore as an unreadable "1131512Cr". */
export function marketCap(value, unit, currency) {
  if (isNil(value)) return DASH;
  if (currency === 'INR') {
    const crore = unit === 'crore' ? value : value / 1e7;
    return `₹${Math.round(crore).toLocaleString('en-IN')} Cr`;
  }
  return money(unit === 'crore' ? value * 1e7 : value, currency);
}

export function date(value) {
  if (!value) return DASH;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return DASH;
  return parsed.toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

/** Whole months since a date, for "held at least N months". */
export function monthsSince(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const months =
    (new Date().getFullYear() - parsed.getFullYear()) * 12 +
    (new Date().getMonth() - parsed.getMonth());
  return months < 0 ? 0 : months;
}

export const toneFor = (value) =>
  isNil(value) || value === 0
    ? 'text-slate-300'
    : value > 0
      ? 'text-emerald-400'
      : 'text-rose-400';
