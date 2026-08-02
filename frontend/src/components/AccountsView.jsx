import React, { useState } from 'react';
import { Plus, Upload, Trash2, Edit2, UserCheck, Image, ShieldCheck, DollarSign, Coins, Layers, AlertTriangle, X, Check } from 'lucide-react';

export default function AccountsView({ accounts, onAddAccount, onUpdateAccount, onDeleteAccount, onImageOCRUpload }) {
  const [newAccName, setNewAccName] = useState('');
  const [newCurrencyType, setNewCurrencyType] = useState('IND');
  const [selectedAccId, setSelectedAccId] = useState('');

  const [selectedFiles, setSelectedFiles] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Confirmation Modal States
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    type: null, // 'DELETE' or 'EDIT'
    account: null,
    editName: '',
    editCurrency: 'IND'
  });

  const handleAddSubmit = (e) => {
    e.preventDefault();
    if (!newAccName.trim()) return;
    onAddAccount({
      name: newAccName.trim(),
      currency_type: newCurrencyType
    });
    setNewAccName('');
  };

  const openDeleteConfirmation = (acc) => {
    setConfirmModal({
      isOpen: true,
      type: 'DELETE',
      account: acc,
      editName: acc.name,
      editCurrency: acc.currency_type
    });
  };

  const openEditConfirmation = (acc) => {
    setConfirmModal({
      isOpen: true,
      type: 'EDIT',
      account: acc,
      editName: acc.name,
      editCurrency: acc.currency_type
    });
  };

  const handleConfirmAction = () => {
    if (!confirmModal.account) return;
    if (confirmModal.type === 'DELETE') {
      onDeleteAccount(confirmModal.account.id);
    } else if (confirmModal.type === 'EDIT') {
      onUpdateAccount(confirmModal.account.id, {
        name: confirmModal.editName.trim(),
        currency_type: confirmModal.editCurrency
      });
    }
    setConfirmModal({ isOpen: false, type: null, account: null, editName: '', editCurrency: 'IND' });
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
      await onImageOCRUpload(selectedFiles, selectedAccId || null);
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 relative">
      
      {/* Confirmation Modal */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel max-w-md w-full p-6 rounded-2xl border border-slate-700 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-slate-100 flex items-center">
                <AlertTriangle className={`w-5 h-5 mr-2 ${confirmModal.type === 'DELETE' ? 'text-rose-400' : 'text-amber-400'}`} />
                {confirmModal.type === 'DELETE' ? 'Confirm Account Deletion' : 'Confirm Account Modification'}
              </h3>
              <button
                onClick={() => setConfirmModal({ isOpen: false, type: null, account: null, editName: '', editCurrency: 'IND' })}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {confirmModal.type === 'DELETE' ? (
              <div className="space-y-3">
                <p className="text-xs text-slate-300">
                  Are you sure you want to permanently delete account <span className="font-bold text-white">"{confirmModal.account?.name}"</span>?
                </p>
                <p className="text-[11px] text-rose-400 bg-rose-500/10 p-3 rounded-xl border border-rose-500/20">
                  ⚠️ Warning: All holdings and historical data linked to this account will be erased immediately.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-300">Update account details below:</p>
                <div>
                  <label className="text-[11px] font-semibold text-slate-400 block mb-1">Account Name</label>
                  <input
                    type="text"
                    value={confirmModal.editName}
                    onChange={(e) => setConfirmModal({ ...confirmModal, editName: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-400 block mb-1">Account Currency Type</label>
                  <select
                    value={confirmModal.editCurrency}
                    onChange={(e) => setConfirmModal({ ...confirmModal, editCurrency: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 font-bold focus:outline-none focus:border-indigo-500"
                  >
                    <option value="IND">🇮🇳 IND (₹ INR - Indian Stocks)</option>
                    <option value="US">🇺🇸 US ($ USD - US Stocks)</option>
                  </select>
                </div>
              </div>
            )}

            <div className="flex justify-end space-x-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setConfirmModal({ isOpen: false, type: null, account: null, editName: '', editCurrency: 'IND' })}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAction}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-md ${
                  confirmModal.type === 'DELETE'
                    ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30'
                }`}
              >
                {confirmModal.type === 'DELETE' ? 'Yes, Delete Account' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Column 1 & 2: User Accounts List */}
      <div className="lg:col-span-2 space-y-6">
        <div className="glass-panel p-6 rounded-2xl border border-slate-800">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center">
                <UserCheck className="w-5 h-5 mr-2 text-indigo-400" /> User Accounts
              </h2>
              <p className="text-xs text-slate-400">Manage your connected portfolio accounts (US Stocks & Indian Stocks).</p>
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
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded flex items-center ${
                        isUS ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      }`}>
                        {isUS ? <DollarSign className="w-2.5 h-2.5 mr-0.5" /> : <Coins className="w-2.5 h-2.5 mr-0.5" />}
                        {isUS ? 'US ($ USD)' : 'IND (₹ INR)'}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500">
                      Last Synced: {acc.last_synced_at ? new Date(acc.last_synced_at).toLocaleString() : 'Never'}
                    </p>
                  </div>

                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => openEditConfirmation(acc)}
                      className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 transition-colors"
                      title="Edit Account"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => openDeleteConfirmation(acc)}
                      className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors"
                      title="Delete Account"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Minimal Add New Account Form */}
        <div className="glass-panel p-6 rounded-2xl border border-slate-800">
          <h3 className="text-sm font-bold text-slate-200 mb-4 flex items-center">
            <Plus className="w-4 h-4 mr-1.5 text-emerald-400" /> Create New Account
          </h3>
          <form onSubmit={handleAddSubmit} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-400 mb-1 block">Account Name</label>
              <input
                type="text"
                placeholder="e.g. Preeti US Portfolio"
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
            <div className="flex items-end">
              <button
                type="submit"
                className="w-full bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-semibold py-2 rounded-xl text-xs transition-all shadow-md shadow-indigo-600/30"
              >
                Create Account
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Column 3: Multi-Screenshot OCR Upload Drawer */}
      <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
        <div>
          <h3 className="text-base font-bold text-slate-100 flex items-center">
            <Upload className="w-5 h-5 mr-2 text-emerald-400" /> Multi-Screenshot Ingestion
          </h3>
          <p className="text-xs text-slate-400">Upload portfolio holdings screenshots for automatic parsing.</p>
        </div>

        <form onSubmit={handleUploadSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-400 mb-1 block">Target Account (Optional)</label>
            <select
              value={selectedAccId}
              onChange={(e) => setSelectedAccId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="">-- Assign to Account on Verification --</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({acc.currency_type === 'US' ? 'US $' : 'IND ₹'})
                </option>
              ))}
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
                  <p className="text-[10px] text-slate-400">PNG, JPG, WEBP formats supported</p>
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
