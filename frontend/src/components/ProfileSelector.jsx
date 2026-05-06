// Screen 1: Profile selector ("Who's planning today?")
// Source data: GET /api/dashboard/family — gives us each member with computed spend
// Action: clicking a profile triggers either admin-login (no PIN) or PIN entry

import { useState, useEffect } from 'react';
import { adminLogin } from '../api/auth.js';
import { createProfile } from '../api/profiles.js';
import { apiGet } from '../api/client.js';
import { roleConfig } from '../domain/roles.js';
import { Modal, FormField, inputStyle, selectStyle, btnPrimary, btnSecondary } from './shared.jsx';

/** Fetch the unauthenticated profile list for the selector screen. */
const fetchPublicSummary = () => apiGet('/api/public/family-summary', { anonymous: true });

export default function ProfileSelector({ onSignedIn, onChoosePIN, onShowToast, onResetClick }) {
  const [members, setMembers] = useState([]);     // array from dashboard.members
  const [family, setFamily]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const summary = await fetchPublicSummary();
      setFamily(summary.family);
      setMembers(summary.members);
    } catch (err) {
      setError(err.message || 'Could not load profiles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  /* Add-member modal */
  const [addOpen, setAddOpen]   = useState(false);
  const [invName, setInvName]   = useState('');
  const [invEmail, setInvEmail] = useState('');
  const [invRole, setInvRole]   = useState('member');
  const [invLimit, setInvLimit] = useState('');
  const [invPin, setInvPin]     = useState('');
  const [invErr, setInvErr]     = useState(null);

  const handleInvite = async () => {
    setInvErr(null);
    if (!invName.trim()) { setInvErr('Name is required'); return; }
    if (!/^\d{4}$/.test(invPin)) { setInvErr('Initial PIN must be 4 digits'); return; }
    try {
      await createProfile({
        name: invName.trim(),
        email: invEmail || null,
        role: invRole,
        monthlyLimit: parseFloat(invLimit) || 0,
        monthlyIncome: 0,
        pin: invPin,
      });
      setAddOpen(false);
      setInvName(''); setInvEmail(''); setInvRole('member'); setInvLimit(''); setInvPin('');
      onShowToast('Member added!');
      load();
    } catch (err) {
      // Likely 401 (need to be admin) or 409 (max members reached)
      if (err.status === 401) setInvErr('You must be signed in as admin to add members.');
      else setInvErr(err.message || 'Could not create member');
    }
  };

  const handleClick = async (m) => {
    if (m.role === 'admin') {
      // Admin PIN bypass per spec §2.1
      try {
        const r = await adminLogin(m.id);
        onSignedIn(r);
      } catch (err) {
        onShowToast(err.message || 'Login failed');
      }
    } else {
      onChoosePIN(m);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f7f5f2', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(#e8e4df 1px,transparent 1px),linear-gradient(90deg,#e8e4df 1px,transparent 1px)', backgroundSize: '48px 48px', opacity: .35, pointerEvents: 'none' }} />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', maxWidth: 880 }}>
        <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 13, fontWeight: 400, letterSpacing: 4, textTransform: 'uppercase', color: '#a8a29e', marginBottom: 10 }}>BudgetWise</div>
        <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 48, fontWeight: 300, color: '#1c1917', lineHeight: 1, marginBottom: 6 }}>Who's <em style={{ fontStyle: 'italic', color: '#3d6b52' }}>planning</em> today?</div>
        <div style={{ fontSize: 13, color: '#a8a29e', marginBottom: 56 }}>{family?.name || 'Loading…'} {family?.name && '· Family Pro Plan'}</div>

        {loading && <div style={{ color: '#a8a29e', fontSize: 14 }}>Loading profiles…</div>}
        {error && <div style={{ color: '#c0392b', fontSize: 14, marginBottom: 20 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 20, marginBottom: 40, flexWrap: 'wrap', justifyContent: 'center' }}>
          {members.map((m) => {
            const rc = roleConfig(m.role);
            const spent = m.spent ?? 0;
            return (
              <div key={m.id} onClick={() => handleClick(m)}
                style={{ width: 152, background: '#fff', border: '1px solid #e8e4df', borderRadius: 20, padding: '24px 18px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, cursor: 'pointer', boxShadow: '0 1px 3px rgba(28,25,23,.06)', transition: 'all .25s cubic-bezier(.34,1.56,.64,1)' }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-6px)'; e.currentTarget.style.boxShadow = '0 16px 48px rgba(28,25,23,.1)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 1px 3px rgba(28,25,23,.06)'; }}>
                <div style={{ width: 72, height: 72, borderRadius: '50%', border: `1.5px solid ${rc.mid}`, background: rc.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>{rc.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1c1917' }}>{m.name}</div>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1.2, padding: '3px 10px', borderRadius: 100, background: rc.bg, color: rc.color }}>{rc.label}</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: '#a8a29e', marginTop: 'auto', paddingTop: 10, borderTop: '1px solid #e8e4df', width: '100%', textAlign: 'center' }}>${Number(spent).toLocaleString()} spent</div>
              </div>
            );
          })}
          {!loading && (
            <div onClick={() => setAddOpen(true)} style={{ width: 152, border: '1.5px dashed #d8d3cc', borderRadius: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer', opacity: .55, transition: 'opacity .2s', padding: '24px 0' }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = 1)} onMouseLeave={(e) => (e.currentTarget.style.opacity = .55)}>
              <div style={{ fontSize: 28 }}>+</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#a8a29e' }}>Add Member</div>
            </div>
          )}
        </div>

        <button onClick={onResetClick} style={{ background: 'none', border: '1px solid #d8d3cc', borderRadius: 100, padding: '10px 26px', fontSize: 12, fontWeight: 600, letterSpacing: .5, textTransform: 'uppercase', color: '#a8a29e', cursor: 'pointer', fontFamily: 'inherit', position: 'relative', zIndex: 1, marginTop: 8, transition: 'all .2s' }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#c0392b'; e.currentTarget.style.color = '#c0392b'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#d8d3cc'; e.currentTarget.style.color = '#a8a29e'; }}>
          Reset Demo Data
        </button>
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add family member" subtitle="They'll get their own profile. You'll need to be signed in as admin.">
        {invErr && <div style={{ background: 'rgba(192,57,43,.06)', color: '#c0392b', padding: '8px 12px', borderRadius: 8, fontSize: 12, marginBottom: 12 }}>{invErr}</div>}
        <FormField label="Name"><input style={inputStyle} value={invName} onChange={(e) => setInvName(e.target.value)} placeholder="e.g. Grandma Rose" /></FormField>
        <FormField label="Email"><input style={inputStyle} value={invEmail} onChange={(e) => setInvEmail(e.target.value)} placeholder="email@example.com" /></FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Role">
            <select style={selectStyle} value={invRole} onChange={(e) => setInvRole(e.target.value)}>
              <option value="member">Member</option>
              <option value="teen">Teen (13–17)</option>
              <option value="junior">Junior (under 13)</option>
              <option value="admin">Admin</option>
            </select>
          </FormField>
          <FormField label="Monthly Budget ($)"><input style={inputStyle} type="number" value={invLimit} onChange={(e) => setInvLimit(e.target.value)} placeholder="500" /></FormField>
        </div>
        <FormField label="Initial 4-digit PIN"><input style={inputStyle} type="text" inputMode="numeric" maxLength={4} value={invPin} onChange={(e) => setInvPin(e.target.value.replace(/\D/g, ''))} placeholder="1234" /></FormField>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
          <button style={btnSecondary} onClick={() => setAddOpen(false)}>Cancel</button>
          <button style={btnPrimary()} onClick={handleInvite}>Add member</button>
        </div>
      </Modal>
    </div>
  );
}
