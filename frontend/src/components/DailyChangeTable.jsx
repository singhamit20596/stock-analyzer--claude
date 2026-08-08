import React, { useCallback, useEffect, useState } from 'react';
import { CalendarRange, TrendingUp, TrendingDown, AlertCircle, Circle } from 'lucide-react';

const DASH = '—';

const fmtInr = (n) => n == null ? DASH :
  `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const fmtPct = (n, sign = true) => n == null ? DASH :
  `${sign && n > 0 ? '+' : ''}${n.toFixed(2)}%`;

const dayLabel = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return {
    day: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    weekday: d.toLocaleDateString('en-IN', { weekday: 'short' }),
  };
};

const tone = (n) => n == null ? 'text-slate-500' : n > 0 ? 'text-emerald-400'
  : n < 0 ? 'text-rose-400' : 'text-slate-300';

export default function DailyChangeTable({ portfolioId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!portfolioId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/portfolios/${portfolioId}/daily`);
      if (res.ok) setData(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [portfolioId]);

  useEffect(() => { load(); }, [load]);

  const panel = (children) => (
    <div className="glass-panel rounded-2xl border border-slate-800 p-5">{children}</div>
  );

  if (loading) return panel(
    <div className="flex items-center justify-center py-10 gap-3 text-slate-400">
      <div className="w-6 h-6 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-xs">Loading daily changes...</p>
    </div>
  );

  const days = data?.days || [];
  if (!days.length) return panel(
    <div className="py-8 text-center text-slate-400 text-sm">
      <AlertCircle className="w-6 h-6 mx-auto mb-2 text-slate-600" />
      No daily history yet. It builds up each day you open this portfolio.
    </div>
  );

  const recorded = data.recorded_in_window || 0;

  return (
    <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden">
      <div className="p-5 pb-3 flex flex-col sm:flex-row sm:items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <CalendarRange className="w-4 h-4 text-indigo-400" />
            Daily P&amp;L
          </h3>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Day-on-day move for every session, most recent first. Showing the
            last {data.shown} · {data.stored_total} day{data.stored_total === 1 ? '' : 's'} on record.
          </p>
        </div>
      </div>

      {/* 30 rows is more than fits comfortably, so the body scrolls under a
          pinned header rather than pushing the rest of the page down. */}
      <div className="max-h-[420px] overflow-y-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="sticky top-0 bg-slate-900/95 backdrop-blur z-10">
            <tr className="text-[9px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-800">
              <th className="py-2 px-4">Date</th>
              <th className="py-2 px-3 text-right">Day P&amp;L</th>
              <th className="py-2 px-3 text-right">Day %</th>
              <th className="py-2 px-3 text-right">Value</th>
              <th className="py-2 px-4 text-right">Total P&amp;L</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {days.map((d) => {
              const { day, weekday } = dayLabel(d.date);
              const up = d.change_inr != null && d.change_inr >= 0;
              return (
                <tr key={d.date} className="hover:bg-slate-800/30 transition-colors">
                  <td className="py-2 px-4 whitespace-nowrap">
                    <span className="font-semibold text-slate-200">{day}</span>
                    <span className="text-slate-600 ml-1.5 text-[10px]">{weekday}</span>
                    {d.source === 'recorded' && (
                      <Circle
                        className="inline w-1.5 h-1.5 ml-1.5 fill-indigo-400 text-indigo-400"
                        aria-label="recorded live"
                      />
                    )}
                  </td>
                  <td className={`py-2 px-3 text-right font-bold tabular-nums ${tone(d.change_inr)}`}>
                    <span className="inline-flex items-center gap-1 justify-end">
                      {d.change_inr != null && (up
                        ? <TrendingUp className="w-3 h-3" />
                        : <TrendingDown className="w-3 h-3" />)}
                      {d.change_inr == null ? DASH : `${up ? '+' : ''}${fmtInr(d.change_inr)}`}
                    </span>
                  </td>
                  <td className={`py-2 px-3 text-right font-semibold tabular-nums ${tone(d.change_percent)}`}>
                    {fmtPct(d.change_percent)}
                    {d.spans_sources && (
                      <span className="text-slate-600 ml-1" title="Measured across the switch from reconstructed to recorded values">*</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right text-slate-300 tabular-nums">
                    {fmtInr(d.value_inr)}
                  </td>
                  <td className="py-2 px-4 text-right tabular-nums">
                    {d.pnl_inr == null ? (
                      <span className="text-slate-600">{DASH}</span>
                    ) : (
                      <>
                        <span className={`font-bold ${tone(d.pnl_inr)}`}>
                          {d.pnl_inr > 0 ? '+' : ''}{fmtInr(d.pnl_inr)}
                        </span>
                        <span className={`ml-1.5 text-[10px] ${tone(d.pnl_percent)}`}>
                          {fmtPct(d.pnl_percent)}
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-3 border-t border-slate-800 text-[10px] text-slate-500 space-y-1">
        <p className="flex items-start gap-1.5">
          <Circle className="w-1.5 h-1.5 mt-1 shrink-0 fill-indigo-400 text-indigo-400" />
          <span>
            {recorded > 0
              ? `${recorded} day${recorded === 1 ? '' : 's'} in this window were recorded live and include total P&L.`
              : 'Days recorded live will include total P&L.'}
            {' '}Earlier days are reconstructed from price history — they value
            today's holdings at old closes, so they cannot show what was
            actually held then, and have no cost basis to compute P&L against.
          </span>
        </p>
      </div>
    </div>
  );
}
