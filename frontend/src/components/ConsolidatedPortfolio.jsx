import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Search, TrendingUp, TrendingDown, Layers, Filter } from 'lucide-react';

export default function ConsolidatedPortfolio({ portfolioData, accounts, selectedAccountIds, setSelectedAccountIds, loading }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedSymbol, setExpandedSymbol] = useState(null);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-4">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-sm font-medium">Computing consolidated holdings & WACP...</p>
      </div>
    );
  }

  const { summary, items } = portfolioData || { summary: {}, items: [] };

  const filteredItems = (items || []).filter(item => 
    item.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.company_name && item.company_name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const toggleAccountFilter = (accId) => {
    if (selectedAccountIds.includes(accId)) {
      setSelectedAccountIds(selectedAccountIds.filter(id => id !== accId));
    } else {
      setSelectedAccountIds([...selectedAccountIds, accId]);
    }
  };

  const isPositive = (summary.total_pnl || 0) >= 0;

  return (
    <div className="space-y-6">
      
      {/* Metrics Overview Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        <div className="glass-panel p-5 rounded-2xl border border-slate-800">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Total Invested</p>
          <p className="text-2xl font-bold text-slate-100">
            ₹{(summary.total_invested || 0).toLocaleString('en-IN')}
          </p>
        </div>

        <div className="glass-panel p-5 rounded-2xl border border-slate-800">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Current Value</p>
          <p className="text-2xl font-bold text-white">
            ₹{(summary.current_value || 0).toLocaleString('en-IN')}
          </p>
        </div>

        <div className="glass-panel p-5 rounded-2xl border border-slate-800">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Overall P&L</p>
          <div className="flex items-baseline space-x-2">
            <p className={`text-2xl font-bold ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
              {isPositive ? '+' : ''}₹{(summary.total_pnl || 0).toLocaleString('en-IN')}
            </p>
            <span className={`inline-flex items-center text-xs font-bold px-2 py-0.5 rounded-full ${
              isPositive ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
            }`}>
              {isPositive ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
              {isPositive ? '+' : ''}{summary.total_pnl_percent || 0}%
            </span>
          </div>
        </div>

        <div className="glass-panel p-5 rounded-2xl border border-slate-800">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Holdings Count</p>
          <div className="flex items-center justify-between">
            <p className="text-2xl font-bold text-indigo-400">{summary.total_stocks_count || 0}</p>
            <span className="text-xs text-slate-400">Aggregated Tickers</span>
          </div>
        </div>

      </div>

      {/* Account Filters & Search Bar */}
      <div className="glass-panel p-4 rounded-2xl border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        
        {/* Account Checkboxes */}
        <div className="flex items-center space-x-2 flex-wrap gap-y-2">
          <span className="text-xs font-semibold text-slate-400 flex items-center mr-2">
            <Filter className="w-3.5 h-3.5 mr-1" /> Accounts:
          </span>
          {accounts.map(acc => {
            const isChecked = selectedAccountIds.length === 0 || selectedAccountIds.includes(acc.id);
            return (
              <button
                key={acc.id}
                onClick={() => toggleAccountFilter(acc.id)}
                className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${
                  isChecked
                    ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/40'
                    : 'bg-slate-900/40 text-slate-500 border-slate-800 hover:border-slate-700'
                }`}
              >
                {acc.name} ({acc.broker})
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative w-full md:w-64">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search stock symbol..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-4 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          />
        </div>

      </div>

      {/* Holdings Table */}
      <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-900/80 border-b border-slate-800 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="py-3.5 px-4">Stock</th>
                <th className="py-3.5 px-4 text-right">Qty</th>
                <th className="py-3.5 px-4 text-right">WACP (Avg)</th>
                <th className="py-3.5 px-4 text-right">LTP (Current)</th>
                <th className="py-3.5 px-4 text-right">Invested</th>
                <th className="py-3.5 px-4 text-right">Current Value</th>
                <th className="py-3.5 px-4 text-right">P&L</th>
                <th className="py-3.5 px-4 text-right">Weight %</th>
                <th className="py-3.5 px-4 text-center">Accounts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {filteredItems.map((item) => {
                const isExpanded = expandedSymbol === item.symbol;
                const pnlPos = item.pnl >= 0;

                return (
                  <React.Fragment key={item.symbol}>
                    <tr className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-100">{item.symbol}</div>
                        <div className="text-[10px] text-slate-400 truncate max-w-[160px]">{item.company_name}</div>
                      </td>
                      <td className="py-3.5 px-4 text-right font-medium text-slate-200">{item.total_quantity}</td>
                      <td className="py-3.5 px-4 text-right font-medium text-slate-200">₹{item.wacp}</td>
                      <td className="py-3.5 px-4 text-right font-medium text-slate-100">₹{item.current_price}</td>
                      <td className="py-3.5 px-4 text-right font-medium text-slate-300">₹{item.total_invested.toLocaleString('en-IN')}</td>
                      <td className="py-3.5 px-4 text-right font-semibold text-slate-100">₹{item.current_value.toLocaleString('en-IN')}</td>
                      <td className="py-3.5 px-4 text-right">
                        <div className={`font-bold ${pnlPos ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {pnlPos ? '+' : ''}₹{item.pnl.toLocaleString('en-IN')}
                        </div>
                        <div className={`text-[10px] ${pnlPos ? 'text-emerald-500' : 'text-rose-500'}`}>
                          {pnlPos ? '+' : ''}{item.pnl_percent}%
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right font-bold text-indigo-400">{item.allocation_percent}%</td>
                      <td className="py-3.5 px-4 text-center">
                        <button
                          onClick={() => setExpandedSymbol(isExpanded ? null : item.symbol)}
                          className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium border border-slate-700"
                        >
                          <Layers className="w-3 h-3 text-indigo-400" />
                          <span>{item.accounts_breakdown.length}</span>
                          {isExpanded ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
                        </button>
                      </td>
                    </tr>

                    {/* Drill-down drawer row */}
                    {isExpanded && (
                      <tr className="bg-slate-950/80">
                        <td colSpan="9" className="p-4 border-y border-indigo-500/20">
                          <div className="bg-slate-900/90 rounded-xl p-4 border border-slate-800">
                            <h4 className="text-xs font-bold text-indigo-300 uppercase tracking-wider mb-3 flex items-center">
                              <Layers className="w-3.5 h-3.5 mr-1.5" /> Account Breakdown for {item.symbol}
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                              {item.accounts_breakdown.map((acc, idx) => (
                                <div key={idx} className="bg-slate-950 p-3 rounded-lg border border-slate-800/80">
                                  <div className="flex justify-between items-center mb-1.5">
                                    <span className="font-semibold text-slate-200">{acc.account_name}</span>
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono">{acc.broker}</span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-1 text-[11px] text-slate-400">
                                    <div>Qty: <span className="font-medium text-slate-200">{acc.quantity}</span></div>
                                    <div>Avg: <span className="font-medium text-slate-200">₹{acc.avg_buy_price}</span></div>
                                    <div>Invested: <span className="font-medium text-slate-200">₹{acc.invested.toLocaleString('en-IN')}</span></div>
                                    <div>Value: <span className="font-medium text-slate-200">₹{acc.current_value.toLocaleString('en-IN')}</span></div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
