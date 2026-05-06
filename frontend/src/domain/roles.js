// Role config for UI styling only. Business rules (allowed categories,
// junior-can't-log-tx, etc.) live in the backend's domain layer and
// surface through API error messages.

export const ROLE_CONFIG = {
  admin:  { label: 'Admin',  color: '#3d6b52', bg: '#eef5f1', mid: '#c2dace', icon: '👑' },
  member: { label: 'Member', color: '#3b5fa0', bg: '#eef1fa', mid: '#bfcef0', icon: '👤' },
  teen:   { label: 'Teen',   color: '#8b5e3c', bg: '#f5ede5', mid: '#ddc4ae', icon: '🎧' },
  junior: { label: 'Junior', color: '#7c3d6e', bg: '#f5eef3', mid: '#d9b9d2', icon: '⭐' },
};

export const roleConfig = (role) => ROLE_CONFIG[role] || ROLE_CONFIG.member;

/** Pure helpers — duplicated from backend for client-side convenience. */
export const computeGoalProgress = (current, target) =>
  target > 0 ? Math.min(Math.round((current / target) * 100), 100) : 0;

export const computeCategoryStatus = (spent, limit) => {
  const pct = limit > 0 ? (spent / limit) * 100 : 0;
  if (pct > 100) return { status: 'over',    color: '#c0392b', label: 'Over' };
  if (pct >  85) return { status: 'warning', color: '#b45309', label: 'Warning' };
  return            { status: 'ok',      color: '#3d6b52', label: 'OK' };
};
