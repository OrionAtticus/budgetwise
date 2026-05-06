// Screen 4: Admin Panel.
// Added the spec-compliant Plan Badge that the JSX prototype was missing.

import { useState, useEffect, useCallback } from 'react';
import { fetchFamilyDashboard } from '../api/dashboard.js';
import { listProfiles, updateProfile } from '../api/profiles.js';
import { listFamilyGoals, createGoal, listGoalContributors } from '../api/goals.js';
import { sendNotification, listNotifications } from '../api/notifications.js';
import { roleConfig, computeCategoryStatus, computeGoalProgress } from '../domain/roles.js';
import { Modal, FormField, inputStyle, btnPrimary, btnSecondary } from './shared.jsx';

/** Compact shared-goal card with per-contributor breakdown (admin panel layout). */
function AdminSharedGoalCard({ goal }) {
  const [contribs, setContribs] = useState(null);
  useEffect(() => {
    let cancelled = false;
    listGoalContributors(goal.id)
      .then((list) => { if (!cancelled) setContribs(list); })
      .catch(() => { if (!cancelled) setContribs([]); });
    return () => { cancelled = true; };
  }, [goal.id]);

  const pct = computeGoalProgress(goal.currentAmount, goal.targetAmount);
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e4df', borderRadius: 16, padding: 20 }}>
      <div style={{ fontSize: 22, marginBottom: 6 }}>{goal.icon}</div>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{goal.name}</div>
      <div style={{ fontSize: 11, color: '#a8a29e' }}>Target ${Number(goal.targetAmount).toLocaleString()}{goal.deadline ? ` · ${new Date(goal.deadline).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}` : ''}</div>
      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 18, color: '#3d6b52', marginTop: 4 }}>${Number(goal.currentAmount).toLocaleString()}</div>
      <div style={{ height: 6, background: '#f2f0ed', borderRadius: 3, overflow: 'hidden', marginTop: 8 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: '#3d6b52', borderRadius: 3 }} />
      </div>
      <div style={{ fontSize: 11, color: '#57534e', marginTop: 6 }}>{pct}% complete</div>

      {contribs && contribs.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #f2f0ed' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#a8a29e', marginBottom: 6 }}>Contributors</div>
          {contribs.map((c) => {
            const crc = roleConfig(c.role);
            return (
              <div key={c.memberId} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: 11 }}>
                <span style={{ width: 14, height: 14, borderRadius: '50%', background: crc.bg, border: `1px solid ${crc.mid}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, flexShrink: 0 }}>{crc.icon}</span>
                <span style={{ flex: 1, color: '#1c1917' }}>{c.name}</span>
                <span style={{ fontFamily: "'DM Mono',monospace", color: crc.color, fontWeight: 600 }}>${c.totalContributed.toLocaleString()}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Plan-tier display labels and prices for the new plan badge.
const PLAN_INFO = {
  free:        { label: 'Free',         price: '$0 / mo',       desc: '1 member · Basic budgeting' },
  starter:     { label: 'Starter',      price: '$4.99 / mo',    desc: 'Up to 2 members · Personal goals' },
  family_pro:  { label: 'Family · Pro', price: '$14.99 / mo',   desc: 'Up to 6 members · Unlimited goals · Admin controls · CSV export' },
  enterprise:  { label: 'Enterprise',   price: 'Contact sales', desc: 'Up to 50 members · SSO · Audit logs' },
};

export default function AdminPanel({ session, onBackToDashboard, onShowToast }) {
  const [familyData, setFamilyData]       = useState(null);   // /api/dashboard/family
  const [profiles, setProfiles]           = useState([]);     // /api/profiles
  const [sharedGoals, setSharedGoals]     = useState([]);
  const [notifications, setNotifications] = useState([]);

  /* Modals */
  const [editLimitOpen, setEditLimitOpen] = useState(null);   // memberId or null
  const [newLimit, setNewLimit]           = useState('');
  const [sharedGoalOpen, setSharedGoalOpen] = useState(false);
  const [sgName, setSgName]               = useState('');
  const [sgTarget, setSgTarget]           = useState('');
  const [sgDate, setSgDate]               = useState('');

  const reload = useCallback(async () => {
    try {
      const [fd, pl, sg, ns] = await Promise.all([
        fetchFamilyDashboard(),
        listProfiles(),
        listFamilyGoals(),
        listNotifications(20),
      ]);
      setFamilyData(fd);
      setProfiles(pl);
      setSharedGoals(sg);
      setNotifications(ns);
    } catch (err) {
      onShowToast(err.message || 'Could not load admin data');
    }
  }, [onShowToast]);

  useEffect(() => { reload(); }, [reload]);

  const handleSendNudge = async (memberId) => {
    const m = profiles.find((p) => p.id === memberId);
    try {
      await sendNotification({
        recipientId: memberId,
        type: 'nudge',
        title: `Spending nudge from ${session.member.name}`,
        body: `You've exceeded your monthly budget. Please review your spending.`,
      });
      onShowToast(`Nudge sent to ${m?.name}!`);
      reload();
    } catch (err) {
      onShowToast(err.message || 'Could not send nudge');
    }
  };

  const handleSetLimit = async (memberId) => {
    const limit = parseFloat(newLimit);
    if (!(limit >= 0)) { onShowToast('Limit must be a non-negative number'); return; }
    try {
      await updateProfile(memberId, { monthlyLimit: limit });
      onShowToast('Budget limit updated');
      setEditLimitOpen(null);
      reload();
    } catch (err) {
      onShowToast(err.message || 'Could not update limit');
    }
  };

  const handleCreateSharedGoal = async () => {
    const target = parseFloat(sgTarget);
    if (!sgName.trim() || !(target > 0)) return;
    try {
      await createGoal({
        name: sgName.trim(),
        icon: '🎯',
        targetAmount: target,
        deadline: sgDate || null,
        isShared: true,
      });
      onShowToast('Shared goal created!');
      setSharedGoalOpen(false);
      setSgName(''); setSgTarget(''); setSgDate('');
      reload();
    } catch (err) {
      onShowToast(err.message || 'Could not create goal');
    }
  };

  const family = session.family;
  const planInfo = PLAN_INFO[family?.planTier] || PLAN_INFO.free;
  const totals = familyData || { totalIncome: 0, totalSpent: 0, totalSavings: 0, savingsRate: 0, activeGoalsCount: 0, members: [] };

  return (
    <div style={{ minHeight: '100vh', background: '#f7f5f2' }}>
      {/* Top bar */}
      <div style={{ height: 56, background: '#fff', borderBottom: '1px solid #e8e4df', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#eef5f1', border: '1px solid #c2dace', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>👑</div>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Admin Panel</span>
          <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, padding: '2px 8px', borderRadius: 100, background: '#eef5f1', color: '#3d6b52' }}>Admin</span>
          <span style={{ fontSize: 12, color: '#a8a29e', marginLeft: 8 }}>{family?.name}</span>
        </div>
        <button onClick={onBackToDashboard} style={{ ...btnSecondary, padding: '6px 14px', fontSize: 11 }}>← Back to Dashboard</button>
      </div>

      <div style={{ padding: '20px 24px', maxWidth: 960, margin: '0 auto' }}>
        {/* Hero stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Family Income', value: `$${totals.totalIncome.toLocaleString()}`, icon: '📈', color: '#3d6b52' },
            { label: 'Total Spent',   value: `$${totals.totalSpent.toLocaleString()}`, icon: '💰' },
            { label: 'Family Savings',value: `$${totals.totalSavings.toLocaleString()}`, icon: '🛡️', color: '#3d6b52', sub: `${totals.savingsRate}% savings rate` },
            { label: 'Active Goals',  value: String(totals.activeGoalsCount), icon: '🎯', sub: `${sharedGoals.length} shared` },
          ].map((s, i) => (
            <div key={i} style={{ background: '#fff', border: '1px solid #e8e4df', borderRadius: 14, padding: '18px 16px' }}>
              <div style={{ fontSize: 11, color: '#a8a29e', marginBottom: 6 }}>{s.icon} {s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 600, fontFamily: "'DM Mono',monospace", color: s.color || '#1c1917' }}>{s.value}</div>
              {s.sub && <div style={{ fontSize: 11, color: '#a8a29e', marginTop: 2 }}>{s.sub}</div>}
            </div>
          ))}
        </div>

        {/* Plan badge — was missing from JSX prototype, restored from HTML mockup */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
          <div style={{ flex: 1, background: '#fff', border: '1px solid #e8e4df', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px' }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, border: '1px solid #e8e4df', background: '#eef5f1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>⭐</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Family Plan · {planInfo.label}</div>
              <div style={{ fontSize: 11, color: '#a8a29e', marginTop: 2 }}>{planInfo.desc}</div>
            </div>
            <div style={{ marginLeft: 'auto', fontFamily: "'DM Mono',monospace", fontSize: 13, color: '#3d6b52', whiteSpace: 'nowrap' }}>{planInfo.price}</div>
          </div>
          <div style={{ background: '#fff', border: '1px solid #e8e4df', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: 16 }}>⚙️</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Alerts active</div>
              <div style={{ fontSize: 11, color: '#a8a29e', marginTop: 1 }}>Weekly report · Budget warnings</div>
            </div>
          </div>
        </div>

        {/* Members table */}
        <div style={{ background: '#fff', border: '1px solid #e8e4df', borderRadius: 14, padding: 20, marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, color: '#a8a29e', marginBottom: 16 }}>Family Members</div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 2fr 1fr', gap: 8, padding: '8px 0', borderBottom: '1px solid #e8e4df', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: '#a8a29e' }}>
            <div>Member</div><div>Budget</div><div>Spent</div><div>Remaining</div><div>Progress</div><div>Actions</div>
          </div>
          {totals.members.map((m) => {
            const mrc = roleConfig(m.role);
            const st  = computeCategoryStatus(m.spent, m.monthlyLimit);
            const remaining = m.remaining;
            return (
              <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 2fr 1fr', gap: 8, padding: '12px 0', borderBottom: '1px solid #f2f0ed', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: mrc.bg, border: `1px solid ${mrc.mid}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>{mrc.icon}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{m.name}</div>
                    <div style={{ fontSize: 10, color: mrc.color, fontWeight: 600 }}>{mrc.label}</div>
                  </div>
                </div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12 }}>${m.monthlyLimit.toLocaleString()}</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: st.status === 'over' ? '#c0392b' : '#1c1917' }}>${m.spent.toLocaleString()}</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: remaining < 0 ? '#c0392b' : '#3d6b52' }}>{remaining < 0 ? '−' : ''}${Math.abs(remaining).toLocaleString()}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, height: 6, background: '#f2f0ed', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(m.percentageUsed, 100)}%`, background: st.color, borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 11, color: st.color, fontWeight: 600, minWidth: 32 }}>{m.percentageUsed}%</span>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => { setEditLimitOpen(m.id); setNewLimit(String(m.monthlyLimit)); }} style={{ padding: '4px 8px', fontSize: 10, borderRadius: 6, border: '1px solid #e8e4df', background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Edit</button>
                  {m.percentageUsed > 100 && <button onClick={() => handleSendNudge(m.id)} style={{ padding: '4px 8px', fontSize: 10, borderRadius: 6, border: '1px solid #c0392b33', background: '#c0392b08', color: '#c0392b', cursor: 'pointer', fontFamily: 'inherit' }}>Nudge</button>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Shared goals */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, color: '#a8a29e' }}>Shared Family Goals</div>
            <button onClick={() => setSharedGoalOpen(true)} style={btnPrimary()}>+ Add Shared Goal</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
            {sharedGoals.map((g) => (
              <AdminSharedGoalCard key={g.id} goal={g} />
            ))}
            {sharedGoals.length === 0 && (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#a8a29e', padding: 30, border: '1px dashed #e8e4df', borderRadius: 16 }}>
                No shared goals yet.
              </div>
            )}
          </div>
        </div>

        {/* Notifications */}
        {notifications.length > 0 && (
          <div style={{ background: '#fff', border: '1px solid #e8e4df', borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, color: '#a8a29e', marginBottom: 14 }}>Recent Notifications</div>
            {notifications.slice(0, 5).map((n) => (
              <div key={n.id} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: '1px solid #f2f0ed' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: n.type === 'nudge' ? '#b45309' : n.type === 'budget_warning' ? '#c0392b' : '#3d6b52', marginTop: 5, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#1c1917' }}>{n.title}</div>
                  <div style={{ fontSize: 11, color: '#a8a29e' }}>{n.body}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit Limit Modal */}
      <Modal open={!!editLimitOpen} onClose={() => setEditLimitOpen(null)} title="Edit budget limit" subtitle={`Adjust monthly spending limit for ${profiles.find((p) => p.id === editLimitOpen)?.name || ''}`}>
        <FormField label="New monthly limit ($)"><input style={inputStyle} type="number" value={newLimit} onChange={(e) => setNewLimit(e.target.value)} /></FormField>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
          <button style={btnSecondary} onClick={() => setEditLimitOpen(null)}>Cancel</button>
          <button style={btnPrimary()} onClick={() => handleSetLimit(editLimitOpen)}>Save</button>
        </div>
      </Modal>

      {/* Shared Goal Modal */}
      <Modal open={sharedGoalOpen} onClose={() => setSharedGoalOpen(false)} title="New shared goal" subtitle="Visible to all family members.">
        <FormField label="Goal name"><input style={inputStyle} value={sgName} onChange={(e) => setSgName(e.target.value)} placeholder="e.g. New family car" /></FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Target ($)"><input style={inputStyle} type="number" value={sgTarget} onChange={(e) => setSgTarget(e.target.value)} placeholder="15000" /></FormField>
          <FormField label="Target date"><input style={inputStyle} type="date" value={sgDate} onChange={(e) => setSgDate(e.target.value)} /></FormField>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
          <button style={btnSecondary} onClick={() => setSharedGoalOpen(false)}>Cancel</button>
          <button style={btnPrimary()} onClick={handleCreateSharedGoal}>Create goal</button>
        </div>
      </Modal>
    </div>
  );
}
