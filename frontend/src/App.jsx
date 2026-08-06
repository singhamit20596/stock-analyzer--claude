import React, { useState, useEffect, useCallback } from 'react';
import Navbar from './components/Navbar';
import ChatView from './components/ChatView';
import ConsolidatedPortfolio from './components/ConsolidatedPortfolio';
import AccountDetailView from './components/AccountDetailView';
import AccountsView from './components/AccountsView';
import RebalanceView from './components/RebalanceView';
import SyncLogsView from './components/SyncLogsView';
import ClassificationView from './components/ClassificationView';
import VerificationModal from './components/VerificationModal';
import StockDetailPage from './components/StockDetailPage';

export default function App() {
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('activeTab') || 'portfolio');
  const [accounts, setAccounts] = useState([]);
  const [stockDrilldown, setStockDrilldown] = useState(null); // { symbol, country }

  // Holdings parsed out of a screenshot, awaiting the user's review.
  const [verificationModal, setVerificationModal] = useState({
    isOpen: false,
    parsedHoldings: [],
    targetAccountId: null,
  });

  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    localStorage.setItem('activeTab', tabId);
  };

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/accounts');
      if (res.ok) setAccounts(await res.json());
    } catch (e) {
      console.error('Error fetching accounts:', e);
    }
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  const handleAddAccount = async (newAccount) => {
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAccount),
      });
      if (res.ok) await fetchAccounts();
    } catch (e) {
      console.error('Error adding account:', e);
    }
  };

  const handleUpdateAccount = async (accountId, updateData) => {
    try {
      const res = await fetch(`/api/accounts/${accountId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      });
      if (res.ok) await fetchAccounts();
    } catch (e) {
      console.error('Error updating account:', e);
    }
  };

  const handleDeleteAccount = async (accountId) => {
    try {
      const res = await fetch(`/api/accounts/${accountId}`, { method: 'DELETE' });
      if (res.ok) await fetchAccounts();
    } catch (e) {
      console.error('Error deleting account:', e);
    }
  };

  const handleImageOCRUpload = async (files, accountId) => {
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append('files', file));

      let url = '/api/upload-ocr-images';
      if (accountId) url += `?account_id=${encodeURIComponent(accountId)}`;

      const res = await fetch(url, { method: 'POST', body: formData });
      if (!res.ok) {
        alert('OCR parsing failed. Please check the server logs.');
        return;
      }

      const result = await res.json();
      if (!result.holdings?.length) {
        alert(result.warnings?.[0] || 'No holdings were detected in that screenshot.');
        return;
      }

      setVerificationModal({
        isOpen: true,
        parsedHoldings: result.holdings,
        targetAccountId: accountId,
      });
    } catch (e) {
      console.error('Error uploading OCR image:', e);
    }
  };

  const handleSaveVerifiedHoldings = async (verifiedHoldings, targetAccId, strategy) => {
    try {
      const res = await fetch(`/api/verify-save-holdings?strategy=${strategy}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: targetAccId, holdings: verifiedHoldings }),
      });
      if (res.ok) {
        setVerificationModal({ isOpen: false, parsedHoldings: [], targetAccountId: null });
        await fetchAccounts();
      }
    } catch (e) {
      console.error('Error saving verified holdings:', e);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white pb-16">
      <Navbar activeTab={activeTab} setActiveTab={handleTabChange} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        {activeTab === 'chat' && <ChatView />}
        {activeTab === 'portfolio' && (
          <ConsolidatedPortfolio
            accounts={accounts}
            onSelectStock={(symbol, country) => setStockDrilldown({ symbol, country })}
          />
        )}
        {activeTab === 'account-detail' && (
          <AccountDetailView
            accounts={accounts}
            onImageOCRUpload={handleImageOCRUpload}
          />
        )}
        {activeTab === 'accounts' && (
          <AccountsView
            accounts={accounts}
            onAddAccount={handleAddAccount}
            onUpdateAccount={handleUpdateAccount}
            onDeleteAccount={handleDeleteAccount}
          />
        )}
        {activeTab === 'rebalance' && <RebalanceView />}
        {activeTab === 'classification' && <ClassificationView />}
        {activeTab === 'logs' && <SyncLogsView />}
      </main>

      {verificationModal.isOpen && (
        <VerificationModal
          accounts={accounts}
          initialHoldings={verificationModal.parsedHoldings}
          targetAccountId={verificationModal.targetAccountId}
          onClose={() => setVerificationModal({ isOpen: false, parsedHoldings: [], targetAccountId: null })}
          onSave={handleSaveVerifiedHoldings}
        />
      )}

      {stockDrilldown && (
        <StockDetailPage
          symbol={stockDrilldown.symbol}
          country={stockDrilldown.country}
          onClose={() => setStockDrilldown(null)}
        />
      )}
    </div>
  );
}
