import React from 'react';
import { BarChart3, Layers } from 'lucide-react';
import { marketCap, money, percent, ratio, volume, symbolFor, DASH } from './format';

function Cell({ label, value, hint }) {
  return (
    <div className="rounded-xl bg-slate-900/50 border border-slate-800 p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
      <div className="text-sm font-bold text-slate-100 mt-1">{value}</div>
      {hint && <div className="text-[10px] text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}

function Range52({ low, high, current, currency }) {
  const unit = symbolFor(currency);
  const span = high - low;
  const at = span > 0 && current != null
    ? Math.min(100, Math.max(0, ((current - low) / span) * 100))
    : null;

  return (
    <div className="rounded-xl bg-slate-900/50 border border-slate-800 p-3 col-span-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">52-week range</div>
      <div className="text-sm font-bold text-slate-100 mt-1">
        {unit}{ratio(low)} – {unit}{ratio(high)}
      </div>
      {at !== null && (
        <div className="mt-2">
          <div className="h-1 rounded-full bg-slate-800 relative">
            <div className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-indigo-400 ring-2 ring-slate-900"
                 style={{ left: `calc(${at}% - 4px)` }} />
          </div>
          <div className="text-[10px] text-slate-500 mt-1">{at.toFixed(0)}% of the range</div>
        </div>
      )}
    </div>
  );
}

/** Funds have no P/E, ROE or book value — showing those cards empty would
 *  imply the data was merely missing, so they are replaced outright. */
function EtfFacts({ facts, currency }) {
  return (
    <section className="glass-panel rounded-2xl border border-slate-800 p-5">
      <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2 mb-1">
        <Layers className="w-4 h-4 text-indigo-400" /> Fund facts
      </h3>
      <p className="text-[11px] text-slate-500 mb-4">
        This is a fund, not a company: earnings-based ratios do not apply to it.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {facts.expense_ratio != null && (
          <Cell label="Expense ratio" value={percent(facts.expense_ratio)} />
        )}
        {facts.aum_thousands != null && (
          <Cell label="Assets under mgmt" value={money(facts.aum_thousands * 1000, currency)} />
        )}
        {facts.beta != null && <Cell label="Beta" value={ratio(facts.beta)} />}
        {facts.average_volume != null && (
          <Cell label="Avg volume" value={volume(facts.average_volume)} />
        )}
        {facts.market_cap != null && (
          <Cell label="Market cap"
                value={marketCap(facts.market_cap, facts.market_cap_unit, currency)} />
        )}
        {facts.week52_high != null && (
          <Range52 low={facts.week52_low} high={facts.week52_high}
                   current={facts.current_price} currency={currency} />
        )}
      </div>
    </section>
  );
}

export default function RatiosGrid({ ratios, etfFacts, isEtf, currency, price }) {
  if (isEtf) {
    return <EtfFacts facts={{ ...etfFacts, current_price: price }} currency={currency} />;
  }

  const has = ratios && Object.values(ratios).some((v) => v !== null && v !== undefined);
  if (!has) {
    return (
      <section className="glass-panel rounded-2xl border border-slate-800 p-5">
        <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2 mb-2">
          <BarChart3 className="w-4 h-4 text-indigo-400" /> Key ratios
        </h3>
        <p className="text-xs text-slate-500">
          Ratios were not available from the data provider for this stock.
        </p>
      </section>
    );
  }

  return (
    <section className="glass-panel rounded-2xl border border-slate-800 p-5">
      <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2 mb-4">
        <BarChart3 className="w-4 h-4 text-indigo-400" /> Key ratios
      </h3>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Cell label="P/E" value={ratio(ratios.pe)} />
        <Cell label="P/B" value={ratio(ratios.pb)} />
        <Cell label="ROE" value={percent(ratios.roe)} />
        <Cell label="ROCE" value={percent(ratios.roce)} />
        <Cell label="Dividend yield" value={percent(ratios.dividend_yield)} />
        <Cell label="Market cap"
              value={marketCap(ratios.market_cap, ratios.market_cap_unit, currency)} />
        <Cell label="Book value"
              value={ratios.book_value != null
                ? `${symbolFor(currency)}${ratio(ratios.book_value)}` : DASH}
              hint="per share" />
        {ratios.analyst_target != null
          ? <Cell label="Analyst target"
                  value={`${symbolFor(currency)}${ratio(ratios.analyst_target)}`}
                  hint="1-year consensus" />
          : <Cell label="Face value"
                  value={ratios.face_value != null
                    ? `${symbolFor(currency)}${ratio(ratios.face_value)}` : DASH} />}

        {ratios.week52_high != null && (
          <Range52 low={ratios.week52_low} high={ratios.week52_high}
                   current={price} currency={currency} />
        )}
      </div>
    </section>
  );
}
