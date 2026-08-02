import React, { useState, useEffect } from 'react';
import { CheckCircle2, AlertTriangle, Trash2, Plus, X } from 'lucide-react';

export default function VerificationModal({ accounts, initialHoldings, targetAccountId, onClose, onSave }) {
  const [holdings, setHoldings] = useState(initialHoldings || []);
  const [selectedAccountId, setSelectedAccountId] = useState(targetAccountId || (accounts && accounts[0]?.id) || '');
  const [strategy, setStrategy] = useState('OVERWRITE');

  // Keep state synchronized whenever initialHoldings or targetAccountId props update
  useEffect(() => {
    setHoldings(initialHoldings || []);
  }, [initialHoldings]);

  useEffect(() => {
    if (targetAccountId) {
      setSelectedAccountId(targetAccountId);
    }
  }, [targetAccountId]);

  const targetAccount = (accounts || []).find(a => a.id === selectedAccountId);

  const handleRowChange = (index, field, value) => {
    const updated = [...holdings];
    updated[index][field] = value;
    setHoldings(updated);
  };

  const handleRemoveRow = (index) => {
    const updated = holdings.filter((_, i) => i !== index);
    setHoldings(updated);
  };

  const handleAddRow = () => {
    setHoldings([
      ...holdings,
      { symbol: 'NEWSTOCK', company_name: 'New Company', quantity: 10, avg_buy_price: 100.0, current_price: 100.0 }
    ]);
  };

  const handleConfirmSave = () => {
    if (!selectedAccountId) {
      alert("Please select a target Broker Account to save these extracted holdings to.");
      return;
    }
    onSave(holdings, selectedAccountId, strategy);
  };

  const totalExtractedValue = holdings.reduce((sum, item) => sum + (item.quantity * item.avg_buy_price), 0);
  const currencySymbol = targetAccount?.currency_type === 'US' ? '$' : '₹';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="glass-panel w-full max-w-4xl max-h-[90vh] rounded-2xl border border-slate-800 shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-800 bg-slate-900/80 flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">
                Review Extracted Stock Holdings ({holdings.length} Stocks Parsed)
              </h2>
              <p className="text-xs text-slate-400">Verify and edit parsed quantities and cost prices before saving to your account.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Controls */}
        <div className="p-6 pb-2 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="font-semibold text-slate-400 mb-1 block">1. Target Account</label>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-bold focus:outline-none focus:border-indigo-500"
            >
              {(accounts || []).map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({acc.currency_type === 'US' ? 'US $' : 'IND ₹'})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="font-semibold text-slate-400 mb-1 block">2. Ingestion Strategy</label>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500 font-medium"
            >
              <option value="OVERWRITE">OVERWRITE (Replace Account Holdings)</option>
              <option value="MERGE">MERGE (Smart Weighted Avg Cost Price)</option>
            </select>
          </div>

          <div>
            <label className="font-semibold text-slate-400 mb-1 block">3. Total Parsed Value</label>
            <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-emerald-400 font-bold text-sm">
              {currencySymbol}{totalExtractedValue.toLocaleString(targetAccount?.currency_type === 'US' ? 'en-US' : 'en-IN')}
            </div>
          </div>
        </div>

        {/* Editable Holdings Table */}
        <div className="p-6 flex-1 overflow-y-auto">
          <div className="rounded-xl border border-slate-800 overflow-hidden">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-900/90 text-slate-400 border-b border-slate-800 text-[11px] uppercase tracking-wider font-bold">
                  <th className="py-3 px-4">Symbol</th>
                  <th className="py-3 px-4">Company Name</th>
                  <th className="py-3 px-4 text-right">Quantity</th>
                  <th className="py-3 px-4 text-right">Avg Price ({currencySymbol})</th>
                  <th className="py-3 px-4 text-right">Market Price ({currencySymbol})</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {holdings.map((item, index) => (
                  <tr key={index} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-2.5 px-4">
                      <input
                        type="text"
                        value={item.symbol}
                        onChange={(e) => handleRowChange(index, 'symbol', e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-100 uppercase w-28 focus:outline-none focus:border-indigo-500"
                      />
                    </td>
                    <td className="py-2.5 px-4">
                      <input
                        type="text"
                        value={item.company_name}
                        onChange={(e) => handleRowChange(index, 'company_name', e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 w-full focus:outline-none focus:border-indigo-500"
                      />
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <input
                        type="number"
                        step="any"
                        value={item.quantity}
                        onChange={(e) => handleRowChange(index, 'quantity', parseFloat(e.target.value) || 0)}
                        className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs font-bold text-right text-slate-100 w-24 focus:outline-none focus:border-indigo-500"
                      />
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <input
                        type="number"
                        step="any"
                        value={item.avg_buy_price}
                        onChange={(e) => handleRowChange(index, 'avg_buy_price', parseFloat(e.target.value) || 0)}
                        className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs font-bold text-right text-slate-100 w-28 focus:outline-none focus:border-indigo-500"
                      />
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <input
                        type="number"
                        step="any"
                        value={item.current_price}
                        onChange={(e) => handleRowChange(index, 'current_price', parseFloat(e.target.value) || 0)}
                        className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs font-bold text-right text-indigo-400 w-28 focus:outline-none focus:border-indigo-500"
                      />
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      <button
                        onClick={() => handleRemoveRow(index)}
                        className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                        title="Remove Stock"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            onClick={handleAddRow}
            className="mt-3 flex items-center space-x-1 text-xs font-semibold text-indigo-400 hover:text-indigo-300"
          >
            <Plus className="w-4 h-4" />
            <span>Add Additional Holding Line</span>
          </button>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/80 flex justify-between items-center">
          <span className="text-xs text-slate-400">
            Total {holdings.length} stock line(s) ready to save.
          </span>
          <div className="flex items-center space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmSave}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 text-xs font-bold shadow-lg shadow-emerald-500/20"
            >
              Confirm & Save to Portfolio
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
