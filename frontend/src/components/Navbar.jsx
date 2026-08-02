import React from 'react';
import { LayoutDashboard, PieChart, Wallet, RefreshCw, History, UserCheck, Layers } from 'lucide-react';

export default function Navbar({ activeTab, setActiveTab, onSyncNow, syncing }) {
  const navItems = [
    { id: 'portfolio', label: 'Consolidated Portfolio', icon: LayoutDashboard },
    { id: 'account-detail', label: 'Accounts', icon: Wallet },
    { id: 'rebalance', label: 'Target Rebalancing', icon: PieChart },
    { id: 'accounts', label: 'Account Ingestion', icon: UserCheck },
    { id: 'logs', label: 'Sync Audit Logs', icon: History },
  ];

  return (
    <header className="sticky top-0 z-40 glass-panel border-b border-slate-800/80 mb-6">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        
        {/* Brand Logo */}
        <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setActiveTab('portfolio')}>
          <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-emerald-400 p-0.5 shadow-lg shadow-indigo-500/20">
            <div className="h-full w-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <PieChart className="h-5 w-5 text-emerald-400" />
            </div>
          </div>
          <div>
            <h1 className="text-lg font-bold bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              Stocks Analyzer
            </h1>
            <p className="text-xs text-slate-400 font-medium">Multi-Broker Aggregator & Rebalancer</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="hidden lg:flex items-center space-x-1 bg-slate-900/60 p-1.5 rounded-xl border border-slate-800">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-md shadow-indigo-600/30 font-semibold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Sync Button */}
        <button
          onClick={onSyncNow}
          disabled={syncing}
          className="flex items-center space-x-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-semibold px-4 py-2 rounded-xl text-sm transition-all duration-200 shadow-lg shadow-emerald-500/20 active:scale-95 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          <span>{syncing ? 'Syncing...' : 'Sync Now'}</span>
        </button>
      </div>
    </header>
  );
}
