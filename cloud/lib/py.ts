// Python's number formatting, reproduced exactly so the website shows the
// same figures as the laptop to the last digit.
//
// Python's round() and "%.2f" round the exact binary value of the float, and
// break exact ties to even. JavaScript's Math.round and toFixed break ties
// upwards, so 0.125 -> 0.13 here but 0.12 there. These work on the exact
// decimal expansion (toFixed(100) is exact for every magnitude this app sees).

function digits(x: number, n: number): { negative: boolean; whole: string; frac: string } {
  const negative = x < 0 || Object.is(x, -0);
  const exact = Math.abs(x).toFixed(100);
  const [whole, fraction] = exact.split(".");
  const kept = fraction.slice(0, n);
  const rest = fraction.slice(n);
  let up: boolean;
  if (rest[0] > "5") up = true;
  else if (rest[0] < "5") up = false;
  else if (/[1-9]/.test(rest.slice(1))) up = true;
  else {
    const last = n > 0 ? kept[n - 1] : whole[whole.length - 1];
    up = Number(last) % 2 === 1;
  }
  let joined = whole + kept;
  if (up) {
    const chars = joined.split("");
    let i = chars.length - 1;
    while (i >= 0) {
      if (chars[i] === "9") { chars[i] = "0"; i--; }
      else { chars[i] = String(Number(chars[i]) + 1); break; }
    }
    joined = (i < 0 ? "1" : "") + chars.join("");
  }
  const cut = joined.length - n;
  return { negative, whole: joined.slice(0, cut).replace(/^0+(?=\d)/, ""), frac: joined.slice(cut) };
}

/** Python's round(x, n). */
export function round(x: number, n = 0): number {
  if (!Number.isFinite(x)) return x;
  const { negative, whole, frac } = digits(x, n);
  const value = Number(frac ? `${whole}.${frac}` : whole);
  return negative ? -value : value;
}

/** Python's f"{x:.{n}f}". */
export function fixed(x: number, n: number): string {
  const { negative, whole, frac } = digits(x, n);
  const body = frac ? `${whole}.${frac}` : whole;
  return negative ? `-${body}` : body;  // Python keeps the sign: -0.004 -> "-0.00"
}

/** A SQLite timestamp as FastAPI would serialise the datetime it reads:
 *  "2026-10-21 12:18:50.535963" -> "2026-10-21T12:18:50.535963",
 *  and no fraction at all when the microseconds are zero. */
export function iso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).replace(" ", "T");
  const match = /^(.*T\d\d:\d\d:\d\d)(?:\.(\d+))?(.*)$/.exec(text);
  if (!match) return text;
  const [, base, fraction = "", zone] = match;
  const micro = fraction.padEnd(6, "0").slice(0, 6);
  return micro === "000000" ? base + zone : `${base}.${micro}${zone}`;
}
