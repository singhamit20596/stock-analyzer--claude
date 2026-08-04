import React, { useState, useEffect } from 'react';
import { Wallet, TrendingUp, TrendingDown, RefreshCw, Globe, AlertCircle, DollarSign, ArrowRightLeft, Upload, Image, Layers, X, CheckCircle2, PiggyBank, ChevronRight } from 'lucide-react';

// Update type options
const UPDATE_TYPES = {
  HOLDINGS: 'holdings',
  WALLET: 'wallet',
  BOTH: 'both',
};

export default function AccountDetailView({ accounts, onImageOCRUpload }) {
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [accountData, setAccountData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Update Modal Step State
  // step: 'select_type' | 'wallet_input' | 'screenshot_upload'
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateStep, setUpdateStep] = useState('select_type');
  const [updateType, setUpdateType] = useState(null);
  const [walletBalanceInput, setWalletBalanceInput] = useState('');
  const [savingWallet, setSavingWallet] = useState(false);

  // Screenshot upload state
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

  // --- Modal Helpers ---
  const openUpdateModal = () => {
    setUpdateStep('select_type');
    setUpdateType(null);
    setWalletBalanceInput('');
    setSelectedFiles([]);
    setShowUpdateModal(true);
  };

  const closeUpdateModal = () => {
    setShowUpdateModal(false);
    setUpdateStep('select_type');
    setUpdateType(null);
    setWalletBalanceInput('');
    setSelectedFiles([]);
  };

  const handleUpdateTypeSelect = (type) => {
    setUpdateType(type);
    if (type === UPDATE_TYPES.HOLDINGS) {
      setUpdateStep('screenshot_upload');
    } else if (type === UPDATE_TYPES.WALLET) {
      setUpdateStep('wallet_input');
    } else if (type === UPDATE_TYPES.BOTH) {
      setUpdateStep('wallet_input');
    }
  };

  // --- Wallet Balance Save ---
  const handleSaveWalletBalance = async () => {
    const balance = parseFloat(walletBalanceInput);
    if (isNaN(balance) || balance < 0) {
      alert("Please enter a valid wallet balance (0 or greater).");
      return;
    }
    setSavingWallet(true);
    try {
      const res = await fetch(`/api/accounts/${selectedAccountId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_balance: balance })
      });
      if (res.ok) {
        if (updateType === UPDATE_TYPES.BOTH) {
          // Proceed to screenshot upload step
          setUpdateStep('screenshot_upload');
        } else {
          // Done — close modal and refresh
          closeUpdateModal();
          await fetchAccountDetail(selectedAccountId);
          setToastMessage(`Wallet balance updated to ${currencySymbol}${balance.toLocaleString()}`);
          setTimeout(() => setToastMessage(null), 5000);
        }
      }
    } catch (e) {
      console.error("Error updating wallet balance:", e);
    } finally {
      setSavingWallet(false);
    }
  };

  // --- Screenshot Upload ---
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
      closeUpdateModal();
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

  const { summary, items, account_name, currency_type, wallet_balance } = accountData || {
    summary: { invested_value: 0, current_value: 0, holding_count: 0, pnl: 0, pnl_percent: 0, wallet_balance: 0 },
    items: [],
    currency_type: 'IND',
    wallet_balance: 0
  };

  const isUSAccount = (currency_type === 'US');
  const currencySymbol = isUSAccount ? '$' : '₹';
  const usdInrRate = summary.usd_to_inr_rate || 86.50;
  const isPositivePnl = (summary.pnl || 0) >= 0;
  const walletBal = wallet_balance ?? summary.wallet_balance ?? 0;
  const hasWalletBalance = walletBal > 0;

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

        {/* Account Selector + Refresh + Update Action Buttons */}
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

          {/* Update Button — triggers the multi-step modal */}
          <button
            onClick={openUpdateModal}
            className="px-3.5 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-bold border border-emerald-500/30 shrink-0 flex items-center space-x-1.5 transition-all shadow-md shadow-emerald-500/10"
            title="Update Holdings or Wallet Balance"
          >
            <Upload className="w-4 h-4 text-emerald-400" />
            <span className="hidden sm:inline">Update</span>
          </button>
        </div>
      </div>

      {/* Multi-Step Update Modal */}
      {showUpdateModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel max-w-lg w-full p-6 rounded-2xl border border-slate-700 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200">

            {/* Modal Header */}
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-slate-100 flex items-center">
                  <Upload className="w-5 h-5 mr-2 text-emerald-400" />
                  Update Account — <span className="text-indigo-300 ml-1">{account_name}</span>
                </h3>
                <div className="flex items-center space-x-2 mt-1.5 text-[10px] text-slate-400 font-semibold">
                  {['select_type', 'wallet_input', 'screenshot_upload'].map((s, i) => {
                    const stepLabels = { select_type: 'Choose Type', wallet_input: 'Wallet Balance', screenshot_upload: 'Upload Screenshots' };
                    const active = updateStep === s;
                    const done = (updateStep === 'wallet_input' && s === 'select_type') ||
                                 (updateStep === 'screenshot_upload' && (s === 'select_type' || s === 'wallet_input'));
                    return (
                      <React.Fragment key={s}>
                        <span className={`px-2 py-0.5 rounded-md font-bold ${active ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : done ? 'text-emerald-400' : 'text-slate-500'}`}>
                          {done ? '✓ ' : ''}{stepLabels[s]}
                        </span>
                        {i < 2 && <ChevronRight className="w-3 h-3 text-slate-600" />}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
              <button onClick={closeUpdateModal} className="text-slate-400 hover:text-slate-200 p-1 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* STEP 1: Select Update Type */}
            {updateStep === 'select_type' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-400">What would you like to update for <span className="font-bold text-slate-200">{account_name}</span>?</p>
                {[
                  { type: UPDATE_TYPES.HOLDINGS, icon: <Layers className="w-5 h-5 text-indigo-400" />, label: 'Holdings Only', desc: 'Upload broker screenshot(s) to update stock positions' },
                  { type: UPDATE_TYPES.WALLET, icon: <PiggyBank className="w-5 h-5 text-amber-400" />, label: 'Wallet Balance Only', desc: 'Enter your uninvested cash balance sitting in the broker' },
                  { type: UPDATE_TYPES.BOTH, icon: <DollarSign className="w-5 h-5 text-emerald-400" />, label: 'Both — Wallet & Holdings', desc: 'First update wallet balance, then upload screenshots' },
                ].map(({ type, icon, label, desc }) => (
                  <button
                    key={type}
                    onClick={() => handleUpdateTypeSelect(type)}
                    className="w-full flex items-center space-x-4 p-4 rounded-xl border border-slate-700 hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all text-left group"
                  >
                    <div className="p-2 rounded-lg bg-slate-800 group-hover:bg-slate-700 border border-slate-700 shrink-0">{icon}</div>
                    <div>
                      <p className="text-sm font-bold text-slate-100">{label}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-600 ml-auto shrink-0 group-hover:text-indigo-400" />
                  </button>
                ))}
              </div>
            )}

            {/* STEP 2: Wallet Balance Input */}
            {updateStep === 'wallet_input' && (
              <div className="space-y-4">
                <div className="flex items-center space-x-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <PiggyBank className="w-5 h-5 text-amber-400 shrink-0" />
                  <p className="text-xs text-amber-200">Enter the uninvested cash balance currently sitting idle in your <span className="font-bold">{account_name}</span> broker account.</p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1.5">
                    Wallet / Cash Balance ({currencySymbol})
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">{currencySymbol}</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={walletBalanceInput}
                      onChange={(e) => setWalletBalanceInput(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-7 pr-4 py-3 text-slate-100 font-bold text-lg focus:outline-none focus:border-indigo-500"
                      autoFocus
                    />
                  </div>
                  {hasWalletBalance && (
                    <p className="text-[11px] text-slate-500 mt-1">Current stored balance: {currencySymbol}{walletBal.toLocaleString()}</p>
                  )}
                </div>
                <div className="flex justify-between items-center pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setUpdateStep('select_type')}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={handleSaveWalletBalance}
                    disabled={savingWallet || walletBalanceInput === ''}
                    className="px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 text-xs font-bold shadow-lg shadow-amber-500/20 disabled:opacity-50 flex items-center space-x-2"
                  >
                    {savingWallet ? (
                      <><div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" /><span>Saving...</span></>
                    ) : updateType === UPDATE_TYPES.BOTH ? (
                      <><span>Save & Continue to Holdings</span><ChevronRight className="w-4 h-4" /></>
                    ) : (
                      <><PiggyBank className="w-4 h-4" /><span>Save Wallet Balance</span></>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: Screenshot Upload */}
            {updateStep === 'screenshot_upload' && (
              <form onSubmit={handleUploadSubmit} className="space-y-4">
                {updateType === UPDATE_TYPES.BOTH && (
                  <div className="flex items-center space-x-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Wallet balance saved! Now upload your screenshot to update stock holdings.</span>
                  </div>
                )}
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
                        <p className="text-[10px] text-slate-400 mt-0.5">PNG, JPG, WEBP formats supported · Multiple files OK</p>
                      </div>
                    )}
                  </label>
                </div>

                <div className="flex justify-between items-center pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => updateType === UPDATE_TYPES.BOTH ? setUpdateStep('wallet_input') : setUpdateStep('select_type')}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                  >
                    ← Back
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
            )}

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
          {/* Top Metrics Cards (5 + Wallet Balance) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">

            {/* 1. Invested Value */}
            <div className="glass-panel p-5 rounded-2xl border border-slate-800">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">1. Invested Value</p>
              <p className="text-xl font-bold text-slate-100">
                {currencySymbol}{(summary.invested_value || 0).toLocaleString('en-US')}
              </p>
              {isUSAccount && summary.invested_value_inr && (
                <p className="text-xs font-semibold text-emerald-400 mt-1">
                  ₹{(summary.invested_value_inr).toLocaleString('en-IN')}
                </p>
              )}
              <span className="text-[10px] text-slate-500 block mt-0.5">Σ (Avg × Qty)</span>
            </div>

            {/* 2. Current Value */}
            <div className="glass-panel p-5 rounded-2xl border border-slate-800">
              <div className="flex justify-between items-center mb-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">2. Current Value</p>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center">
                  <Globe className="w-2.5 h-2.5 mr-1" /> Live
                </span>
              </div>
              <p className="text-xl font-bold text-white">
                {currencySymbol}{(summary.current_value || 0).toLocaleString('en-US')}
              </p>
              {isUSAccount && summary.current_value_inr && (
                <p className="text-xs font-semibold text-emerald-400 mt-1">
                  ₹{(summary.current_value_inr).toLocaleString('en-IN')}
                </p>
              )}
              <span className="text-[10px] text-slate-500 block mt-0.5">Σ (Live × Qty)</span>
            </div>

            {/* 3. Wallet Balance */}
            <div className={`glass-panel p-5 rounded-2xl border ${hasWalletBalance ? 'border-amber-500/30 bg-amber-500/5' : 'border-slate-800'}`}>
              <div className="flex justify-between items-center mb-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">3. Wallet Balance</p>
                <button
                  onClick={openUpdateModal}
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors"
                  title="Update wallet balance"
                >
                  Edit
                </button>
              </div>
              <p className={`text-xl font-bold ${hasWalletBalance ? 'text-amber-400' : 'text-slate-500'}`}>
                {hasWalletBalance ? `${currencySymbol}${walletBal.toLocaleString('en-US')}` : '—'}
              </p>
              {isUSAccount && hasWalletBalance && summary.wallet_balance_inr > 0 && (
                <p className="text-xs font-semibold text-amber-400/70 mt-1">
                  ₹{summary.wallet_balance_inr.toLocaleString('en-IN')}
                </p>
              )}
              <span className="text-[10px] text-slate-500 block mt-0.5">Uninvested Cash</span>
            </div>

            {/* 4. Holding Count */}
            <div className="glass-panel p-5 rounded-2xl border border-slate-800">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">4. Holdings</p>
              <p className="text-xl font-bold text-indigo-400">
                {summary.holding_count || 0}
              </p>
              <span className="text-[10px] text-slate-500 block mt-[18px]">Unique Stock Lines</span>
            </div>

            {/* 5. PNL */}
            <div className="glass-panel p-5 rounded-2xl border border-slate-800">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">5. P&L</p>
              <p className={`text-xl font-bold ${isPositivePnl ? 'text-emerald-400' : 'text-rose-400'}`}>
                {isPositivePnl ? '+' : ''}{currencySymbol}{(summary.pnl || 0).toLocaleString('en-US')}
              </p>
              {isUSAccount && summary.pnl_inr !== undefined && (
                <p className={`text-xs font-semibold mt-1 ${isPositivePnl ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {isPositivePnl ? '+' : ''}₹{(summary.pnl_inr).toLocaleString('en-IN')}
                </p>
              )}
              <span className="text-[10px] text-slate-500 block mt-0.5">Current − Invested</span>
            </div>

            {/* 6. PNL % */}
            <div className="glass-panel p-5 rounded-2xl border border-slate-800">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">6. P&L %</p>
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
              <span className="text-[10px] text-slate-500 mt-2 block">(P&L / Invested) × 100</span>
            </div>

          </div>

          {/* Holdings Table */}
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
                    <th className="py-3.5 px-4">Sector</th>
                    <th className="py-3.5 px-4 text-right">Qty</th>
                    <th className="py-3.5 px-4 text-right">Avg Price ({currencySymbol})</th>
                    <th className="py-3.5 px-4 text-right">Live Price ({currencySymbol})</th>
                    <th className="py-3.5 px-4 text-right">Invested Value</th>
                    <th className="py-3.5 px-4 text-right">Current Value</th>
                    <th className="py-3.5 px-4 text-right">P&L</th>
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
                        <td className="py-3.5 px-4 text-slate-300 whitespace-nowrap">
                          {item.sector || <span className="text-slate-600">—</span>}
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
