import React from 'react';
import { Activity, Info } from 'lucide-react';
import { ratio, percent, symbolFor, toneFor, DASH } from './format';

/** RSI on its 0–100 scale with the conventional 30/70 marks drawn in.
 *  The marks are reference levels, not a call — the page states where price
 *  sits and leaves the reading to the assistant. */
function RsiGauge({ value }) {
  return (
    <div className="rounded-xl bg-slate-900/50 border border-slate-800 p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">RSI (14)</div>
      <div className="text-sm font-bold text-slate-100 mt-1">{ratio(value, 1)}</div>
      {value != null && (
        <div className="mt-2">
          <div className="h-1 rounded-full bg-slate-800 relative">
            <div className="absolute inset-y-0 w-px bg-slate-600" style={{ left: '30%' }} />
            <div className="absolute inset-y-0 w-px bg-slate-600" style={{ left: '70%' }} />
            <div className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-indigo-400 ring-2 ring-slate-900"
                 style={{ left: `calc(${Math.min(100, Math.max(0, value))}% - 4px)` }} />
          </div>
          <div className="flex justify-between text-[9px] text-slate-600 mt-1">
            <span>0</span><span>30</span><span>70</span><span>100</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Cell({ label, value, hint, tone = 'text-slate-100' }) {
  return (
    <div className="rounded-xl bg-slate-900/50 border border-slate-800 p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
      <div className={`text-sm font-bold mt-1 ${tone}`}>{value}</div>
      {hint && <div className="text-[10px] text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}

export default function TechnicalIndicators({ technicals, currency }) {
  if (!technicals || !Object.keys(technicals).length) {
    return null;
  }

  const unit = symbolFor(currency);
  const { macd = {}, levels = {} } = technicals;
  const price = (value) => (value == null ? DASH : `${unit}${ratio(value)}`);

  return (
    <section className="glass-panel rounded-2xl border border-slate-800 p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
          <Activity className="w-4 h-4 text-indigo-400" /> Technical indicators
        </h3>
        <span className="text-[10px] text-slate-500">
          from {technicals.sessions_used} daily sessions
        </span>
      </div>
      <p className="text-[11px] text-slate-500 mb-4 flex items-start gap-1.5">
        <Info className="w-3.5 h-3.5 mt-px shrink-0" />
        These are inputs, not a recommendation. Ask the assistant below to
        interpret them alongside the news.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <RsiGauge value={technicals.rsi_14} />
        <Cell
          label="MACD"
          value={ratio(macd.macd, 2)}
          tone={toneFor(macd.histogram)}
          hint={`signal ${ratio(macd.signal, 2)} · hist ${ratio(macd.histogram, 2)}`}
        />
        <Cell label="Support" value={price(levels.support)}
              hint={`recent low ${price(levels.recent_low)}`} />
        <Cell label="Resistance" value={price(levels.resistance)}
              hint={`recent high ${price(levels.recent_high)}`} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
        {[
          ['SMA 20', technicals.sma_20, technicals.price_vs_sma_20],
          ['SMA 50', technicals.sma_50, technicals.price_vs_sma_50],
          ['SMA 200', technicals.sma_200, technicals.price_vs_sma_200],
        ].map(([label, value, distance]) => (
          <div key={label}
               className="rounded-xl bg-slate-900/50 border border-slate-800 p-3 flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
              <div className="text-sm font-bold text-slate-100 mt-1">{price(value)}</div>
            </div>
            <div className={`text-[11px] font-bold ${toneFor(distance)}`}>
              {distance == null ? DASH : `${percent(distance, { sign: true, digits: 1 })}`}
              <div className="text-[9px] text-slate-600 font-normal text-right">vs price</div>
            </div>
          </div>
        ))}
      </div>

      {levels.lookback_sessions && (
        <div className="mt-3 text-[10px] text-slate-600">
          Support and resistance are the nearest swing levels in the last{' '}
          {levels.lookback_sessions} sessions.
        </div>
      )}
    </section>
  );
}
