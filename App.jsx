import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Trash2, PieChart as PieChartIcon, LayoutDashboard,
  TrendingUp, Wallet, BrainCircuit, AlertCircle, Zap,
  LogOut, User as UserIcon, Lock, Shield, Brain, Sparkles,
  ShieldAlert, Radio, WifiOff, TrendingDown, BarChart2
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { ConfidenceBadge, ConfidenceTooltip } from './components/ConfidenceBadge.jsx';
import { MLAdminPanel } from './components/MLAdminPanel.jsx';
import { FraudDashboard } from './components/FraudDashboard.jsx';
import { ForecastDashboard } from './components/ForecastDashboard.jsx';
import { AlertToast, ConnectionBadge } from './components/StreamDashboard.jsx';
import { useStream } from './hooks/useStream.js';

const CATEGORIES = ["Food & Dining", "Transport", "Utilities", "Shopping", "Entertainment", "Others"];
const COLORS = ['#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#f43f5e', '#f59e0b'];
const API_BASE = 'http://localhost:5000/api';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'fraud', label: 'Fraud Detection', icon: ShieldAlert },
  { id: 'forecast', label: 'AI Forecast', icon: TrendingUp },
  { id: 'ml', label: 'ML Panel', icon: Brain },
];

function App() {
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user')) || null);
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [authMode, setAuthMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [activeTab, setActiveTab] = useState('dashboard');

  const [expenses, setExpenses] = useState([]);
  const [analytics, setAnalytics] = useState({
    totalSpent: 0, budgetLimit: 10000, isOverBudget: false,
    categoryBreakdown: [], sourceBreakdown: {}, correctionRate: 0
  });
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [rawMessage, setRawMessage] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isAutoAdding, setIsAutoAdding] = useState(false);
  const [isEditingBudget, setIsEditingBudget] = useState(false);
  const [newBudgetLimit, setNewBudgetLimit] = useState('');
  const [reviewingExpense, setReviewingExpense] = useState(null);
  const [clipboardContent, setClipboardContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [apiKey] = useState(localStorage.getItem('gemini_api_key') || '');
  const [hoveredMeta, setHoveredMeta] = useState(null);
  const [geminiStatus, setGeminiStatus] = useState('unknown');

  const { snapshot: streamSnapshot, alerts, isConnected, latency, perf, dismissAlert } = useStream(token);

  const authHeaders = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => {
    if (token) { fetchExpenses(); fetchAnalytics(); }
  }, [token]);

  // Sync analytics from WebSocket stream snapshot
  useEffect(() => {
    if (streamSnapshot) {
      setAnalytics(prev => ({
        ...prev,
        totalSpent: streamSnapshot.totalSpent ?? prev.totalSpent,
        budgetLimit: streamSnapshot.budgetLimit ?? prev.budgetLimit,
        isOverBudget: streamSnapshot.isOverBudget ?? prev.isOverBudget,
        overAmount: streamSnapshot.overAmount ?? prev.overAmount,
        categoryBreakdown: streamSnapshot.categoryBreakdown?.length ? streamSnapshot.categoryBreakdown : prev.categoryBreakdown,
      }));
    }
  }, [streamSnapshot]);

  const fetchExpenses = async () => {
    try {
      const res = await fetch(`${API_BASE}/expenses`, { headers: authHeaders });
      if (res.status === 401 || res.status === 403) return handleLogout();
      setExpenses(await res.json());
    } catch (err) { console.error('Fetch failed', err); }
  };

  const fetchAnalytics = async () => {
    try {
      const res = await fetch(`${API_BASE}/expenses/analytics`, { headers: authHeaders });
      if (res.status === 401 || res.status === 403) return handleLogout();
      setAnalytics(await res.json());
    } catch (err) { console.error('Analytics failed', err); }
  };

  const handleAuth = async (e) => {
    e.preventDefault(); setAuthError('');
    try {
      const res = await fetch(`${API_BASE}/auth/${authMode}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.error) return setAuthError(data.error);
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setToken(data.token); setUser(data.user);
    } catch { setAuthError('Authentication failed'); }
  };

  const handleLogout = () => {
    localStorage.removeItem('token'); localStorage.removeItem('user');
    setToken(''); setUser(null); setExpenses([]);
  };

  // Clipboard watcher
  useEffect(() => {
    if (!token) return;
    const checkClipboard = async () => {
      if (!isListening || document.hidden) return;
      try {
        const text = await navigator.clipboard.readText();
        if (text && text !== clipboardContent && /(rs\.?|inr|\$|spent|paid|received|amt)/i.test(text)) {
          setClipboardContent(text); setRawMessage(text);
          if (isAutoAdding) await processMessage({ message: text });
        }
      } catch (err) { if (err.name !== 'NotAllowedError') console.error('Clipboard error:', err); }
    };
    let interval;
    if (isListening) { interval = setInterval(checkClipboard, 2000); window.addEventListener('focus', checkClipboard); }
    return () => { clearInterval(interval); window.removeEventListener('focus', checkClipboard); };
  }, [isListening, isAutoAdding, clipboardContent, token]);

  const processMessage = async (payload) => {
    setIsParsing(true);
    try {
      const res = await fetch(`${API_BASE}/expenses`, {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ ...payload, apiKey })
      });
      const newExp = await res.json();
      if (newExp.error) throw new Error(newExp.error);
      setExpenses(prev => [newExp, ...prev]);
      const src = newExp.classificationMeta?.source_used;
      if (src === 'gemini') setGeminiStatus('available');
      else if (src === 'rule' || src === 'ml') setGeminiStatus('unavailable');
      if (newExp.needsReview) setReviewingExpense(newExp);
      setRawMessage('');
      fetchAnalytics();
    } catch (err) { console.error('Process failed', err); }
    setIsParsing(false);
  };

  const handleAddExpense = async (e) => {
    e.preventDefault();
    if (!description || !amount) return;
    setIsLoading(true);
    await processMessage({ description, amount: parseFloat(amount) });
    setDescription(''); setAmount('');
    setIsLoading(false);
  };

  const updateCategory = async (id, category) => {
    try {
      const res = await fetch(`${API_BASE}/expenses/${id}`, {
        method: 'PUT', headers: authHeaders, body: JSON.stringify({ category })
      });
      const data = await res.json();
      if (data.success) {
        setExpenses(prev => prev.map(e => e.id === id
          ? { ...e, category, needsReview: false, classificationMeta: data.expense?.classificationMeta || e.classificationMeta }
          : e));
        fetchAnalytics(); setReviewingExpense(null);
      }
    } catch (err) { console.error('Update failed', err); }
  };

  const deleteExpense = async (id) => {
    try {
      await fetch(`${API_BASE}/expenses/${id}`, { method: 'DELETE', headers: authHeaders });
      setExpenses(prev => prev.filter(e => e.id !== id));
      fetchAnalytics();
    } catch (err) { console.error('Delete failed', err); }
  };

  const handleUpdateBudget = async () => {
    if (!newBudgetLimit || isNaN(newBudgetLimit)) return;
    try {
      await fetch(`${API_BASE}/budget`, {
        method: 'PUT', headers: authHeaders,
        body: JSON.stringify({ limit: parseFloat(newBudgetLimit) })
      });
      fetchAnalytics(); setIsEditingBudget(false); setNewBudgetLimit('');
    } catch (err) { console.error('Budget update failed', err); }
  };

  const handleUpdateExpense = useCallback((id, updates) => {
    setExpenses(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
  }, []);

  const sourceData = [
    { name: 'Rule', value: analytics.sourceBreakdown?.rule || 0, color: '#10b981' },
    { name: 'ML', value: analytics.sourceBreakdown?.ml || 0, color: '#6366f1' },
    { name: 'Gemini', value: analytics.sourceBreakdown?.gemini || 0, color: '#a855f7' },
    { name: 'Human', value: analytics.sourceBreakdown?.human || 0, color: '#f59e0b' }
  ].filter(s => s.value > 0);

  // ── Auth screen ──────────────────────────────────────────────────────────────
  if (!token) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl">
          <div className="text-center mb-8">
            <div className="inline-flex p-4 bg-primary-500/10 rounded-2xl text-primary-500 mb-4"><BrainCircuit size={40} /></div>
            <h1 className="text-2xl font-bold text-white">Welcome Back</h1>
            <p className="text-slate-400">AI-Powered Expense Intelligence</p>
          </div>
          <form onSubmit={handleAuth} className="space-y-4">
            <div className="relative">
              <UserIcon className="absolute left-3 top-3 text-slate-500" size={20} />
              <input type="text" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} className="input-field pl-10" required />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-3 text-slate-500" size={20} />
              <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} className="input-field pl-10" required />
            </div>
            {authError && <p className="text-rose-500 text-sm text-center">{authError}</p>}
            <button type="submit" className="btn-primary w-full py-3 text-lg font-bold">
              {authMode === 'login' ? 'Login' : 'Create Account'}
            </button>
          </form>
          <div className="mt-6 text-center">
            <button onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
              className="text-primary-400 hover:text-primary-300 text-sm font-medium">
              {authMode === 'login' ? "Don't have an account? Sign Up" : 'Already have an account? Login'}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans">
      {/* Alert toasts */}
      <AlertToast alerts={alerts} onDismiss={dismissAlert} />

      {/* Header */}
      <header className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BrainCircuit className="text-primary-500 w-7 h-7" />
            <div>
              <h1 className="text-lg font-bold bg-gradient-to-r from-primary-400 to-indigo-400 bg-clip-text text-transparent">
                AI Expense Intelligence
              </h1>
              <div className="flex items-center gap-2 mt-0.5">
                <ConnectionBadge isConnected={isConnected} latency={latency} />
                <span className="text-[10px] text-slate-500">Hello, {user?.username}</span>
              </div>
            </div>
          </div>
          <button onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-rose-500/20 hover:text-rose-400 rounded-xl transition-all border border-slate-700 text-sm">
            <LogOut size={16} /><span className="hidden sm:inline">Logout</span>
          </button>
        </div>

        {/* Tab navigation */}
        <div className="max-w-7xl mx-auto px-4 pb-0 flex gap-1 overflow-x-auto">
          {TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-all whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-primary-500 text-primary-400'
                    : 'border-transparent text-slate-400 hover:text-slate-300'
                }`}>
                <Icon size={14} />{tab.label}
              </button>
            );
          })}
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-6">
        {/* ── FRAUD DETECTION TAB ── */}
        {activeTab === 'fraud' && (
          <FraudDashboard token={token} expenses={expenses}
            onUpdateExpense={handleUpdateExpense} onRefreshSnapshot={fetchAnalytics} />
        )}

        {/* ── FORECAST TAB ── */}
        {activeTab === 'forecast' && <ForecastDashboard token={token} />}

        {/* ── ML PANEL TAB ── */}
        {activeTab === 'ml' && (
          <div className="max-w-lg mx-auto">
            <MLAdminPanel token={token} />
          </div>
        )}

        {/* ── DASHBOARD TAB ── */}
        {activeTab === 'dashboard' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left column */}
            <div className="lg:col-span-4 space-y-6">
              {/* Quick AI Parse */}
              <div className="card border-primary-500/30 bg-primary-500/5">
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <BrainCircuit size={20} className="text-primary-400" />Quick AI Parse
                </h2>
                <div className="mb-4">
                  <button onClick={() => setIsListening(!isListening)}
                    className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${
                      isListening ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' : 'bg-slate-800/50 border-slate-700 text-slate-400'
                    }`}>
                    <div className="flex items-center gap-2">
                      <Zap size={18} className={isListening ? 'animate-pulse' : ''} />
                      <span className="text-sm font-medium">Auto-Listen Clipboard</span>
                    </div>
                    <div className={`w-10 h-5 rounded-full relative transition-colors ${isListening ? 'bg-emerald-500' : 'bg-slate-700'}`}>
                      <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${isListening ? 'left-6' : 'left-1'}`} />
                    </div>
                  </button>
                  {isListening && (
                    <motion.button initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
                      onClick={() => setIsAutoAdding(!isAutoAdding)}
                      className={`w-full mt-2 flex items-center justify-between p-3 rounded-xl border transition-all ${
                        isAutoAdding ? 'bg-indigo-500/10 border-indigo-500/50 text-indigo-400' : 'bg-slate-800/30 border-slate-700/50 text-slate-500'
                      }`}>
                      <div className="flex items-center gap-2">
                        <Zap size={16} className={isAutoAdding ? 'fill-indigo-400' : ''} />
                        <span className="text-xs font-medium">Zero-Effort Auto-Add</span>
                      </div>
                      <div className={`w-8 h-4 rounded-full relative transition-colors ${isAutoAdding ? 'bg-indigo-500' : 'bg-slate-700'}`}>
                        <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${isAutoAdding ? 'left-4' : 'left-0.5'}`} />
                      </div>
                    </motion.button>
                  )}
                </div>
                <form onSubmit={e => { e.preventDefault(); processMessage({ message: rawMessage }); }} className="space-y-4">
                  <textarea value={rawMessage} onChange={e => setRawMessage(e.target.value)}
                    placeholder="Paste banking SMS here..." className="input-field h-24 resize-none" required />
                  <button type="submit" disabled={isParsing || !rawMessage}
                    className="btn-primary w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500">
                    {isParsing ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      : <><BrainCircuit size={20} /><span>Extract with AI</span></>}
                  </button>
                </form>
              </div>

              {/* Add Transaction */}
              <div className="card">
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <Plus size={20} className="text-primary-400" />Add Transaction
                </h2>
                <form onSubmit={handleAddExpense} className="space-y-4">
                  <input type="text" value={description} onChange={e => setDescription(e.target.value)}
                    placeholder="Description" className="input-field" required />
                  <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
                    placeholder="Amount (₹)" className="input-field" step="0.01" required />
                  <button type="submit" disabled={isLoading}
                    className="btn-primary w-full flex items-center justify-center gap-2">
                    {isLoading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      : <><Plus size={20} /><span>Track Expense</span></>}
                  </button>
                </form>
              </div>

              {/* Budget Overview */}
              <div className="card">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    <Wallet size={20} className="text-primary-400" />Budget Overview
                  </h2>
                  <button onClick={() => { setIsEditingBudget(!isEditingBudget); setNewBudgetLimit(analytics.budgetLimit); }}
                    className="text-xs text-primary-400 hover:text-primary-300 font-medium">
                    {isEditingBudget ? 'Cancel' : 'Edit'}
                  </button>
                </div>
                <div className="space-y-4">
                  {isEditingBudget ? (
                    <div className="flex gap-2">
                      <input type="number" value={newBudgetLimit} onChange={e => setNewBudgetLimit(e.target.value)}
                        className="input-field py-1 text-sm" placeholder="New limit" />
                      <button onClick={handleUpdateBudget} className="btn-primary py-1 px-3 text-xs">Save</button>
                    </div>
                  ) : (
                    <div className="flex justify-between items-end">
                      <div><p className="text-sm text-slate-400">Total Spent</p>
                        <motion.p key={analytics.totalSpent} initial={{ scale: 1.05 }} animate={{ scale: 1 }}
                          className="text-3xl font-bold">
                          ₹{(analytics.totalSpent || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </motion.p></div>
                      <div className="text-right"><p className="text-sm text-slate-400">Budget</p>
                        <p className="text-lg font-semibold">₹{(analytics.budgetLimit || 0).toLocaleString('en-IN')}</p></div>
                    </div>
                  )}
                  <div className="relative h-3 bg-slate-900 rounded-full overflow-hidden">
                    <motion.div animate={{ width: `${Math.min(((analytics.totalSpent || 0) / (analytics.budgetLimit || 1)) * 100, 100)}%` }}
                      transition={{ type: 'spring', stiffness: 80 }}
                      className={`h-full rounded-full ${analytics.isOverBudget ? 'bg-rose-500' : 'bg-primary-500'}`} />
                  </div>
                  {analytics.isOverBudget && (
                    <div className="flex items-center gap-2 text-rose-400 text-sm bg-rose-500/10 p-3 rounded-lg border border-rose-500/20">
                      <AlertCircle size={16} />
                      <span>Over by ₹{(analytics.overAmount || 0).toLocaleString('en-IN')}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right column */}
            <div className="lg:col-span-8 space-y-6">
              {/* Charts */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="card h-72">
                  <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <PieChartIcon size={18} className="text-primary-400" />Spending by Category
                  </h2>
                  <div className="h-full pb-8">
                    {analytics.categoryBreakdown?.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={analytics.categoryBreakdown} cx="50%" cy="50%" innerRadius={55} outerRadius={75} paddingAngle={4} dataKey="value">
                            {analytics.categoryBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                          </Pie>
                          <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f1f5f9', fontSize: 11 }} />
                          <Legend verticalAlign="bottom" height={32} iconSize={8}
                            formatter={v => <span style={{ fontSize: 10, color: '#94a3b8' }}>{v}</span>} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : <div className="h-full flex items-center justify-center text-slate-500 text-sm">No data yet</div>}
                  </div>
                </div>

                <div className="card h-72">
                  <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <Brain size={18} className="text-indigo-400" />Classification Sources
                  </h2>
                  <div className="h-full pb-8">
                    {sourceData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={sourceData}>
                          <XAxis dataKey="name" stroke="#475569" fontSize={11} tick={{ fill: '#64748b' }} />
                          <YAxis stroke="#475569" fontSize={10} tick={{ fill: '#64748b' }} />
                          <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                            contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', fontSize: 11 }} />
                          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                            {sourceData.map((s, i) => <Cell key={i} fill={s.color} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
                        <Brain size={28} className="opacity-30" />
                        <p className="text-sm">Add expenses to see classification breakdown</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Transactions table */}
              <div className="card overflow-hidden">
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <LayoutDashboard size={20} className="text-primary-400" />Recent Transactions
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-700">
                        <th className="pb-3 font-medium">Description</th>
                        <th className="pb-3 font-medium">Category</th>
                        <th className="pb-3 font-medium">Risk</th>
                        <th className="pb-3 font-medium">Source</th>
                        <th className="pb-3 font-medium">Date</th>
                        <th className="pb-3 font-medium text-right">Amount</th>
                        <th className="pb-3 font-medium text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      <AnimatePresence>
                        {expenses.length > 0 ? expenses.map(exp => {
                          const riskColor = exp.risk_level === 'high' ? 'text-rose-400 bg-rose-500/10 border-rose-500/30'
                            : exp.risk_level === 'medium' ? 'text-amber-400 bg-amber-500/10 border-amber-500/30'
                            : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
                          return (
                            <motion.tr key={exp.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                              className={`group hover:bg-slate-800/30 transition-colors ${exp.needsReview ? 'bg-amber-500/5 border-l-2 border-amber-500' : ''}`}>
                              <td className="py-3 font-medium max-w-[160px]">
                                <span className="truncate block">{exp.description}</span>
                                {exp.needsReview && <span className="text-[10px] text-amber-500 font-bold">REVIEW</span>}
                              </td>
                              <td className="py-3">
                                <button onClick={() => setReviewingExpense(exp)}
                                  className={`px-2 py-0.5 rounded-full text-xs font-medium transition-all ${
                                    exp.needsReview ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30'
                                      : 'bg-primary-500/10 text-primary-400 border border-primary-500/20'
                                  }`}>{exp.category}</button>
                              </td>
                              <td className="py-3">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${riskColor}`}>
                                  {exp.anomaly_score > 0 ? exp.anomaly_score : '—'}
                                </span>
                              </td>
                              <td className="py-3">
                                {exp.classificationMeta && (
                                  <div onMouseEnter={() => setHoveredMeta(exp.id)} onMouseLeave={() => setHoveredMeta(null)} className="relative">
                                    <ConfidenceBadge meta={exp.classificationMeta} compact />
                                    {hoveredMeta === exp.id && (
                                      <div className="absolute z-10 left-0 top-6 bg-slate-800 border border-slate-700 rounded-xl p-3 shadow-xl min-w-[180px]">
                                        <ConfidenceTooltip meta={exp.classificationMeta} />
                                      </div>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="py-3 text-slate-400 text-xs">{new Date(exp.date).toLocaleDateString()}</td>
                              <td className="py-3 text-right font-semibold">₹{exp.amount.toFixed(2)}</td>
                              <td className="py-3 text-center">
                                <button onClick={() => deleteExpense(exp.id)} className="text-slate-500 hover:text-rose-400 transition-colors">
                                  <Trash2 size={15} />
                                </button>
                              </td>
                            </motion.tr>
                          );
                        }) : (
                          <tr><td colSpan="7" className="py-8 text-center text-slate-500 italic">No transactions yet</td></tr>
                        )}
                      </AnimatePresence>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Category Review Modal */}
      <AnimatePresence>
        {reviewingExpense && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={() => setReviewingExpense(null)} />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-lg bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl p-6">
              <h2 className="text-xl font-bold mb-1">Review Category</h2>
              <p className="text-slate-400 text-sm mb-3">Correct the category for: <strong>{reviewingExpense.description}</strong></p>
              {reviewingExpense.classificationMeta && (
                <div className="mb-4 p-3 bg-slate-800/50 rounded-xl border border-slate-700">
                  <p className="text-xs text-slate-400 mb-2">Classification pipeline result:</p>
                  <ConfidenceTooltip meta={reviewingExpense.classificationMeta} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 mb-4">
                {CATEGORIES.map(cat => (
                  <button key={cat} onClick={() => updateCategory(reviewingExpense.id, cat)}
                    className={`p-4 rounded-2xl border text-sm font-semibold transition-all ${
                      reviewingExpense.category === cat
                        ? 'bg-primary-500 border-primary-400 text-white'
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-primary-500/50'
                    }`}>{cat}</button>
                ))}
              </div>
              <p className="text-xs text-slate-500 text-center mb-3">Your correction trains the ML model.</p>
              <button onClick={() => setReviewingExpense(null)} className="w-full py-2 text-slate-500 text-sm">Cancel</button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
