import React, { useState, useEffect, useCallback } from 'react';
import Navbar from './components/Navbar';
import ConsolidatedPortfolio from './components/ConsolidatedPortfolio';
import AccountDetailView from './components/AccountDetailView';
import AccountsView from './components/AccountsView';
import RebalanceView from './components/RebalanceView';
import SyncLogsView from './components/SyncLogsView';
import VerificationModal from './components/VerificationModal';

export default function App() {
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('activeTab') || 'portfolio');
  const [accounts, setAccounts] = useState([]);
  const [targetAllocations, setTargetAllocations] = useState([]);

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

  const fetchTargetAllocations = useCallback(async () => {
    try {
      const res = await fetch('/api/target-allocations');
      if (res.ok) setTargetAllocations(await res.json());
    } catch (e) {
      console.error('Error fetching target allocations:', e);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
    fetchTargetAllocations();
  }, [fetchAccounts, fetchTargetAllocations]);

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

  const handleSaveTargetAllocation = async (targetItem) => {
    try {
      const res = await fetch('/api/target-allocations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(targetItem),
      });
      if (res.ok) await fetchTargetAllocations();
    } catch (e) {
      console.error('Error saving target allocation:', e);
    }
  };

  const handleDeleteTargetAllocation = async (allocId) => {
    try {
      const res = await fetch(`/api/target-allocations/${allocId}`, { method: 'DELETE' });
      if (res.ok) await fetchTargetAllocations();
    } catch (e) {
      console.error('Error deleting target allocation:', e);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white pb-16">
      <Navbar activeTab={activeTab} setActiveTab={handleTabChange} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        {activeTab === 'portfolio' && (
          <ConsolidatedPortfolio accounts={accounts} />
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
        {activeTab === 'rebalance' && (
          <RebalanceView
            targetAllocations={targetAllocations}
            onSaveTargetAllocation={handleSaveTargetAllocation}
            onDeleteTargetAllocation={handleDeleteTargetAllocation}
          />
        )}
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
    </div>
  );
}
