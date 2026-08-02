import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import ConsolidatedPortfolio from './components/ConsolidatedPortfolio';
import AccountDetailView from './components/AccountDetailView';
import AccountsView from './components/AccountsView';
import RebalanceView from './components/RebalanceView';
import SyncLogsModal from './components/SyncLogsModal';
import VerificationModal from './components/VerificationModal';

export default function App() {
  const [activeTab, setActiveTab] = useState('portfolio');
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState([]);
  const [portfolioData, setPortfolioData] = useState({ summary: {}, items: [] });
  const [rebalanceData, setRebalanceData] = useState({ summary: {}, matrix: [] });
  const [targetAllocations, setTargetAllocations] = useState([]);
  const [syncLogs, setSyncLogs] = useState([]);
  
  const [previewData, setPreviewData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

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

  const fetchPortfolio = async () => {
    setLoading(true);
    try {
      const query = selectedAccountIds.length > 0 ? `?account_ids=${selectedAccountIds.join(',')}` : '';
      const res = await fetch(`/api/portfolio/consolidated${query}`);
      if (res.ok) {
        const data = await res.json();
        setPortfolioData(data);
      }
    } catch (e) {
      console.error("Error fetching portfolio:", e);
    } finally {
      setLoading(false);
    }
  };

  const fetchRebalance = async () => {
    try {
      const query = selectedAccountIds.length > 0 ? `?account_ids=${selectedAccountIds.join(',')}` : '';
      const res = await fetch(`/api/rebalance${query}`);
      if (res.ok) {
        const data = await res.json();
        setRebalanceData(data);
      }
    } catch (e) {
      console.error("Error fetching rebalance data:", e);
    }
  };

  const fetchTargets = async () => {
    try {
      const res = await fetch('/api/target-allocations');
      if (res.ok) {
        const data = await res.json();
        setTargetAllocations(data);
      }
    } catch (e) {
      console.error("Error fetching targets:", e);
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

  useEffect(() => {
    fetchAccounts();
    fetchTargets();
    fetchSyncLogs();
  }, []);

  useEffect(() => {
    fetchPortfolio();
    fetchRebalance();
  }, [selectedAccountIds]);

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await fetch('/api/sync-now', { method: 'POST' });
      await fetchPortfolio();
      await fetchRebalance();
      await fetchSyncLogs();
    } catch (e) {
      console.error("Sync error:", e);
    } finally {
      setSyncing(false);
    }
  };

  const handleAddAccount = async (newAcc) => {
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAcc)
      });
      if (res.ok) {
        await fetchAccounts();
      }
    } catch (e) {
      console.error("Error adding account:", e);
    }
  };

  const handleDeleteAccount = async (accId) => {
    try {
      const res = await fetch(`/api/accounts/${accId}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchAccounts();
        await fetchPortfolio();
        await fetchRebalance();
      }
    } catch (e) {
      console.error("Error deleting account:", e);
    }
  };

  const handleImageOCRUpload = async (files, accountId, brokerHint) => {
    try {
      const formData = new FormData();
      const fileArray = Array.isArray(files) ? files : [files];
      
      fileArray.forEach((file) => {
        formData.append('files', file);
      });

      if (accountId) formData.append('account_id', accountId);
      if (brokerHint) formData.append('broker_hint', brokerHint);

      const res = await fetch('/api/upload-ocr-images', {
        method: 'POST',
        body: formData
      });

      if (res.ok) {
        const data = await res.json();
        const acc = accounts.find(a => a.id === accountId);
        setPreviewData({
          account_id: accountId,
          account_name: acc ? acc.name : 'Uploaded Screenshots',
          broker: brokerHint || (acc ? acc.broker : 'GROWW'),
          holdings: data.holdings,
          warnings: data.warnings,
          filenames: data.filenames
        });
      }
    } catch (e) {
      console.error("OCR Upload error:", e);
    }
  };

  const handleConfirmVerification = async (accountId, holdings, strategy = 'OVERWRITE') => {
    try {
      const res = await fetch(`/api/verify-save-holdings?strategy=${strategy}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: accountId, holdings })
      });
      if (res.ok) {
        setPreviewData(null);
        await fetchPortfolio();
        await fetchRebalance();
        await fetchAccounts();
        await fetchSyncLogs();
      }
    } catch (e) {
      console.error("Confirm save error:", e);
    }
  };

  const handleSaveTargets = async (targets) => {
    try {
      const res = await fetch('/api/target-allocations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(targets)
      });
      if (res.ok) {
        await fetchTargets();
        await fetchRebalance();
      }
    } catch (e) {
      console.error("Save targets error:", e);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      
      {/* Navigation Header */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onSyncNow={handleSyncNow}
        syncing={syncing}
      />

      {/* Main App Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        {activeTab === 'portfolio' && (
          <ConsolidatedPortfolio
            portfolioData={portfolioData}
            accounts={accounts}
            selectedAccountIds={selectedAccountIds}
            setSelectedAccountIds={setSelectedAccountIds}
            loading={loading}
          />
        )}

        {activeTab === 'account-detail' && (
          <AccountDetailView accounts={accounts} />
        )}

        {activeTab === 'rebalance' && (
          <RebalanceView
            rebalanceData={rebalanceData}
            targetAllocations={targetAllocations}
            onSaveTargets={handleSaveTargets}
            loading={loading}
          />
        )}

        {activeTab === 'accounts' && (
          <AccountsView
            accounts={accounts}
            onAddAccount={handleAddAccount}
            onDeleteAccount={handleDeleteAccount}
            onImageOCRUpload={handleImageOCRUpload}
          />
        )}

        {activeTab === 'logs' && (
          <SyncLogsModal logs={syncLogs} />
        )}
      </main>

      {/* Verification Ingestion Review Modal */}
      {previewData && (
        <VerificationModal
          previewData={previewData}
          onClose={() => setPreviewData(null)}
          onConfirm={handleConfirmVerification}
        />
      )}

      {/* Footer */}
      <footer className="border-t border-slate-900 py-4 text-center text-xs text-slate-500">
        Stocks Analyzer • Multi-Broker Portfolio Aggregator & Rebalancer Engine
      </footer>

    </div>
  );
}
