// Screen 2: PIN entry. Hits POST /api/auth/login.
// On success, the parent's onSignedIn callback fires with { token, member, family }.

import { useState } from 'react';
import { login } from '../api/auth.js';
import { roleConfig } from '../domain/roles.js';

export default function PINScreen({ pinTarget, onSignedIn, onBack, onShowToast }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);

  const rc = roleConfig(pinTarget?.role);

  const handleKey = async (n) => {
    if (busy || pin.length >= 4) return;
    const next = pin + n;
    setPin(next);

    if (next.length !== 4) return;

    setBusy(true);
    try {
      const result = await login(pinTarget.id, next);
      // Brief pause so the user sees all four dots filled before transitioning
      setTimeout(() => onSignedIn(result), 200);
    } catch (err) {
      setShake(true);
      // Backend returns helpful messages: "Incorrect PIN. N attempt(s) remaining."
      // or 423 Locked with "Account locked due to too many failed attempts"
      setError(err.message || 'Login failed');
      if (err.status === 423) onShowToast('Account locked. Try again later.');
      setTimeout(() => { setPin(''); setShake(false); setBusy(false); }, 500);
    }
  };

  const backspace = () => {
    if (busy) return;
    setPin((p) => p.slice(0, -1));
    setError('');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f7f5f2', position: 'relative' }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(#e8e4df 1px,transparent 1px),linear-gradient(90deg,#e8e4df 1px,transparent 1px)', backgroundSize: '48px 48px', opacity: .35, pointerEvents: 'none' }} />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: 80, height: 80, borderRadius: '50%', border: `1.5px solid ${rc.mid}`, background: rc.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, boxShadow: '0 4px 16px rgba(28,25,23,.07)', marginBottom: 18 }}>{rc.icon}</div>
        <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 34, fontWeight: 300, color: rc.color, marginBottom: 4 }}>{pinTarget?.name}</div>
        <div style={{ fontSize: 12, color: '#a8a29e', marginBottom: 36 }}>Enter your 4-digit PIN</div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 36, animation: shake ? 'shake .4s ease' : 'none' }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ width: 10, height: 10, borderRadius: '50%', border: `1.5px solid ${i < pin.length ? rc.color : '#d8d3cc'}`, background: i < pin.length ? rc.color : 'transparent', transition: 'all .2s' }} />
          ))}
        </div>

        {error && <div style={{ fontSize: 12, color: '#c0392b', marginBottom: 16, animation: 'fadeIn .2s ease', maxWidth: 280, textAlign: 'center' }}>{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,72px)', gap: 10 }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, '⌫'].map((k, i) => (
            <button key={i}
              onClick={() => k === '⌫' ? backspace() : k !== null ? handleKey(String(k)) : null}
              disabled={busy && k !== '⌫'}
              style={{ height: 56, borderRadius: 10, border: k !== null ? '1px solid #e8e4df' : 'none', background: k !== null ? '#fff' : 'transparent', fontFamily: "'DM Mono',monospace", fontSize: k === '⌫' ? 16 : 18, color: '#1c1917', cursor: k !== null ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s', opacity: busy && k !== '⌫' ? .5 : 1 }}
              onMouseDown={(e) => { if (k !== null) e.currentTarget.style.background = '#f2f0ed'; }}
              onMouseUp={(e) => { if (k !== null) e.currentTarget.style.background = '#fff'; }}>
              {k !== null ? k : ''}
            </button>
          ))}
        </div>

        <button onClick={onBack} style={{ marginTop: 28, background: 'none', border: '1px solid #d8d3cc', borderRadius: 100, padding: '10px 26px', fontSize: 12, fontWeight: 600, letterSpacing: .5, textTransform: 'uppercase', color: '#a8a29e', cursor: 'pointer', fontFamily: 'inherit' }}>← Back</button>
      </div>
    </div>
  );
}
