// App root.
//
// Drives the simple state-machine routing that the original prototype used:
//   loading → selector → (admin: dashboard) | (member/teen/junior: pin → dashboard)
//   dashboard ⇄ admin (admin only)
//   * if profile.onboardingComplete is false → onboarding instead of dashboard
//
// Holds session state (token, member, family) for the rest of the tree.
// Persists session via sessionStorage in api/client.js so a page refresh
// keeps the user signed in until tab close.

import { useState, useEffect } from 'react';
import { fetchMe, logout } from './api/auth.js';
import { getToken } from './api/client.js';

import ProfileSelector  from './components/ProfileSelector.jsx';
import PINScreen        from './components/PINScreen.jsx';
import OnboardingScreen from './components/OnboardingScreen.jsx';
import DashboardScreen  from './components/DashboardScreen.jsx';
import AdminPanel       from './components/AdminPanel.jsx';
import { Toast }        from './components/shared.jsx';

export default function App() {
  // Routing screens: 'loading' | 'selector' | 'pin' | 'onboarding' | 'dashboard' | 'admin'
  const [screen, setScreen]       = useState('loading');
  const [session, setSession]     = useState(null);     // { token, member, family }
  const [pinTarget, setPinTarget] = useState(null);     // member object from selector
  const [toast, setToast]         = useState(null);

  /* ── Boot: try to resume an existing session ─────────────────── */
  useEffect(() => {
    (async () => {
      const token = getToken();
      if (!token) {
        setScreen('selector');
        return;
      }
      try {
        const me = await fetchMe();
        const sess = { token, member: me.member, family: me.family };
        setSession(sess);
        if (!me.member.onboardingComplete) setScreen('onboarding');
        else setScreen('dashboard');
      } catch {
        // Stale token — drop it and show the selector
        await logout();
        setScreen('selector');
      }
    })();
  }, []);

  /* ── Toast helper ─────────────────────────────────────────────── */
  const showToast = (msg) => setToast(msg);

  /* ── Navigation handlers ──────────────────────────────────────── */
  const handleSignedIn = (auth) => {
    // auth = { token, expiresAt, member, family }
    setSession(auth);
    if (!auth.member.onboardingComplete) setScreen('onboarding');
    else setScreen('dashboard');
  };

  const handleChoosePIN = (member) => {
    setPinTarget(member);
    setScreen('pin');
  };

  const handleSwitchProfile = async () => {
    await logout();
    window.location.reload(); // This forces a hard browser refresh!
  };

  const handleResetClick = async () => {
    // Visible warning, then call a backend reset endpoint... which doesn't
    // exist as a public route (and shouldn't — that'd be dangerous). For
    // class-demo simplicity, instruct the user to re-seed via npm.
    if (window.confirm('To reset demo data, run `npm run reset-and-seed` in the backend folder, then refresh this page.')) {
      window.location.reload();
    }
  };

  const handleOnboardingComplete = async () => {
    // Re-fetch /me so the session reflects the freshly-updated profile
    try {
      const me = await fetchMe();
      setSession({ ...session, member: me.member, family: me.family });
      setScreen('dashboard');
    } catch (err) {
      showToast(err.message || 'Could not reload profile');
    }
  };

  /* ── Render ───────────────────────────────────────────────────── */
  if (screen === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f7f5f2', fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 24, color: '#a8a29e' }}>
        Loading BudgetWise…
      </div>
    );
  }

  return (
    <>
      {/* Global styles — Cormorant for display, DM Mono for numbers, Outfit for body */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=DM+Mono:wght@400;500&family=Outfit:wght@300;400;500;600;700&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body, #root { color-scheme: light; background: #f7f5f2; color: #1c1917; min-height: 100vh; }
        body { font-family: 'Outfit', sans-serif; }
        input, select, textarea, button { color: #1c1917; font-family: inherit; }
        input::placeholder { color: #a8a29e; }
        a { color: inherit; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fadeUp { from { opacity: 0; transform: translateX(-50%) translateY(10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
        @keyframes shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-8px); } 75% { transform: translateX(8px); } }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-thumb { background: #d8d3cc; border-radius: 3px; }
      `}</style>

      {screen === 'selector' && (
        <ProfileSelector
          onSignedIn={handleSignedIn}
          onChoosePIN={handleChoosePIN}
          onShowToast={showToast}
          onResetClick={handleResetClick}
        />
      )}

      {screen === 'pin' && (
        <PINScreen
          pinTarget={pinTarget}
          onSignedIn={handleSignedIn}
          onBack={() => { setPinTarget(null); setScreen('selector'); }}
          onShowToast={showToast}
        />
      )}

      {screen === 'onboarding' && session && (
        <OnboardingScreen
          currentUser={session.member}
          onComplete={handleOnboardingComplete}
          onShowToast={showToast}
        />
      )}

      {screen === 'dashboard' && session && (
        <DashboardScreen
          session={session}
          onSwitchProfile={handleSwitchProfile}
          onGoToAdmin={() => setScreen('admin')}
          onShowToast={showToast}
        />
      )}

      {screen === 'admin' && session && (
        <AdminPanel
          session={session}
          onBackToDashboard={() => setScreen('dashboard')}
          onShowToast={showToast}
        />
      )}

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </>
  );
}
