import React from 'react';
import { Briefcase, Users, Clock, Target, Info } from 'lucide-react';
import { exact, money, percent, ratio, date, monthsSince, toneFor, DASH } from './format';

function Stat({ label, value, tone = 'text-slate-100', hint }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
      <div className={`text-base font-bold mt-0.5 ${tone}`}>{value}</div>
      {hint && <div className="text-[10px] text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}

function Tag({ children }) {
  if (!children) return null;
  return (
    <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-[10px] font-semibold text-slate-300">
      {children}
    </span>
  );
}

/** How the position sits against its equal-weighted share of the target bucket. */
function TargetTracking({ tracking }) {
  if (!tracking) return null;

  if (!tracking.has_target) {
    return (
      <div className="mt-4 pt-4 border-t border-slate-800 text-[11px] text-slate-500 flex items-center gap-1.5">
        <Target className="w-3.5 h-3.5" />
        No target set for the {tracking.bucket} {tracking.dimension} bucket.
      </div>
    );
  }

  const drift = tracking.stock_delta_inr;
  const over = drift > 0;

  return (
    <div className="mt-4 pt-4 border-t border-slate-800">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <Target className="w-3.5 h-3.5 text-indigo-400" />
          <span className="font-semibold text-slate-300">{tracking.target_name}</span>
          <span className="text-slate-600">·</span>
          <span>{tracking.bucket} {tracking.dimension}</span>
        </div>
        <div className={`text-[11px] font-bold ${over ? 'text-amber-400' : 'text-sky-400'}`}>
          {over ? 'Over target by ' : 'Under target by '}{money(Math.abs(drift))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
        <Stat label="In bucket now" value={percent(tracking.stock_current_percent)} />
        <Stat label="Equal-weight target" value={percent(tracking.stock_target_percent)} />
        <Stat label="Target value" value={money(tracking.stock_target_inr)} />
        <Stat
          label="Bucket vs target"
          value={percent(tracking.bucket_current_percent)}
          hint={`target ${percent(tracking.bucket_target_percent)}`}
        />
      </div>
    </div>
  );
}

export default function PositionBand({ position, tracking }) {
  if (!position?.held) {
    return (
      <section className="glass-panel rounded-2xl border border-slate-800 p-5">
        <div className="flex items-center gap-2 text-slate-400 text-sm">
          <Info className="w-4 h-4" />
          You do not hold this stock in the accounts in scope.
        </div>
        {(position?.sector || position?.section) && (
          <div className="flex gap-2 mt-3">
            <Tag>{position.sector}</Tag>
            <Tag>{position.section}</Tag>
          </div>
        )}
      </section>
    );
  }

  const months = monthsSince(position.first_seen_at);
  const isUS = position.currency === 'USD';

  return (
    <section className="glass-panel rounded-2xl border border-indigo-500/30 bg-indigo-500/[0.03] p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-indigo-400" /> My position
        </h3>
        <div className="flex gap-2">
          <Tag>{position.sector}</Tag>
          <Tag>{position.section}</Tag>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <Stat label="Units" value={ratio(position.quantity, position.quantity % 1 ? 4 : 0)} />
        <Stat
          label="Avg cost"
          value={exact(position.avg_cost_inr)}
          hint={isUS ? `$${ratio(position.avg_cost_native)}` : null}
        />
        <Stat
          label="Current price"
          value={exact(position.current_price_inr)}
          hint={isUS ? `$${ratio(position.current_price_native)}` : null}
        />
        <Stat label="Current value" value={money(position.current_value_inr)}
              hint={`invested ${money(position.invested_inr)}`} />
        <Stat
          label="P&L"
          value={money(position.pnl_inr)}
          tone={toneFor(position.pnl_inr)}
          hint={percent(position.pnl_percent, { sign: true })}
        />
        <Stat label="% of portfolio" value={percent(position.portfolio_percent)} />
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5 text-slate-500" />
          {position.accounts.map((a) => a.account_name).join(', ')}
        </span>
        <span className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-slate-500" />
          {/* first_seen_at is when the stock first appeared in an import, not
              when it was bought, so it can only bound the holding period. */}
          Tracked since {date(position.first_seen_at)}
          {months !== null && months > 0 && ` · at least ${months} mo`}
        </span>
        {isUS && position.usd_inr_rate && (
          <span className="text-slate-500">
            Converted at ₹{ratio(position.usd_inr_rate)}/$
          </span>
        )}
      </div>

      {position.accounts.length > 1 && (
        <div className="mt-4 pt-4 border-t border-slate-800 overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-slate-500 text-left">
                <th className="font-semibold pb-1.5">Account</th>
                <th className="font-semibold pb-1.5 text-right">Units</th>
                <th className="font-semibold pb-1.5 text-right">Avg cost</th>
                <th className="font-semibold pb-1.5 text-right">Invested</th>
                <th className="font-semibold pb-1.5 text-right">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {position.accounts.map((a) => (
                <tr key={a.account_id}>
                  <td className="py-1.5 text-slate-300">{a.account_name}</td>
                  <td className="py-1.5 text-right text-slate-300">
                    {ratio(a.quantity, a.quantity % 1 ? 4 : 0)}
                  </td>
                  <td className="py-1.5 text-right text-slate-300">
                    {isUS ? `$${ratio(a.avg_cost_native)}` : exact(a.avg_cost_inr)}
                  </td>
                  <td className="py-1.5 text-right text-slate-300">{money(a.invested_inr)}</td>
                  <td className="py-1.5 text-right text-slate-200 font-semibold">
                    {money(a.current_value_inr)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TargetTracking tracking={tracking} />
    </section>
  );
}
