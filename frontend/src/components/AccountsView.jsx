import React, { useState } from 'react';
import { Plus, Upload, Trash2, UserCheck, Image, CheckCircle, FileText, Layers, ShieldCheck, DollarSign, Coins } from 'lucide-react';

export default function AccountsView({ accounts, onAddAccount, onDeleteAccount, onImageOCRUpload }) {
  const [newAccName, setNewAccName] = useState('');
  const [newBroker, setNewBroker] = useState('INDMONEY');
  const [newCurrencyType, setNewCurrencyType] = useState('IND');
  const [selectedAccId, setSelectedAccId] = useState('');
  const [brokerHint, setBrokerHint] = useState('INDMONEY');

  const [selectedFiles, setSelectedFiles] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleAddSubmit = (e) => {
    e.preventDefault();
    if (!newAccName.trim()) return;
    onAddAccount({
      name: newAccName.trim(),
      broker: newBroker,
      currency_type: newCurrencyType,
      sync_method: 'IMAGE_OCR'
    });
    setNewAccName('');
  };

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
      await onImageOCRUpload(selectedFiles, selectedAccId || null, brokerHint);
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      
      {/* Column 1 & 2: Added Broker Accounts List */}
      <div className="lg:col-span-2 space-y-6">
        <div className="glass-panel p-6 rounded-2xl border border-slate-800">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center">
                <UserCheck className="w-5 h-5 mr-2 text-indigo-400" /> User Broker Accounts
              </h2>
              <p className="text-xs text-slate-400">Manage your connected portfolio accounts across US Stocks ($ USD) & Indian Stocks (₹ INR).</p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              {accounts.length} Accounts Configured
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {accounts.map((acc) => {
              const isUS = acc.currency_type === 'US';
              return (
                <div key={acc.id} className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition-all flex justify-between items-start">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-bold text-slate-200">{acc.name}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-indigo-300 border border-slate-700">
                        {acc.broker}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded flex items-center ${
                        isUS ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      }`}>
                        {isUS ? <DollarSign className="w-2.5 h-2.5 mr-0.5" /> : <Coins className="w-2.5 h-2.5 mr-0.5" />}
                        {isUS ? 'US ($ USD)' : 'IND (₹ INR)'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 flex items-center">
                      <ShieldCheck className="w-3 h-3 mr-1 text-emerald-400" />
                      Plaintext Credential Storage • {acc.sync_method}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      Last Synced: {acc.last_synced_at ? new Date(acc.last_synced_at).toLocaleString() : 'Never'}
                    </p>
                  </div>
                  <button
                    onClick={() => onDeleteAccount(acc.id)}
                    className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors"
                    title="Delete Account"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Add New Account Form */}
        <div className="glass-panel p-6 rounded-2xl border border-slate-800">
          <h3 className="text-sm font-bold text-slate-200 mb-4 flex items-center">
            <Plus className="w-4 h-4 mr-1.5 text-emerald-400" /> Add New User Broker Account
          </h3>
          <form onSubmit={handleAddSubmit} className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-400 mb-1 block">Account Name</label>
              <input
                type="text"
                placeholder="e.g. Preeti - US Stocks"
                value={newAccName}
                onChange={(e) => setNewAccName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                required
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-400 mb-1 block">Account Type / Currency</label>
              <select
                value={newCurrencyType}
                onChange={(e) => setNewCurrencyType(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-bold"
              >
                <option value="IND">🇮🇳 IND (₹ INR - Indian Stocks)</option>
                <option value="US">🇺🇸 US ($ USD - US Stocks)</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-400 mb-1 block">Broker Platform</label>
              <select
                value={newBroker}
                onChange={(e) => setNewBroker(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-medium"
              >
                <option value="INDMONEY">INDmoney</option>
                <option value="GROWW">Groww</option>
                <option value="ZERODHA">Zerodha</option>
                <option value="UPSTOX">Upstox</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                className="w-full bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-semibold py-2 rounded-xl text-xs transition-all shadow-md shadow-indigo-600/30"
              >
                Add Account
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Column 3: Multi-Screenshot OCR Upload Drawer */}
      <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
        <div>
          <h3 className="text-base font-bold text-slate-100 flex items-center">
            <Upload className="w-5 h-5 mr-2 text-emerald-400" /> Multi-Screenshot OCR Upload
          </h3>
          <p className="text-xs text-slate-400">Upload holdings screenshots for INDmoney (US Stocks) or Groww.</p>
        </div>

        <form onSubmit={handleUploadSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-400 mb-1 block">Target Account (Optional)</label>
            <select
              value={selectedAccId}
              onChange={(e) => setSelectedAccId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="">-- Create/Assign on Verification --</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({acc.broker} - {acc.currency_type === 'US' ? 'US $' : 'IND ₹'})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-400 mb-1 block">Broker Format</label>
            <select
              value={brokerHint}
              onChange={(e) => setBrokerHint(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-medium"
            >
              <option value="INDMONEY">INDmoney (US Stocks & Indian Stocks App)</option>
              <option value="GROWW">Groww (Web / Desktop Table & Mobile)</option>
              <option value="ZERODHA">Zerodha (Kite Mobile)</option>
              <option value="UPSTOX">Upstox</option>
            </select>
          </div>

          {/* Drag & Drop Multi-File Zone */}
          <div
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${
              dragActive ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-800 hover:border-slate-700 bg-slate-900/50'
            }`}
          >
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileChange}
              className="hidden"
              id="multi-screenshot-input"
            />
            <label htmlFor="multi-screenshot-input" className="cursor-pointer space-y-2 block">
              <Image className="w-8 h-8 text-indigo-400 mx-auto" />
              {selectedFiles.length > 0 ? (
                <div>
                  <p className="text-xs font-bold text-emerald-400">{selectedFiles.length} Screenshot(s) Selected</p>
                  <p className="text-[10px] text-slate-400 truncate max-w-[200px] mx-auto">
                    {selectedFiles.map(f => f.name).join(', ')}
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-xs font-semibold text-slate-200 font-bold">Click or Drag & Drop Screenshots</p>
                  <p className="text-[10px] text-slate-400">PNG, JPG, WEBP • INDmoney US Stocks & Groww</p>
                </div>
              )}
            </label>
          </div>

          <button
            type="submit"
            disabled={selectedFiles.length === 0 || uploading}
            className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-bold py-2.5 rounded-xl text-xs transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 flex items-center justify-center space-x-2"
          >
            {uploading ? (
              <>
                <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
                <span>Parsing {selectedFiles.length} Screenshot(s)...</span>
              </>
            ) : (
              <>
                <Layers className="w-4 h-4" />
                <span>Process & Parse {selectedFiles.length > 0 ? selectedFiles.length : ''} Screenshots</span>
              </>
            )}
          </button>
        </form>
      </div>

    </div>
  );
}
