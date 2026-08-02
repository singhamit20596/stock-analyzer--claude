import React, { useState, useEffect } from 'react';
import { Wallet, TrendingUp, TrendingDown, RefreshCw, Globe, AlertCircle, DollarSign, ArrowRightLeft, Upload, Image, Layers, X, CheckCircle2 } from 'lucide-react';

export default function AccountDetailView({ accounts, onImageOCRUpload }) {
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [accountData, setAccountData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Upload Holdings Modal State
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);

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

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFiles(Array.from(e.target.files));
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setSelectedFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    if (selectedFiles.length === 0) return;
    setUploading(true);
    try {
      await onImageOCRUpload(selectedFiles, selectedAccountId);
      setShowUploadModal(false);
      setSelectedFiles([]);
      setToastMessage("Holdings upload processed! Verify and save your parsed holdings.");
      setTimeout(() => setToastMessage(null), 5000);
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  if (!accounts || accounts.length === 0) {
    return (
      <div className="glass-panel p-8 rounded-2xl border border-slate-800 text-center space-y-3">
        <AlertCircle className="w-8 h-8 text-amber-400 mx-auto" />
        <h3 className="text-base font-bold text-slate-200">No Portfolio Accounts Added Yet</h3>
        <p className="text-xs text-slate-400">Add an account from the "Account Management" tab to view individual account metrics.</p>
      </div>
    );
  }

  const { summary, items, account_name, currency_type } = accountData || {
    summary: { invested_value: 0, current_value: 0, holding_count: 0, pnl: 0, pnl_percent: 0 },
    items: [],
    currency_type: 'IND'
  };

  const isUSAccount = (currency_type === 'US');
  const currencySymbol = isUSAccount ? '$' : '₹';
  const usdInrRate = summary.usd_to_inr_rate || 86.50;
  const isPositivePnl = (summary.pnl || 0) >= 0;

  return (
    <div className="space-y-6 relative">

      {/* Success Notification Banner */}
      {toastMessage && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 px-4 py-3 rounded-2xl text-xs font-semibold flex items-center justify-between animate-in fade-in duration-200">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-emerald-400 hover:text-emerald-200">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      
      {/* Account Selector & Header Action Bar */}
      <div className="glass-panel p-5 rounded-2xl border border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-lg font-bold text-slate-100 flex items-center">
              <Wallet className="w-5 h-5 mr-2 text-indigo-400" /> Account Portfolio Summary
            </h2>
            <span className={`text-xs font-extrabold px-2.5 py-0.5 rounded-md flex items-center ${
              isUSAccount ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
            }`}>
              {isUSAccount ? '🇺🇸 US Stocks ($ USD)' : '🇮🇳 Indian Stocks (₹ INR)'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">Real-time stock market quotes fetched via Yahoo Finance US & Groww Open API.</p>
        </div>

        {/* Live USD to INR Rate Badge for US Accounts */}
        {isUSAccount && (
          <div className="px-3.5 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-bold flex items-center space-x-2">
            <ArrowRightLeft className="w-4 h-4 text-amber-400" />
            <span>Live Rate: 1 USD = ₹{usdInrRate} INR</span>
          </div>
        )}

        {/* Account Selector + Refresh + Update Holdings Action Buttons */}
        <div className="flex items-center space-x-2.5 w-full md:w-auto">
          <label className="text-xs font-semibold text-slate-400 shrink-0">Account:</label>
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-slate-100 focus:outline-none focus:border-indigo-500 w-full md:w-56"
          >
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name} ({acc.currency_type === 'US' ? 'US $' : 'IND ₹'})
              </option>
            ))}
          </select>

          {/* Refresh Live Prices Button */}
          <button
            onClick={() => fetchAccountDetail(selectedAccountId)}
            disabled={loading}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 shrink-0 flex items-center transition-all"
            title="Refresh Live Prices"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {/* Update Holdings Button right next to Refresh Live Prices */}
          <button
            onClick={() => setShowUploadModal(true)}
            className="px-3.5 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-bold border border-emerald-500/30 shrink-0 flex items-center space-x-1.5 transition-all shadow-md shadow-emerald-500/10"
            title="Upload Screenshots to Update Holdings"
          >
            <Upload className="w-4 h-4 text-emerald-400" />
            <span className="hidden sm:inline">Update Holdings</span>
          </button>
        </div>
      </div>

      {/* Upload Holdings Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel max-w-lg w-full p-6 rounded-2xl border border-slate-700 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-slate-100 flex items-center">
                  <Upload className="w-5 h-5 mr-2 text-emerald-400" /> Update Holdings via Screenshot
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">Uploading for <span className="font-bold text-slate-200">{account_name}</span></p>
              </div>
              <button
                onClick={() => setShowUploadModal(false)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="space-y-4">
              {/* Drag & Drop Multi-File Zone */}
              <div
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all ${
                  dragActive ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-800 hover:border-slate-700 bg-slate-900/60'
                }`}
              >
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileChange}
                  className="hidden"
                  id="account-detail-screenshot-input"
                />
                <label htmlFor="account-detail-screenshot-input" className="cursor-pointer space-y-2 block">
                  <Image className="w-8 h-8 text-indigo-400 mx-auto" />
                  {selectedFiles.length > 0 ? (
                    <div>
                      <p className="text-xs font-bold text-emerald-400">{selectedFiles.length} Screenshot(s) Selected</p>
                      <p className="text-[10px] text-slate-400 truncate max-w-[240px] mx-auto mt-1">
                        {selectedFiles.map(f => f.name).join(', ')}
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs font-bold text-slate-200">Click or Drag & Drop Screenshots</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">PNG, JPG, WEBP formats supported</p>
                    </div>
                  )}
                </label>
              </div>

              <div className="flex justify-end space-x-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={selectedFiles.length === 0 || uploading}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-bold text-xs transition-all shadow-md shadow-emerald-500/20 disabled:opacity-50 flex items-center space-x-2"
                >
                  {uploading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
                      <span>Parsing {selectedFiles.length} File(s)...</span>
                    </>
                  ) : (
                    <>
                      <Layers className="w-4 h-4" />
                      <span>Process & Update Holdings</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-4">
          <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm font-medium">Fetching real-time stock prices from Live Market API for {account_name}...</p>
        </div>
      ) : (
        <>
          {/* Top 5 Metrics Banner (Dual USD + INR for US Accounts) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            
            {/* 1. Invested Value */}
            <div className="glass-panel p-5 rounded-2xl border border-slate-800">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">1. Invested Value</p>
              <p className="text-xl font-bold text-slate-100">
                {currencySymbol}{(summary.invested_value || 0).toLocaleString('en-US')}
              </p>
              {isUSAccount && summary.invested_value_inr && (
                <p className="text-xs font-semibold text-emerald-400 mt-1 flex items-center">
                  ₹{(summary.invested_value_inr).toLocaleString('en-IN')} INR
                </p>
              )}
              <span className="text-[10px] text-slate-500 block mt-0.5">Σ (Avg Price × Qty)</span>
            </div>

            {/* 2. Current Value */}
            <div className="glass-panel p-5 rounded-2xl border border-slate-800">
              <div className="flex justify-between items-center mb-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">2. Current Value</p>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center">
                  <Globe className="w-2.5 h-2.5 mr-1" /> Realtime API
                </span>
              </div>
              <p className="text-xl font-bold text-white">
                {currencySymbol}{(summary.current_value || 0).toLocaleString('en-US')}
              </p>
              {isUSAccount && summary.current_value_inr && (
                <p className="text-xs font-semibold text-emerald-400 mt-1 flex items-center">
                  ₹{(summary.current_value_inr).toLocaleString('en-IN')} INR
                </p>
              )}
              <span className="text-[10px] text-slate-500 block mt-0.5">Σ (Live Price × Qty)</span>
            </div>

            {/* 3. Holding Count */}
            <div className="glass-panel p-5 rounded-2xl border border-slate-800">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">3. Holding Count</p>
              <p className="text-xl font-bold text-indigo-400">
                {summary.holding_count || 0}
              </p>
              <span className="text-[10px] text-slate-500 block mt-[18px]">Unique Stock Lines</span>
            </div>

            {/* 4. PNL */}
            <div className="glass-panel p-5 rounded-2xl border border-slate-800">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">4. PNL</p>
              <p className={`text-xl font-bold ${isPositivePnl ? 'text-emerald-400' : 'text-rose-400'}`}>
                {isPositivePnl ? '+' : ''}{currencySymbol}{(summary.pnl || 0).toLocaleString('en-US')}
              </p>
              {isUSAccount && summary.pnl_inr !== undefined && (
                <p className={`text-xs font-semibold mt-1 flex items-center ${isPositivePnl ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {isPositivePnl ? '+' : ''}₹{(summary.pnl_inr).toLocaleString('en-IN')} INR
                </p>
              )}
              <span className="text-[10px] text-slate-500 block mt-0.5">Current − Invested</span>
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
              <span className="text-[10px] text-slate-500 mt-2 block">(PNL / Invested) × 100</span>
            </div>

          </div>

          {/* Clean Holdings Table for Selected Account */}
          <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
            <div className="p-4 border-b border-slate-800 bg-slate-900/60 flex justify-between items-center">
              <div>
                <h3 className="text-sm font-bold text-slate-200">Holdings Breakdown for {account_name}</h3>
                <p className="text-xs text-slate-400">Account Type: <span className="font-semibold text-indigo-400">{isUSAccount ? 'US Stocks ($ USD)' : 'Indian Stocks (₹ INR)'}</span></p>
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
                    <th className="py-3.5 px-4 text-right">Avg Price ({currencySymbol})</th>
                    <th className="py-3.5 px-4 text-right">Live Price ({currencySymbol})</th>
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
                        <td className="py-3.5 px-4 text-right font-medium text-slate-200">{currencySymbol}{item.avg_buy_price}</td>
                        <td className="py-3.5 px-4 text-right font-bold text-indigo-400">
                          {currencySymbol}{item.live_current_price}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <div className="font-medium text-slate-300">{currencySymbol}{item.invested_value.toLocaleString('en-US')}</div>
                          {isUSAccount && item.invested_value_inr && (
                            <div className="text-[10px] text-emerald-400/90 font-semibold">₹{item.invested_value_inr.toLocaleString('en-IN')}</div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <div className="font-semibold text-slate-100">{currencySymbol}{item.current_value.toLocaleString('en-US')}</div>
                          {isUSAccount && item.current_value_inr && (
                            <div className="text-[10px] text-emerald-400 font-semibold">₹{item.current_value_inr.toLocaleString('en-IN')}</div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <div className={`font-bold ${pnlPos ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {pnlPos ? '+' : ''}{currencySymbol}{item.pnl.toLocaleString('en-US')}
                          </div>
                          {isUSAccount && item.pnl_inr !== undefined && (
                            <div className={`text-[10px] font-semibold ${pnlPos ? 'text-emerald-400/90' : 'text-rose-400/90'}`}>
                              {pnlPos ? '+' : ''}₹{item.pnl_inr.toLocaleString('en-IN')}
                            </div>
                          )}
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
