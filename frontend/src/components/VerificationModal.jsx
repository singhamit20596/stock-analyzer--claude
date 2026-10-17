import React, { useState, useEffect } from 'react';
import { CheckCircle2, Trash2, Plus, X } from 'lucide-react';

export default function VerificationModal({ accounts, initialHoldings, marketGuesses, targetAccountId, onClose, onSave }) {
  const [holdings, setHoldings] = useState(initialHoldings || []);
  const [selectedAccountId, setSelectedAccountId] = useState(targetAccountId || (accounts && accounts[0]?.id) || '');
  // MERGE, not OVERWRITE: a long holdings table takes several screenshots to
  // capture, and OVERWRITE treats whichever page was uploaded as the entire
  // account, deleting every position that did not fit in it.
  const [strategy, setStrategy] = useState('MERGE');
  // What the account already holds, so the rows *missing* from this upload can
  // be shown. MERGE silently keeps them, which is right for a screenshot that
  // is only one page of the table and wrong for a position that was sold —
  // and nothing in the UI used to distinguish the two.
  const [existing, setExisting] = useState([]);
  const [removeSymbols, setRemoveSymbols] = useState([]);

  // Keep state synchronized whenever initialHoldings or targetAccountId props update
  useEffect(() => {
    setHoldings(initialHoldings || []);
  }, [initialHoldings]);

  useEffect(() => {
    if (targetAccountId) {
      setSelectedAccountId(targetAccountId);
    }
  }, [targetAccountId]);

  useEffect(() => {
    if (!selectedAccountId) { setExisting([]); return undefined; }
    let live = true;
    setRemoveSymbols([]);
    fetch(`/api/accounts/${selectedAccountId}/detail`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((body) => { if (live) setExisting(body.items || []); })
      .catch(() => { if (live) setExisting([]); });
    return () => { live = false; };
  }, [selectedAccountId]);

  const targetAccount = (accounts || []).find(a => a.id === selectedAccountId);

  const uploaded = new Set(
    holdings.map((h) => String(h.symbol || '').trim().toUpperCase()));
  // OVERWRITE already drops everything absent, so the choice only applies to MERGE.
  const missing = strategy === 'MERGE'
    ? existing.filter((h) => !uploaded.has(String(h.symbol || '').trim().toUpperCase()))
    : [];

  // A screenshot cannot say which account it came from, so saving a US
  // statement to an INR account is accepted in full and every row is stamped
  // INR. That is how nine of Preeti's US positions ended up in her Indian
  // account, priced as rupees. The mismatch is only ever flagged, never
  // blocked — the guess is a heuristic and the user knows their own accounts.
  const wantMarket = targetAccount?.currency_type === 'US' ? 'US' : 'IND';
  const mismatched = holdings.filter((h) => {
    const guess = (marketGuesses || {})[String(h.symbol || '').trim().toUpperCase()];
    return guess && guess !== wantMarket;
  });
  const mostlyWrongMarket = holdings.length > 0
    && mismatched.length >= Math.max(2, Math.ceil(holdings.length / 2));

  const toggleRemove = (symbol) => {
    setRemoveSymbols((current) => (current.includes(symbol)
      ? current.filter((s) => s !== symbol)
      : [...current, symbol]));
  };

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
    onSave(holdings, selectedAccountId, strategy, removeSymbols);
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
              <option value="MERGE">MERGE (update these rows, keep the rest)</option>
              <option value="OVERWRITE">OVERWRITE (this upload is the whole account)</option>
            </select>
            {strategy === 'OVERWRITE' && (
              <p className="mt-2 text-[11px] leading-snug text-amber-400 font-medium">
                Removes every holding in this account that is not among the {holdings.length} rows
                below. Only correct if these screenshots cover the entire table — upload all
                the pages together, not one at a time.
              </p>
            )}
          </div>

          <div>
            <label className="font-semibold text-slate-400 mb-1 block">3. Total Parsed Value</label>
            <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-emerald-400 font-bold text-sm">
              {currencySymbol}{totalExtractedValue.toLocaleString(targetAccount?.currency_type === 'US' ? 'en-US' : 'en-IN')}
            </div>
          </div>
        </div>

        {mostlyWrongMarket && (
          <div className="px-6 pt-4">
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3">
              <p className="text-[11px] font-bold text-rose-300">
                These look like {mismatched[0] && (marketGuesses[String(mismatched[0].symbol).trim().toUpperCase()] === 'US')
                  ? 'US' : 'Indian'} tickers, but
                {' '}<span className="underline">{targetAccount?.name}</span> is
                {' '}{wantMarket === 'US' ? 'a US ($)' : 'an Indian (₹)'} account.
              </p>
              <p className="text-[10px] text-slate-300 mt-1">
                {mismatched.length} of {holdings.length} rows: {mismatched.slice(0, 8).map(h => h.symbol).join(', ')}
                {mismatched.length > 8 ? '…' : ''}. Saving here stamps them
                {' '}{wantMarket === 'US' ? 'USD' : 'INR'}, so prices and P&L will be wrong.
                Pick the right account above if this is the wrong one.
              </p>
            </div>
          </div>
        )}

        {/* Held now but absent from this upload. MERGE keeps these, which is
            correct for one page of a longer table and wrong for a sale, so the
            choice is put in front of the user rather than assumed. */}
        {missing.length > 0 && (
          <div className="px-6 pt-4">
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-[11px] font-bold text-amber-300 mb-1">
                {missing.length} holding{missing.length > 1 ? 's' : ''} in this account
                {' '}{missing.length > 1 ? 'are' : 'is'} not in this upload
              </p>
              <p className="text-[10px] text-slate-400 mb-2">
                They stay untouched unless you tick them — right if this is one page of a
                longer table, wrong if you have sold them.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {missing.map((h) => {
                  const picked = removeSymbols.includes(h.symbol);
                  return (
                    <button
                      key={h.symbol}
                      onClick={() => toggleRemove(h.symbol)}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] font-semibold
                        transition-colors ${picked
                          ? 'bg-rose-600/20 border-rose-500/60 text-rose-300 line-through'
                          : 'bg-slate-900/70 border-slate-700 text-slate-300 hover:border-slate-500'}`}
                      title={picked ? 'Will be removed' : 'Click if this holding was sold'}
                    >
                      {picked ? <Trash2 className="w-3 h-3" /> : <Plus className="w-3 h-3 rotate-45" />}
                      {h.symbol}
                      <span className="text-slate-500 font-normal">{h.quantity}</span>
                    </button>
                  );
                })}
              </div>
              {removeSymbols.length > 0 && (
                <p className="text-[10px] text-rose-300 mt-2 font-semibold">
                  {removeSymbols.length} will be removed and logged as sold.
                </p>
              )}
            </div>
          </div>
        )}

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
