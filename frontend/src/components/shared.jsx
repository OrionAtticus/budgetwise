// Shared UI primitives. Pure presentational — no state of their own beyond
// what's passed via props.

import { useEffect } from 'react';

/* ── Toast ─────────────────────────────────────────────────────────── */

export function Toast({ message, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div style={{
      position: 'fixed', bottom: 30, left: '50%', transform: 'translateX(-50%)',
      background: '#1c1917', color: '#fff', padding: '12px 24px', borderRadius: 100,
      fontSize: 13, fontWeight: 500, boxShadow: '0 8px 24px rgba(28,25,23,.2)',
      animation: 'fadeUp .25s ease', zIndex: 9999,
    }}>
      {message}
    </div>
  );
}

/* ── Modal ─────────────────────────────────────────────────────────── */

export function Modal({ open, onClose, title, subtitle, children }) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(28,25,23,.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, animation: 'fadeIn .2s ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 16, padding: 28, width: 440, maxWidth: '90vw',
          maxHeight: '90vh', overflow: 'auto',
          boxShadow: '0 24px 64px rgba(28,25,23,.2)',
        }}
      >
        <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 24, fontWeight: 400, color: '#1c1917', marginBottom: 4 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: '#a8a29e', marginBottom: 20 }}>{subtitle}</div>}
        {children}
      </div>
    </div>
  );
}

/* ── FormField ─────────────────────────────────────────────────────── */

export function FormField({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: '#57534e', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

/* ── Style objects ─────────────────────────────────────────────────── */

export const inputStyle = {
  width: '100%', padding: '10px 14px', border: '1px solid #e8e4df',
  borderRadius: 10, fontSize: 14, fontFamily: 'inherit', outline: 'none',
  background: '#f7f5f2', boxSizing: 'border-box', color: '#1c1917',
};

export const selectStyle = { ...inputStyle, appearance: 'none' };

export const btnPrimary = (color) => ({
  padding: '10px 24px', background: color || '#3d6b52', color: '#fff',
  border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
});

export const btnSecondary = {
  padding: '10px 24px', background: 'none', border: '1px solid #e8e4df',
  borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: 'pointer',
  color: '#57534e', fontFamily: 'inherit',
};
