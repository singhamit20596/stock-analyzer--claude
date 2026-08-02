import React, { useState, useEffect } from 'react';
import { Wallet, TrendingUp, TrendingDown, RefreshCw, Globe, AlertCircle } from 'lucide-react';

export default function AccountDetailView({ accounts }) {
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [accountData, setAccountData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (accounts && accounts.length > 0 && !selectedAccountId) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts]);

  const fetchAccountDetail = async (accId) => {
    if (!accId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/accounts/${accId}/detail`);
      if (res.ok) {
        const data = await res.json();
        setAccountData(data);
      }
    } catch (e) {
      console.error("Error fetching account detail:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedAccountId) {
      fetchAccountDetail(selectedAccountId);
    }
  }, [selectedAccountId]);

  if (!accounts || accounts.length === 0) {
    return (
      <div className="glass-panel p-8 rounded-2xl border border-slate-800 text-center space-y-3">
        <AlertCircle className="w-8 h-8 text-amber-400 mx-auto" />
        <h3 className="text-base font-bold text-slate-200">No Broker Accounts Added Yet</h3>
        <p className="text-xs text-slate-400">Add an account from the "Account Ingestion" tab to view individual account metrics.</p>
      </div>
    );
  }

  const { summary, items, account_name, broker } = accountData || {
    summary: { invested_value: 0, current_value: 0, holding_count: 0, pnl: 0, pnl_percent: 0 },
    items: []
  };

  const isPositivePnl = (summary.pnl || 0) >= 0;

  return (
    <div className="space-y-6">
      
      {/* Account Selector Bar */}
      <div className="glass-panel p-5 rounded-2xl border border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center">
            <Wallet className="w-5 h-5 mr-2 text-indigo-400" /> Account Portfolio Summary
          </h2>
          <p className="text-xs text-slate-400">Select an account from the dropdown to inspect holdings with real-time market prices fetched directly from Google & Groww APIs.</p>
        </div>

        {/* Account Dropdown */}
        <div className="flex items-center space-x-3 w-full sm:w-auto">
          <label className="text-xs font-semibold text-slate-400 shrink-0">Select Account:</label>
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-100 focus:outline-none focus:border-indigo-500 w-full sm:w-64"
          >
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name} ({acc.broker})
              </option>
            ))}
          </select>

          <button
            onClick={() => fetchAccountDetail(selectedAccountId)}
            disabled={loading}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 shrink-0"
            title="Refresh Live Prices"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-4">
          <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm font-medium">Fetching real-time stock prices from Groww & Google Finance API for {account_name}...</p>
        </div>
      ) : (
        <>
          {/* Top 5 Metrics Banner */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            
            {/* 1. Invested Value */}
            <div className="glass-panel p-5 rounded-2xl border border-slate-800">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">1. Invested Value</p>
              <p className="text-xl font-bold text-slate-100">
                ₹{(summary.invested_value || 0).toLocaleString('en-IN')}
              </p>
              <span className="text-[10px] text-slate-500">Σ (Avg Price × Qty)</span>
            </div>

            {/* 2. Current Value */}
            <div className="glass-panel p-5 rounded-2xl border border-slate-800">
              <div className="flex justify-between items-center mb-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">2. Current Value</p>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center">
                  <Globe className="w-2.5 h-2.5 mr-1" /> Live Web API
                </span>
              </div>
              <p className="text-xl font-bold text-white">
                ₹{(summary.current_value || 0).toLocaleString('en-IN')}
              </p>
              <span className="text-[10px] text-slate-500">Σ (Live Price × Qty)</span>
            </div>

            {/* 3. Holding Count */}
            <div className="glass-panel p-5 rounded-2xl border border-slate-800">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">3. Holding Count</p>
              <p className="text-xl font-bold text-indigo-400">
                {summary.holding_count || 0}
              </p>
              <span className="text-[10px] text-slate-500">Unique Stock Lines</span>
            </div>

            {/* 4. PNL */}
            <div className="glass-panel p-5 rounded-2xl border border-slate-800">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">4. PNL</p>
              <p className={`text-xl font-bold ${isPositivePnl ? 'text-emerald-400' : 'text-rose-400'}`}>
                {isPositivePnl ? '+' : ''}₹{(summary.pnl || 0).toLocaleString('en-IN')}
              </p>
              <span className="text-[10px] text-slate-500">Current − Invested</span>
            </div>

            {/* 5. PNL % */}
            <div className="glass-panel p-5 rounded-2xl border border-slate-800">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">5. PNL %</p>
              <div className="flex items-center space-x-1.5 mt-0.5">
                <span className={`inline-flex items-center text-base font-extrabold px-2.5 py-0.5 rounded-lg ${
                  isPositivePnl
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                }`}>
                  {isPositivePnl ? <TrendingUp className="w-4 h-4 mr-1" /> : <TrendingDown className="w-4 h-4 mr-1" />}
                  {isPositivePnl ? '+' : ''}{summary.pnl_percent || 0}%
                </span>
              </div>
              <span className="text-[10px] text-slate-500 mt-1 block">(PNL / Invested) × 100</span>
            </div>

          </div>

          {/* Clean Holdings Table for Selected Account */}
          <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
            <div className="p-4 border-b border-slate-800 bg-slate-900/60 flex justify-between items-center">
              <div>
                <h3 className="text-sm font-bold text-slate-200">Holdings Breakdown for {account_name}</h3>
                <p className="text-xs text-slate-400">Broker: <span className="font-semibold text-slate-300">{broker}</span></p>
              </div>
              <span className="text-xs text-indigo-400 font-semibold flex items-center">
                <Globe className="w-3.5 h-3.5 mr-1" /> Real-Time Market Quotes Active
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-900/80 border-b border-slate-800 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="py-3.5 px-4">Stock</th>
                    <th className="py-3.5 px-4 text-right">Qty</th>
                    <th className="py-3.5 px-4 text-right">Avg Price (₹)</th>
                    <th className="py-3.5 px-4 text-right">Live Price (₹)</th>
                    <th className="py-3.5 px-4 text-right">Invested Value</th>
                    <th className="py-3.5 px-4 text-right">Current Value</th>
                    <th className="py-3.5 px-4 text-right">PNL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-xs">
                  {items.map((item) => {
                    const pnlPos = item.pnl >= 0;
                    return (
                      <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-slate-100">{item.symbol}</div>
                          <div className="text-[10px] text-slate-400 truncate max-w-[180px]">{item.company_name}</div>
                        </td>
                        <td className="py-3.5 px-4 text-right font-medium text-slate-200">{item.quantity}</td>
                        <td className="py-3.5 px-4 text-right font-medium text-slate-200">₹{item.avg_buy_price}</td>
                        <td className="py-3.5 px-4 text-right font-bold text-indigo-400">
                          ₹{item.live_current_price}
                        </td>
                        <td className="py-3.5 px-4 text-right font-medium text-slate-300">₹{item.invested_value.toLocaleString('en-IN')}</td>
                        <td className="py-3.5 px-4 text-right font-semibold text-slate-100">₹{item.current_value.toLocaleString('en-IN')}</td>
                        <td className="py-3.5 px-4 text-right">
                          <div className={`font-bold ${pnlPos ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {pnlPos ? '+' : ''}₹{item.pnl.toLocaleString('en-IN')}
                          </div>
                          <div className={`text-[10px] ${pnlPos ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {pnlPos ? '+' : ''}{item.pnl_percent}%
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

    </div>
  );
}
