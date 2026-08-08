import React from 'react';
import { CalendarDays } from 'lucide-react';
import { ratio, percent, money, symbolFor, toneFor, DASH } from './format';

const LABELS = {
  revenue: 'Revenue',
  operating_profit: 'Operating profit',
  gross_profit: 'Gross profit',
  net_profit: 'Net profit',
  eps: 'EPS',
};

const ORDER = ['revenue', 'gross_profit', 'operating_profit', 'net_profit', 'eps'];

// screener reports in ₹ crore, which is how Indian results are read, so those
// are left as they come. Nasdaq reports in thousands of dollars, where a
// quarter runs to nine digits, so those are scaled up and abbreviated instead.
function formatCell(value, rowKey, currency) {
  if (value == null) return DASH;
  if (rowKey === 'eps') return `${symbolFor(currency)}${ratio(value)}`;
  if (currency === 'USD') return money(value * 1000, currency);
  return ratio(value, 0);
}

const UNIT_NOTE = { INR: '₹ crore', USD: '' };

export default function QuarterlyTable({ quarterly, currency }) {
  if (!quarterly?.rows?.length) {
    return (
      <section className="glass-panel rounded-2xl border border-slate-800 p-5">
        <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2 mb-2">
          <CalendarDays className="w-4 h-4 text-indigo-400" /> Quarterly results
        </h3>
        <p className="text-xs text-slate-500">
          Quarterly results were not available from the data provider.
        </p>
      </section>
    );
  }

  const { columns, rows, growth_basis: basis } = quarterly;
  const sorted = [...rows].sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  const basisLabel = basis === 'yoy' ? 'YoY' : 'QoQ';

  return (
    <section className="glass-panel rounded-2xl border border-slate-800 p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-indigo-400" /> Quarterly results
        </h3>
        <span className="text-[10px] text-slate-500">
          {UNIT_NOTE[currency] ? `${UNIT_NOTE[currency]} · ` : ''}growth is {basisLabel}
        </span>
      </div>
      {basis === 'qoq' && (
        <p className="text-[11px] text-slate-500 mb-3">
          The provider serves only four quarters for this market, so there is no
          year-ago quarter to compare against — growth is against the previous
          quarter.
        </p>
      )}

      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full text-[11px] min-w-[560px]">
          <thead>
            <tr className="text-slate-500">
              <th className="text-left font-semibold pb-2 sticky left-0 bg-slate-950/80 pr-3">
                Metric
              </th>
              {columns.map((column) => (
                <th key={column} className="text-right font-semibold pb-2 px-2 whitespace-nowrap">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {sorted.map((row) => (
              <React.Fragment key={row.key}>
                <tr>
                  <td className="py-1.5 text-slate-300 font-semibold sticky left-0 bg-slate-950/80 pr-3">
                    {LABELS[row.key] || row.key}
                  </td>
                  {row.values.map((value, i) => (
                    <td key={i} className="py-1.5 px-2 text-right text-slate-200 whitespace-nowrap">
                      {formatCell(value, row.key, currency)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="pb-1.5 text-[10px] text-slate-600 sticky left-0 bg-slate-950/80 pr-3">
                    {basisLabel} growth
                  </td>
                  {row.growth.map((value, i) => (
                    <td key={i} className={`pb-1.5 px-2 text-right text-[10px] whitespace-nowrap ${toneFor(value)}`}>
                      {value == null ? DASH : percent(value, { sign: true, digits: 1 })}
                    </td>
                  ))}
                </tr>
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
