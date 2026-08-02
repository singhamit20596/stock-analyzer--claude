import React, { useState } from 'react';
import { Plus, Trash2, Edit2, UserCheck, DollarSign, Coins, AlertTriangle, X, CheckCircle2 } from 'lucide-react';

export default function AccountsView({ accounts, onAddAccount, onUpdateAccount, onDeleteAccount }) {
  const [newAccName, setNewAccName] = useState('');
  const [newCurrencyType, setNewCurrencyType] = useState('IND');
  const [toastMessage, setToastMessage] = useState(null);

  // Confirmation Modal States
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    type: null, // 'DELETE' or 'EDIT'
    account: null,
    editName: '',
    editCurrency: 'IND'
  });

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    if (!newAccName.trim()) return;
    
    const addedName = newAccName.trim();
    await onAddAccount({
      name: addedName,
      currency_type: newCurrencyType
    });
    setNewAccName('');
    setToastMessage(`Account "${addedName}" created successfully!`);
    setTimeout(() => setToastMessage(null), 4000);
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

  const handleConfirmAction = async () => {
    if (!confirmModal.account) return;
    if (confirmModal.type === 'DELETE') {
      await onDeleteAccount(confirmModal.account.id);
      setToastMessage(`Account "${confirmModal.account.name}" deleted.`);
    } else if (confirmModal.type === 'EDIT') {
      await onUpdateAccount(confirmModal.account.id, {
        name: confirmModal.editName.trim(),
        currency_type: confirmModal.editCurrency
      });
      setToastMessage(`Account "${confirmModal.editName.trim()}" updated successfully.`);
    }
    setConfirmModal({ isOpen: false, type: null, account: null, editName: '', editCurrency: 'IND' });
    setTimeout(() => setToastMessage(null), 4000);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 relative">
      
      {/* Toast Notification Banner */}
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

      {/* Account Management & Creation */}
      <div className="space-y-6">
        <div className="glass-panel p-6 rounded-2xl border border-slate-800">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center">
                <UserCheck className="w-5 h-5 mr-2 text-indigo-400" /> Account Management
              </h2>
              <p className="text-xs text-slate-400">View, edit, or delete connected portfolio accounts.</p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              {accounts.length} Account(s) Active
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
                placeholder="e.g. Sheela Groww Portfolio"
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

    </div>
  );
}
