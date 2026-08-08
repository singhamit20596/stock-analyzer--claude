import React, { useState, useEffect, useCallback } from 'react';
import { Eye } from 'lucide-react';
import Navbar from './components/Navbar';
import ChatView from './components/ChatView';
import ConsolidatedPortfolio from './components/ConsolidatedPortfolio';
import AccountDetailView from './components/AccountDetailView';
import AccountsView from './components/AccountsView';
import RebalanceView from './components/RebalanceView';
import SyncLogsView from './components/SyncLogsView';
import ClassificationView from './components/ClassificationView';
import VerificationModal from './components/VerificationModal';
import StockDetailPage from './components/stock/StockDetailPage';
import useStockRoute from './components/stock/useStockRoute';
import LoginView from './components/LoginView';
import * as auth from './auth';

export default function App() {
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('activeTab') || 'portfolio');
  const [accounts, setAccounts] = useState([]);
  // null = signed out, undefined = still checking the stored token.
  const [user, setUser] = useState(undefined);
  const [viewAs, setViewAsState] = useState(() => auth.getViewAs());
  // The open stock lives in the URL so the browser Back button closes it.
  const { stock, open: openStock, close: closeStock } = useStockRoute();
  // A question handed over from a stock page, waiting for the chat to pick up.
  const [chatPrompt, setChatPrompt] = useState('');

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

  // The stock page hands its figures to the assistant rather than drawing a
  // conclusion itself, so the button closes the page and seeds the chat.
  const handleAskAssistant = (prompt) => {
    setChatPrompt(prompt);
    handleTabChange('chat');
    closeStock();
  };

  const loadUser = useCallback(async () => {
    if (!auth.getToken()) { setUser(null); return; }
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const me = await res.json();
        setUser(me);
        // A stored "view as" for a user who no longer exists would 404 every
        // request, so it is dropped rather than left to poison the session.
        if (viewAs && !(me.users || []).some((u) => u.id === viewAs)) {
          auth.clearViewAs();
          setViewAsState(null);
        }
      } else {
        auth.signOutLocally();
        setUser(null);
      }
    } catch {
      setUser(null);
    }
  }, [viewAs]);

  // A token rejected mid-session (expired, or revoked elsewhere) drops straight
  // back to the login screen instead of leaving a page of failed requests.
  useEffect(() => {
    auth.setUnauthorizedHandler(() => {
      auth.signOutLocally();
      setUser(null);
    });
  }, []);

  useEffect(() => { loadUser(); }, [loadUser]);

  const fetchAccounts = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/accounts');
      if (res.ok) setAccounts(await res.json());
    } catch (e) {
      console.error('Error fetching accounts:', e);
    }
  }, [user]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  const handleViewAs = (userId) => {
    auth.setViewAs(userId);
    setViewAsState(userId);
    closeStock();
    // Everything on screen belongs to the previous user, so it is all refetched
    // by remounting the tab rather than patched piecemeal.
    setAccounts([]);
    window.location.reload();
  };

  const handleLogout = async () => {
    await auth.logout();
    setUser(null);
    setViewAsState(null);
    setAccounts([]);
  };

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

  if (user === undefined) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (user === null) {
    return <LoginView onSignedIn={() => { setViewAsState(null); loadUser(); }} />;
  }

  const viewingUser = (user.users || []).find((u) => u.id === viewAs);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white pb-16">
      <Navbar
        activeTab={activeTab}
        setActiveTab={handleTabChange}
        user={user}
        viewAs={viewAs}
        onViewAs={handleViewAs}
        onLogout={handleLogout}
      />

      {viewingUser && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-2 mb-4">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-4 py-2.5
                          flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[11px] text-amber-200/90 flex items-center gap-2">
              <Eye className="w-3.5 h-3.5 shrink-0" />
              Viewing <strong className="font-bold">{viewingUser.username}</strong>'s
              portfolio. This is read-only — nothing you do here can change their data.
            </p>
            <button
              onClick={() => handleViewAs(null)}
              className="text-[11px] font-bold text-amber-300 hover:text-amber-200 underline underline-offset-2"
            >
              Back to my own
            </button>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        {activeTab === 'chat' && (
          <ChatView
            initialPrompt={chatPrompt}
            onPromptConsumed={() => setChatPrompt('')}
          />
        )}
        {activeTab === 'portfolio' && (
          <ConsolidatedPortfolio accounts={accounts} onSelectStock={openStock} />
        )}
        {activeTab === 'account-detail' && (
          <AccountDetailView
            accounts={accounts}
            onImageOCRUpload={handleImageOCRUpload}
            onSelectStock={openStock}
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
        {activeTab === 'rebalance' && <RebalanceView onSelectStock={openStock} />}
        {activeTab === 'classification' && <ClassificationView onSelectStock={openStock} />}
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

      {stock && (
        <StockDetailPage
          key={`${stock.symbol}:${stock.country}`}
          symbol={stock.symbol}
          country={stock.country}
          portfolioId={stock.portfolioId}
          onClose={closeStock}
          onAskAssistant={handleAskAssistant}
        />
      )}
    </div>
  );
}
