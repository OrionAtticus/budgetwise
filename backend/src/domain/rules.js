// Domain Layer (Architecture spec §5)
// Pure functions and config — no DB, no HTTP. Imported by service modules.

export const ROLE_CONFIG = {
  admin:  { label: 'Admin',  allowedCategories: null },
  member: { label: 'Member', allowedCategories: null },
  teen: {
    label: 'Teen',
    allowedCategories: ['Fast Food', 'Gaming & Apps', 'Clothing', 'Transport', 'School Supplies', 'Music', 'Allowance', 'Gifts / Grants'],
  },
  junior: {
    label: 'Junior',
    allowedCategories: ['Treats & Snacks', 'Toys & Games', 'Books', 'Art Supplies', 'Allowance', 'Gifts / Grants'],
  },
};

export const PLAN_LIMITS = {
  free:        1,
  starter:     2,
  family_pro:  6,
  enterprise: 50,
};

export function validateTransaction(tx, memberRole) {
  if (memberRole === 'junior') {
    return { valid: false, error: 'Junior members cannot log transactions' };
  }
  if (typeof tx.amount !== 'number' || tx.amount <= 0) {
    return { valid: false, error: 'Amount must be a positive number' };
  }
  if (!tx.description || !String(tx.description).trim()) {
    return { valid: false, error: 'Description is required' };
  }
  if (!tx.category) {
    return { valid: false, error: 'Category is required' };
  }
  if (!['expense', 'income'].includes(tx.type)) {
    return { valid: false, error: "Type must be 'expense' or 'income'" };
  }
  const allowed = ROLE_CONFIG[memberRole]?.allowedCategories;
  if (allowed && !allowed.includes(tx.category)) {
    return { valid: false, error: `Category "${tx.category}" not allowed for ${ROLE_CONFIG[memberRole].label} role` };
  }
  return { valid: true };
}

export function computeCategoryStatus(spent, limit) {
  const pct = limit > 0 ? (spent / limit) * 100 : 0;
  if (pct > 100) return { status: 'over',    label: 'Over' };
  if (pct >  85) return { status: 'warning', label: 'Warning' };
  return            { status: 'ok',      label: 'OK' };
}

export function computeSavingsRate(income, spent) {
  if (income <= 0) return 0;
  return Math.round(((income - spent) / income) * 100);
}

export function computeGoalProgress(current, target) {
  if (target <= 0) return 0;
  return Math.min(Math.round((current / target) * 100), 100);
}

export function getCurrentPeriod(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function getPeriodStartDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}