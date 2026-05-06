// Screen 3: Personal Dashboard.
//
// Tabs:
//   overview  — hero stats + recent tx + goals (uses /api/dashboard/me)
//   budget    — category list with progress bars
//   goals     — full goal cards with "add savings" buttons
//   family    — sibling member cards + shared goals (uses /api/dashboard/family)

import { useState, useEffect, useCallback } from 'react';
import { fetchMyDashboard, fetchFamilyDashboard } from '../api/dashboard.js';
import { listTransactions, createTransaction } from '../api/transactions.js';
import { listCategories } from '../api/budget.js';
import { listGoals, createGoal, contributeToGoal, listGoalContributors } from '../api/goals.js';
import { roleConfig, computeGoalProgress, computeCategoryStatus } from '../domain/roles.js';
import {
  EXPENSE_CATEGORY_OPTIONS,
  INCOME_CATEGORY_OPTIONS,
  TEEN_EXPENSE_CATEGORY_OPTIONS,
  mergeCategoryOptions,
} from '../domain/categories.js';
import {
  Modal, FormField, inputStyle, selectStyle, btnPrimary, btnSecondary,
} from './shared.jsx';
import ImportCSVModal from './ImportCSVModal.jsx';

/**
 * Card for a single shared family goal. Lazily loads its contributor
 * ledger on mount so the family-tab grid doesn't issue N+1 requests
 * up-front when there are many shared goals — each card fetches its
 * own breakdown independently. Cheap because the ledger is tiny.
 */
