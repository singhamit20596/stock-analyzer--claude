import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import ConsolidatedPortfolio from './components/ConsolidatedPortfolio';
import AccountDetailView from './components/AccountDetailView';
import AccountsView from './components/AccountsView';
import RebalanceView from './components/RebalanceView';
import SyncLogsModal from './components/SyncLogsModal';
import VerificationModal from './components/VerificationModal';

export default function App() {
  // Tab persistence in localStorage
  const [activeTab, setActiveTab] = useState(() => {
    return localStorage.getItem('activeTab') || 'portfolio';
  });

  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    localStorage.setItem('activeTab', tabId);
  };

  const [accounts, setAccounts] = useState([]);
  const [targetAllocations, setTargetAllocations] = useState([]);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [syncLogs, setSyncLogs] = useState([]);

  // Consolidated portfolio state
  const [consolidatedData, setConsolidatedData] = useState({ summary: {}, items: [] });
  const [selectedAccountIds, setSelectedAccountIds] = useState([]);
  const [consolidatedLoading, setConsolidatedLoading] = useState(false);

  // OCR Verification Modal state
  const [verificationModal, setVerificationModal] = useState({
    isOpen: false,
    parsedHoldings: [],
    targetAccountId: null
  });

  const fetchAccounts = async () => {
    try {
      const res = await fetch('/api/accounts');
      if (res.ok) {
        const data = await res.json();
        setAccounts(data);
      }
    } catch (e) {
      console.error("Error fetching accounts:", e);
    }
  };

  const fetchTargetAllocations = async () => {
    try {
      const res = await fetch('/api/target-allocations');
      if (res.ok) {
        const data = await res.json();
        setTargetAllocations(data);
      }
    } catch (e) {
      console.error("Error fetching target allocations:", e);
    }
  };

  const fetchSyncLogs = async () => {
    try {
      const res = await fetch('/api/sync-logs');
      if (res.ok) {
        const data = await res.json();
        setSyncLogs(data);
      }
    } catch (e) {
      console.error("Error fetching sync logs:", e);
    }
  };

  const fetchConsolidatedData = async () => {
    setConsolidatedLoading(true);
    try {
      let url = '/api/portfolio/consolidated';
      if (selectedAccountIds.length > 0) {
        url += `?account_ids=${selectedAccountIds.join(',')}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setConsolidatedData(data);
      }
    } catch (e) {
      console.error("Error fetching consolidated portfolio:", e);
    } finally {
      setConsolidatedLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
    fetchTargetAllocations();
  }, []);

  useEffect(() => {
    if (activeTab === 'portfolio') {
      fetchConsolidatedData();
    }
  }, [activeTab, selectedAccountIds]);

  const handleAddAccount = async (newAccount) => {
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAccount)
      });
      if (res.ok) {
        await fetchAccounts();
        if (activeTab === 'portfolio') fetchConsolidatedData();
      }
    } catch (e) {
      console.error("Error adding account:", e);
    }
  };

  const handleUpdateAccount = async (accountId, updateData) => {
    try {
      const res = await fetch(`/api/accounts/${accountId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      });
      if (res.ok) {
        await fetchAccounts();
        if (activeTab === 'portfolio') fetchConsolidatedData();
      }
    } catch (e) {
      console.error("Error updating account:", e);
    }
  };

  const handleDeleteAccount = async (accountId) => {
    try {
      const res = await fetch(`/api/accounts/${accountId}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchAccounts();
        if (activeTab === 'portfolio') fetchConsolidatedData();
      }
    } catch (e) {
      console.error("Error deleting account:", e);
    }
  };

  const handleImageOCRUpload = async (files, accountId) => {
    try {
      const formData = new FormData();
      files.forEach((file) => {
        formData.append('files', file);
      });
      
      let queryUrl = '/api/upload-ocr-images';
      if (accountId) {
        queryUrl += `?account_id=${encodeURIComponent(accountId)}`;
      }

      const res = await fetch(queryUrl, {
        method: 'POST',
        body: formData
      });

      if (res.ok) {
        const result = await res.json();
        setVerificationModal({
          isOpen: true,
          parsedHoldings: result.holdings || [],
          targetAccountId: accountId
        });
      } else {
        alert("OCR parsing failed. Please check server logs.");
      }
    } catch (e) {
      console.error("Error uploading OCR image:", e);
    }
  };

  const handleSaveVerifiedHoldings = async (verifiedHoldings, targetAccId, strategy) => {
    try {
      const res = await fetch(`/api/verify-save-holdings?strategy=${strategy}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: targetAccId,
          holdings: verifiedHoldings
        })
      });

      if (res.ok) {
        setVerificationModal({ isOpen: false, parsedHoldings: [], targetAccountId: null });
        await fetchAccounts();
        if (activeTab === 'portfolio') fetchConsolidatedData();
      }
    } catch (e) {
      console.error("Error saving verified holdings:", e);
    }
  };

  const handleSaveTargetAllocation = async (targetItem) => {
    try {
      const res = await fetch('/api/target-allocations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(targetItem)
      });
      if (res.ok) {
        await fetchTargetAllocations();
      }
    } catch (e) {
      console.error("Error saving target allocation:", e);
    }
  };

  const handleDeleteTargetAllocation = async (allocId) => {
    try {
      const res = await fetch(`/api/target-allocations/${allocId}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchTargetAllocations();
      }
    } catch (e) {
      console.error("Error deleting target allocation:", e);
    }
  };

  const openSyncLogs = () => {
    fetchSyncLogs();
    setShowLogsModal(true);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white pb-16">
      <Navbar
        activeTab={activeTab}
        setActiveTab={handleTabChange}
        onOpenLogs={openSyncLogs}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        {activeTab === 'portfolio' && (
          <ConsolidatedPortfolio
            accounts={accounts}
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
        {activeTab === 'rebalance' && (
          <RebalanceView
            targetAllocations={targetAllocations}
            onSaveTargetAllocation={handleSaveTargetAllocation}
            onDeleteTargetAllocation={handleDeleteTargetAllocation}
          />
        )}
      </main>

      {/* OCR Holdings Verification Modal */}
      {verificationModal.isOpen && (
        <VerificationModal
          accounts={accounts}
          initialHoldings={verificationModal.parsedHoldings}
          targetAccountId={verificationModal.targetAccountId}
          onClose={() => setVerificationModal({ isOpen: false, parsedHoldings: [], targetAccountId: null })}
          onSave={handleSaveVerifiedHoldings}
        />
      )}

      {/* Sync Logs Drawer */}
      {showLogsModal && (
        <SyncLogsModal
          logs={syncLogs}
          onClose={() => setShowLogsModal(false)}
        />
      )}
    </div>
  );
}
