// Screen 5: Onboarding (first-time profile setup, FR-04).
// Shown when the logged-in user's onboardingComplete is false.

import { useState } from 'react';
import { updateProfile } from '../api/profiles.js';
import { FormField, inputStyle, selectStyle, btnPrimary } from './shared.jsx';

export default function OnboardingScreen({ currentUser, onComplete, onShowToast }) {
  const [name, setName]               = useState(currentUser?.name || '');
  const [email, setEmail]             = useState(currentUser?.email || '');
  const [incomeType, setIncomeType]   = useState('salaried');
  const [income, setIncome]           = useState('');
  const [goal, setGoal]               = useState('');
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState(null);

  const handleComplete = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    setBusy(true); setError(null);
    try {
      const monthlyIncome = parseFloat(income) || 0;
      await updateProfile(currentUser.id, {
        name: name.trim(),
        email: email || null,
        incomeType,
        monthlyIncome,
        // First-time setup: default the spending limit to income
        monthlyLimit: monthlyIncome,
        primaryGoal: goal || null,
        onboardingComplete: true,
      });
      onShowToast('Welcome to BudgetWise!');
      onComplete();
    } catch (err) {
      setError(err.message || 'Could not save profile');
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f7f5f2' }}>
      <div style={{ background: '#fff', borderRadius: 24, padding: '48px 40px', width: 440, boxShadow: '0 16px 48px rgba(28,25,23,.1)' }}>
        <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 13, letterSpacing: 4, textTransform: 'uppercase', color: '#a8a29e', marginBottom: 8 }}>BudgetWise</div>
        <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 28, fontWeight: 400, color: '#1c1917', marginBottom: 4 }}>Welcome aboard</div>
        <div style={{ fontSize: 13, color: '#a8a29e', marginBottom: 32 }}>Let's set up your personal budget profile.</div>

        {error && <div style={{ background: 'rgba(192,57,43,.06)', color: '#c0392b', padding: '8px 12px', borderRadius: 8, fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <FormField label="Full name"><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" /></FormField>
        <FormField label="Email address"><input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" /></FormField>
        <FormField label="Income type">
          <select style={selectStyle} value={incomeType} onChange={(e) => setIncomeType(e.target.value)}>
            <option value="salaried">Salaried</option>
            <option value="freelancer">Freelancer</option>
            <option value="student">Student</option>
            <option value="other">Other</option>
          </select>
        </FormField>
        <FormField label="Monthly take-home income ($)"><input style={inputStyle} type="number" value={income} onChange={(e) => setIncome(e.target.value)} placeholder="5000" /></FormField>
        <FormField label="Primary financial goal"><input style={inputStyle} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. Save for a house down payment" /></FormField>

        <button onClick={handleComplete} disabled={busy} style={{ ...btnPrimary(), width: '100%', padding: '12px', marginTop: 8, opacity: busy ? .5 : 1 }}>
          {busy ? 'Saving…' : 'Get started →'}
        </button>
      </div>
    </div>
  );
}