function SharedGoalCard({ goal }) {
  const [contribs, setContribs] = useState(null); // null = loading, [] = none, [...] = list
  useEffect(() => {
    let cancelled = false;
    listGoalContributors(goal.id)
      .then((list) => { if (!cancelled) setContribs(list); })
      .catch(() => { if (!cancelled) setContribs([]); });
    return () => { cancelled = true; };
  }, [goal.id]);

  return (
    <div style={{ background: '#fff', border: '1px solid #e8e4df', borderRadius: 16, padding: 20 }}>
      <div style={{ fontSize: 22, marginBottom: 6 }}>{goal.icon}</div>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{goal.name}</div>
      <div style={{ fontSize: 11, color: '#a8a29e' }}>
        Target ${goal.targetAmount.toLocaleString()}
        {goal.deadline ? ` · ${new Date(goal.deadline).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}` : ''}
      </div>
      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 18, color: '#3d6b52', marginTop: 4 }}>
        ${goal.currentAmount.toLocaleString()}
      </div>
      <div style={{ fontSize: 11, color: '#57534e', marginTop: 2 }}>{goal.progressPercent}% complete</div>
      <div style={{ height: 6, background: '#f2f0ed', borderRadius: 3, overflow: 'hidden', marginTop: 8 }}>
        <div style={{ height: '100%', width: `${goal.progressPercent}%`, background: '#3d6b52', borderRadius: 3 }} />
      </div>

      {/* Per-contributor breakdown */}
      {contribs && contribs.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #f2f0ed' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#a8a29e', marginBottom: 6 }}>Contributors</div>
          {contribs.map((c) => {
            const crc = roleConfig(c.role);
            const pctOfPool = goal.currentAmount > 0
              ? Math.round((c.totalContributed / goal.currentAmount) * 100)
              : 0;
            return (
              <div key={c.memberId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 11 }}>
                <span style={{ width: 16, height: 16, borderRadius: '50%', background: crc.bg, border: `1px solid ${crc.mid}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, flexShrink: 0 }}>{crc.icon}</span>
                <span style={{ flex: 1, color: '#1c1917' }}>{c.name}</span>
                <span style={{ fontFamily: "'DM Mono',monospace", color: crc.color, fontWeight: 600 }}>${c.totalContributed.toLocaleString()}</span>
                <span style={{ color: '#a8a29e', minWidth: 32, textAlign: 'right' }}>{pctOfPool}%</span>
              </div>
            );
          })}
        </div>
      )}
      {contribs && contribs.length === 0 && (
        <div style={{ marginTop: 10, fontSize: 11, color: '#a8a29e', fontStyle: 'italic' }}>
          No contributions yet — be the first!
        </div>
      )}
    </div>
  );
}

export default function DashboardScreen({ session, onSwitchProfile, onGoToAdmin, onShowToast }) {
  const profile = session.member;
  const rc = roleConfig(profile.role);

  const [tab, setTab] = useState('overview');

  /* ── State backed by API calls ────────────────────────────────── */
  const [dash, setDash]               = useState(null);   // /api/dashboard/me payload
  const [cats, setCats]               = useState([]);     // budget tab
  const [goals, setGoals]             = useState([]);     // goals tab
  const [familyData, setFamilyData]   = useState(null);   // family tab
  const [loadError, setLoadError]     = useState(null);

  /* ── Modal state ──────────────────────────────────────────────── */
  const [addTxOpen, setAddTxOpen]         = useState(false);
  const [importOpen, setImportOpen]       = useState(false);
  const [addGoalOpen, setAddGoalOpen]     = useState(false);
  const [addSavingsOpen, setAddSavingsOpen] = useState(null); // goalId or null

  const [txDesc, setTxDesc] = useState('');
  const [txAmt, setTxAmt]   = useState('');
  const [txType, setTxType] = useState('expense');
  const [txCat, setTxCat]   = useState('');
  const [txDate, setTxDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [txErr, setTxErr]   = useState(null);

  const [goalName, setGoalName]       = useState('');
  const [goalIcon, setGoalIcon]       = useState('🎯');
  const [goalTarget, setGoalTarget]   = useState('');
  const [goalDeadline, setGoalDeadline] = useState('');

  const [savingsAmt, setSavingsAmt]   = useState('');

  /* ── Data loaders ─────────────────────────────────────────────── */
  // Junior cannot have transaction-related endpoints fail loudly — they have no tx
  const loadOverview = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await fetchMyDashboard();
      setDash(data);
      setCats(data.categories || []);
      setGoals(data.goals || []);
    } catch (err) {
      setLoadError(err.message || 'Could not load dashboard');
    }
  }, []);

  const loadGoals = useCallback(async () => {
    try {
      const list = await listGoals();
      setGoals(list);
    } catch (err) {
      onShowToast(err.message || 'Could not load goals');
    }
  }, [onShowToast]);

  const loadCategories = useCallback(async () => {
    try {
      const list = await listCategories();
      setCats(list);
    } catch (err) {
      onShowToast(err.message || 'Could not load categories');
    }
  }, [onShowToast]);

  const loadFamily = useCallback(async () => {
    try {
      setFamilyData(await fetchFamilyDashboard());
    } catch (err) {
      onShowToast(err.message || 'Could not load family');
    }
  }, [onShowToast]);

  // Initial load + per-tab refresh
  useEffect(() => {
    if (tab === 'overview') loadOverview();
    else if (tab === 'budget') loadCategories();
    else if (tab === 'goals')  loadGoals();
    else if (tab === 'family') loadFamily();
  }, [tab, loadOverview, loadCategories, loadGoals, loadFamily]);

  /* ── Handlers ─────────────────────────────────────────────────── */
  const handleAddTx = async () => {
    setTxErr(null);
    if (!txDesc.trim()) { setTxErr('Description is required'); return; }
    const amt = parseFloat(txAmt);
    if (!(amt > 0)) { setTxErr('Amount must be positive'); return; }
    if (!txCat) { setTxErr('Category is required'); return; }

    try {
      const result = await createTransaction({
        description: txDesc.trim(),
        amount: amt,
        type: txType,
        category: txCat,
        date: txDate,
      });
      setAddTxOpen(false);
      setTxDesc(''); setTxAmt(''); setTxCat('');
      onShowToast(result.overLimit ? `Saved — over ${result.category?.name} budget!` : 'Transaction saved');
      loadOverview();
    } catch (err) {
      setTxErr(err.message || 'Could not save transaction');
    }
  };

  const handleAddGoal = async () => {
    if (!goalName.trim()) return;
    const target = parseFloat(goalTarget);
    if (!(target > 0)) return;
    try {
      await createGoal({
        name: goalName.trim(),
        icon: goalIcon,
        targetAmount: target,
        deadline: goalDeadline || null,
        isShared: false,
      });
      onShowToast('Goal created');
      setAddGoalOpen(false);
      setGoalName(''); setGoalTarget(''); setGoalDeadline(''); setGoalIcon('🎯');
      loadGoals();
    } catch (err) {
      onShowToast(err.message || 'Could not create goal');
    }
  };

  const handleAddSavings = async (goalId) => {
    const amt = parseFloat(savingsAmt);
    if (!(amt > 0)) return;
    try {
      await contributeToGoal(goalId, amt);
      onShowToast('Savings added!');
      setAddSavingsOpen(null);
      setSavingsAmt('');
      loadGoals();
    } catch (err) {
      onShowToast(err.message || 'Could not add savings');
    }
  };

  /* ── Derived numbers (from dash payload, which is server-computed) ─ */
  const totals = dash?.totals || { income: 0, spent: 0, remaining: 0, savingsRate: 0, limit: 0 };
  const remaining = totals.remaining;
  const savingsRate = totals.savingsRate;
  const totalSpent = totals.spent;
  const totalLimit = totals.limit;
  const recentTxs = dash?.recentTransactions || [];

  // For Add Tx category dropdown: split income labels from expense budget categories.
  const expenseCategories = (() => {
    if (profile.role === 'teen') return TEEN_EXPENSE_CATEGORY_OPTIONS;
    if (profile.role === 'junior') return [];
    return mergeCategoryOptions(cats.map((c) => c.name), EXPENSE_CATEGORY_OPTIONS);
  })();
  const categoryOptions = txType === 'income' ? INCOME_CATEGORY_OPTIONS : expenseCategories;

  /* ── Top bar ──────────────────────────────────────────────────── */
  const topBar = (
    <div style={{ height: 56, background: '#fff', borderBottom: '1px solid #e8e4df', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', position: 'sticky', top: 0, zIndex: 100 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: rc.bg, border: `1px solid ${rc.mid}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{rc.icon}</div>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#1c1917' }}>{profile.name}</span>
        <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, padding: '2px 8px', borderRadius: 100, background: rc.bg, color: rc.color }}>{rc.label}</span>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {['overview', 'budget', 'goals', 'family'].map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '6px 16px', borderRadius: 8, border: 'none', background: tab === t ? rc.bg : 'transparent', color: tab === t ? rc.color : '#a8a29e', fontSize: 12, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize', fontFamily: 'inherit', transition: 'all .2s' }}>{t}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {profile.role === 'admin' && <button onClick={onGoToAdmin} style={{ ...btnSecondary, padding: '6px 14px', fontSize: 11 }}>Admin Panel</button>}
        <button onClick={onSwitchProfile} style={{ ...btnSecondary, padding: '6px 14px', fontSize: 11 }}>Switch Profile</button>
      </div>
    </div>
  );

  /* ── OVERVIEW TAB ─────────────────────────────────────────────── */
  const overviewTab = (
    <div style={{ padding: '20px 24px', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ background: rc.bg, border: `1px solid ${rc.mid}`, borderRadius: 16, padding: '28px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: rc.color, marginBottom: 4 }}>{dash?.period || ''} · Personal Overview</div>
          <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 28, fontWeight: 400, color: '#1c1917', marginBottom: 4 }}>
            {profile.role === 'junior' ? `Hi ${profile.name} ⭐` : `Good morning, ${profile.name}`}
          </div>
          <div style={{ fontSize: 12, color: '#57534e' }}>Monthly budget · ${(totals.income).toLocaleString()} income</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 100, background: 'rgba(255,255,255,.7)', color: rc.color }}>{rc.icon} {savingsRate}% savings rate</span>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 100, background: 'rgba(255,255,255,.7)', color: remaining < 0 ? '#c0392b' : '#57534e' }}>{remaining < 0 ? '⚠ Over budget' : '✓ On track'}</span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 36, fontWeight: 500, color: remaining < 0 ? '#c0392b' : rc.color }}>${Math.abs(remaining).toLocaleString()}</div>
          <div style={{ fontSize: 11, color: '#a8a29e' }}>{remaining < 0 ? 'Over limit' : 'Remaining'}</div>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Spent', value: `$${totalSpent.toLocaleString()}`, sub: totalLimit > 0 ? `${Math.round(totalSpent / totalLimit * 100)}% of limit` : '—', icon: '💰' },
          { label: 'Income', value: `$${totals.income.toLocaleString()}`, sub: 'This month', icon: '📈' },
          { label: 'Savings', value: `${savingsRate}%`, sub: savingsRate >= 20 ? 'Above 20% goal' : 'Below 20% goal', icon: '🛡️' },
          { label: 'Goals', value: String(goals.length), sub: 'Active goals', icon: '🎯' },
        ].map((s, i) => (
          <div key={i} style={{ background: '#fff', border: '1px solid #e8e4df', borderRadius: 14, padding: '18px 16px' }}>
            <div style={{ fontSize: 11, color: '#a8a29e', marginBottom: 6 }}>{s.icon} {s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 600, fontFamily: "'DM Mono',monospace", color: '#1c1917' }}>{s.value}</div>
            <div style={{ fontSize: 11, color: s.label === 'Savings' ? (savingsRate >= 20 ? '#3d6b52' : '#c0392b') : '#a8a29e', marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Smart Insight banner — rule-based tip generated by the backend
          dashboard service. Updates live whenever any underlying data
          changes (cache is invalidated on transaction insert / contribution). */}
      {dash?.insight && (
        <div style={{
          background: '#fff', border: `1px solid ${rc.mid}`, borderLeft: `4px solid ${rc.color}`,
          borderRadius: 14, padding: '14px 18px', marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, color: rc.color, flexShrink: 0 }}>Smart Insight</div>
          <div style={{ width: 1, height: 24, background: '#e8e4df', flexShrink: 0 }} />
          <div style={{ fontSize: 13, color: '#1c1917', lineHeight: 1.45 }}>{dash.insight}</div>
        </div>
      )}

      {/* Two-col layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: '#fff', border: '1px solid #e8e4df', borderRadius: 14, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, color: '#a8a29e' }}>Recent Transactions</div>
            {profile.role !== 'junior' && <button onClick={() => setAddTxOpen(true)} style={{ ...btnPrimary(rc.color), padding: '5px 12px', fontSize: 11 }}>+ Add</button>}
          </div>
          {recentTxs.length === 0 ? (
            <div style={{ fontSize: 12, color: '#a8a29e', padding: '20px 0', textAlign: 'center' }}>No transactions yet.</div>
          ) : recentTxs.map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f2f0ed' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#1c1917' }}>{t.description}</div>
                <div style={{ fontSize: 11, color: '#a8a29e' }}>{t.category}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, fontWeight: 500, color: t.type === 'income' ? '#3d6b52' : '#1c1917' }}>{t.type === 'income' ? '+' : '−'}${Number(t.amount).toFixed(0)}</div>
                <div style={{ fontSize: 10, color: '#a8a29e' }}>{t.date}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: '#fff', border: '1px solid #e8e4df', borderRadius: 14, padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, color: '#a8a29e', marginBottom: 14 }}>Goals</div>
          {goals.length === 0 ? (
            <div style={{ fontSize: 12, color: '#a8a29e' }}>No active goals.</div>
          ) : goals.slice(0, 4).map((g) => {
            const pct = g.progressPercent ?? computeGoalProgress(g.currentAmount, g.targetAmount);
            return (
              <div key={g.id} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{g.icon} {g.name}{g.isShared ? ' · Shared' : ''}</span>
                  <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: rc.color }}>{pct}%</span>
                </div>
                <div style={{ height: 6, background: '#f2f0ed', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: rc.color, borderRadius: 3, transition: 'width .5s ease' }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  /* ── BUDGET TAB ───────────────────────────────────────────────── */
  const budgetTab = (
    <div style={{ padding: '20px 24px', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{profile.name}'s Budget</div>
          <div style={{ fontSize: 12, color: '#a8a29e', marginTop: 3 }}>{dash?.period || ''} · Limit ${totalLimit.toLocaleString()}</div>
        </div>
        {profile.role !== 'junior' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setImportOpen(true)} style={btnSecondary}>📄 Import CSV</button>
            <button onClick={() => setAddTxOpen(true)} style={btnPrimary(rc.color)}>+ Add transaction</button>
          </div>
        )}
      </div>

      <div style={{ background: '#fff', border: '1px solid #e8e4df', borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, color: '#a8a29e', marginBottom: 16 }}>Categories</div>
        {cats.length === 0 ? (
          <div style={{ fontSize: 12, color: '#a8a29e', padding: '20px 0', textAlign: 'center' }}>No budget categories yet.</div>
        ) : cats.map((c) => {
          const pct = Math.min(Math.round(c.amountSpent / Math.max(c.monthlyLimit, 1) * 100), 100);
          const st = computeCategoryStatus(c.amountSpent, c.monthlyLimit);
          return (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderBottom: '1px solid #f2f0ed' }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: rc.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{c.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{c.name}</div>
                <div style={{ height: 6, background: '#f2f0ed', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: st.color, borderRadius: 3, transition: 'width .5s ease' }} />
                </div>
              </div>
              <div style={{ textAlign: 'right', minWidth: 80 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: st.status === 'over' ? '#c0392b' : '#1c1917' }}>${Number(c.amountSpent).toFixed(0)}</div>
                <div style={{ fontSize: 11, color: '#a8a29e' }}>of ${Number(c.monthlyLimit).toFixed(0)}</div>
                <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: st.status === 'over' ? 'rgba(192,57,43,.08)' : '#f2f0ed', color: st.color }}>{st.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  /* ── GOALS TAB ────────────────────────────────────────────────── */
  const goalsTab = (
    <div style={{ padding: '20px 24px', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{profile.name}'s Goals</div>
          <div style={{ fontSize: 12, color: '#a8a29e', marginTop: 3 }}>{goals.length} active goals</div>
        </div>
        <button onClick={() => setAddGoalOpen(true)} style={btnPrimary(rc.color)}>+ New goal</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
        {goals.map((g) => {
          const pct = g.progressPercent ?? computeGoalProgress(g.currentAmount, g.targetAmount);
          let monthlySavings = null;
          if (g.deadline) {
            const msLeft = new Date(g.deadline).getTime() - Date.now();
            const monthsLeft = Math.max(1, Math.ceil(msLeft / (30 * 86400000)));
            monthlySavings = ((g.targetAmount - g.currentAmount) / monthsLeft).toFixed(0);
          }
          return (
            <div key={g.id} style={{ background: '#fff', border: '1px solid #e8e4df', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: rc.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{g.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{g.name}</div>
              <div style={{ fontSize: 11, color: '#a8a29e' }}>Target ${Number(g.targetAmount).toLocaleString()}{g.deadline ? ` · ${new Date(g.deadline).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}` : ''}</div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 18, fontWeight: 500, color: rc.color }}>${Number(g.currentAmount).toLocaleString()}</div>
              <div style={{ fontSize: 11, color: '#57534e' }}>{pct}% of goal reached{g.isShared ? ' · Shared' : ''}</div>
              <div style={{ height: 6, background: '#f2f0ed', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: rc.color, borderRadius: 3 }} />
              </div>
              {monthlySavings && monthlySavings > 0 && <div style={{ fontSize: 10, color: '#a8a29e' }}>Save ${monthlySavings}/mo to reach by deadline</div>}
              <button onClick={() => { setAddSavingsOpen(g.id); setSavingsAmt(''); }} style={{ marginTop: 4, padding: '7px 14px', borderRadius: 8, border: `1px solid ${rc.color}22`, background: `${rc.color}08`, color: rc.color, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>+ Add savings</button>
            </div>
          );
        })}
        {goals.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#a8a29e', padding: 40 }}>No goals yet. Click "+ New goal" to create one.</div>
        )}
      </div>
    </div>
  );

  /* ── FAMILY TAB ───────────────────────────────────────────────── */
  const familyTab = (
    <div style={{ padding: '20px 24px', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>{session.family?.name || 'Your Family'}</div>
      <div style={{ fontSize: 12, color: '#a8a29e', marginBottom: 20 }}>All members · {familyData?.period || ''}</div>

      {!familyData ? (
        <div style={{ color: '#a8a29e', fontSize: 13 }}>Loading family…</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 24 }}>
            {familyData.members.map((m) => {
              const mrc = roleConfig(m.role);
              const st = computeCategoryStatus(m.spent, m.monthlyLimit);
              return (
                <div key={m.id} style={{ background: '#fff', border: '1px solid #e8e4df', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 52, height: 52, borderRadius: '50%', background: mrc.bg, border: `1.5px solid ${mrc.mid}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>{mrc.icon}</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{m.name}</div>
                  <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: mrc.color }}>{mrc.label}</div>
                  <div style={{ width: '100%', height: 6, background: '#f2f0ed', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(m.percentageUsed, 100)}%`, background: st.color, borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: 11, color: m.spent > m.monthlyLimit ? '#c0392b' : '#a8a29e' }}>${m.spent} / ${m.monthlyLimit} · {st.label}</div>
                </div>
              );
            })}
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, color: '#a8a29e', marginBottom: 12 }}>Shared Goals</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 24 }}>
            {familyData.sharedGoals.map((g) => (
              <SharedGoalCard key={g.id} goal={g} />
            ))}
            {familyData.sharedGoals.length === 0 && (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#a8a29e', padding: 30 }}>No shared family goals yet.</div>
            )}
          </div>
        </>
      )}
    </div>
  );

  /* ── Render ───────────────────────────────────────────────────── */
  return (
    <div style={{ minHeight: '100vh', background: '#f7f5f2' }}>
      {topBar}
      {loadError && <div style={{ background: 'rgba(192,57,43,.06)', color: '#c0392b', padding: '8px 16px', fontSize: 12, textAlign: 'center' }}>{loadError}</div>}

      {tab === 'overview' && overviewTab}
      {tab === 'budget'   && budgetTab}
      {tab === 'goals'    && goalsTab}
      {tab === 'family'   && familyTab}

      {/* Add Transaction Modal */}
      <Modal open={addTxOpen} onClose={() => { setAddTxOpen(false); setTxErr(null); }} title="Add transaction" subtitle={`Recording for ${profile.name}'s personal budget`}>
        {txErr && <div style={{ background: 'rgba(192,57,43,.06)', color: '#c0392b', padding: '8px 12px', borderRadius: 8, fontSize: 12, marginBottom: 12 }}>{txErr}</div>}
        <FormField label="Description"><input style={inputStyle} value={txDesc} onChange={(e) => setTxDesc(e.target.value)} placeholder="e.g. Groceries at Trader Joe's" /></FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Amount ($)"><input style={inputStyle} type="number" value={txAmt} onChange={(e) => setTxAmt(e.target.value)} placeholder="0.00" /></FormField>
          <FormField label="Type">
            <select style={selectStyle} value={txType} onChange={(e) => { setTxType(e.target.value); setTxCat(''); }}>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </FormField>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Category">
            <select style={selectStyle} value={txCat} onChange={(e) => setTxCat(e.target.value)}>
              <option value="">— pick one —</option>
              {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </FormField>
          <FormField label="Date"><input style={inputStyle} type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} /></FormField>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
          <button style={btnSecondary} onClick={() => { setAddTxOpen(false); setTxErr(null); }}>Cancel</button>
          <button style={btnPrimary(rc.color)} onClick={handleAddTx}>Save transaction</button>
        </div>
      </Modal>

      {/* Add Goal Modal */}
      <Modal open={addGoalOpen} onClose={() => setAddGoalOpen(false)} title="New savings goal" subtitle="Set a target and track your progress.">
        <FormField label="Goal name"><input style={inputStyle} value={goalName} onChange={(e) => setGoalName(e.target.value)} placeholder="e.g. New laptop" /></FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Target ($)"><input style={inputStyle} type="number" value={goalTarget} onChange={(e) => setGoalTarget(e.target.value)} placeholder="1000" /></FormField>
          <FormField label="Target date (optional)"><input style={inputStyle} type="date" value={goalDeadline} onChange={(e) => setGoalDeadline(e.target.value)} /></FormField>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
          <button style={btnSecondary} onClick={() => setAddGoalOpen(false)}>Cancel</button>
          <button style={btnPrimary(rc.color)} onClick={handleAddGoal}>Create goal</button>
        </div>
      </Modal>

      {/* Add Savings Modal */}
      <Modal open={!!addSavingsOpen} onClose={() => setAddSavingsOpen(null)} title="Add savings" subtitle="How much would you like to contribute?">
        <FormField label="Amount ($)"><input style={inputStyle} type="number" value={savingsAmt} onChange={(e) => setSavingsAmt(e.target.value)} placeholder="50" /></FormField>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
          <button style={btnSecondary} onClick={() => setAddSavingsOpen(null)}>Cancel</button>
          <button style={btnPrimary(rc.color)} onClick={() => handleAddSavings(addSavingsOpen)}>Add savings</button>
        </div>
      </Modal>

      {/* Import CSV Modal */}
      <ImportCSVModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onShowToast={(msg) => { onShowToast(msg); loadOverview(); loadCategories(); }}
        accentColor={rc.color}
        memberId={profile.id}
        availableCategories={cats.map((c) => c.name)}
      />
    </div>
  );
}
