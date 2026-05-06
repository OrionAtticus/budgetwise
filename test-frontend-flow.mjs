// Integration test: simulates the full end-to-end flow that the React app
// will perform, using the same API client modules. If this passes, the
// frontend wiring matches the backend contract.
//
// Run with: node test-frontend-flow.mjs
// Requires the backend running on :3000 and seeded.

const BASE = 'http://localhost:3000';
let token = null;

const fetch_ = global.fetch;

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token && !opts.anonymous) headers.Authorization = `Bearer ${token}`;
  const res = await fetch_(BASE + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const err = new Error(body?.error || res.statusText);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

let pass = 0, fail = 0;
const results = [];
async function step(name, fn) {
  try {
    await fn();
    pass++;
    results.push(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    results.push(`  ✗ ${name}: ${e.message}${e.body ? ' — ' + JSON.stringify(e.body) : ''}`);
  }
}

(async () => {
  console.log('Frontend-flow integration test\n');

  /* ── Profile selector phase (no auth yet) ───────────────────── */
  let summary;
  await step('GET /api/public/family-summary (no token)', async () => {
    summary = await api('/api/public/family-summary', { anonymous: true });
    if (!summary.family) throw new Error('no family in response');
    if (!summary.members?.length) throw new Error('no members');
  });

  const mom = summary.members.find((m) => m.role === 'admin');
  const dad = summary.members.find((m) => m.role === 'member');
  const teen = summary.members.find((m) => m.role === 'teen');
  const kid = summary.members.find((m) => m.role === 'junior');

  /* ── Sign in as Dad with PIN ────────────────────────────────── */
  await step('Dad PIN login (correct PIN)', async () => {
    const r = await api('/api/auth/login', { method: 'POST', body: { memberId: dad.id, pin: '1234' }, anonymous: true });
    if (!r.token) throw new Error('no token');
    if (r.member.id !== dad.id) throw new Error('wrong member returned');
    token = r.token;
  });

  await step('GET /api/auth/me with token', async () => {
    const me = await api('/api/auth/me');
    if (me.member.id !== dad.id) throw new Error('me does not match');
    if (!me.family.planTier) throw new Error('no plan tier in family');
  });

  /* ── Dashboard tab ─────────────────────────────────────────── */
  let dashboard;
  await step('GET /api/dashboard/me populates all required fields', async () => {
    dashboard = await api('/api/dashboard/me');
    const required = ['period', 'profile', 'totals', 'categories', 'recentTransactions', 'goals'];
    for (const k of required) {
      if (!(k in dashboard)) throw new Error(`missing field: ${k}`);
    }
    if (!('income' in dashboard.totals)) throw new Error('totals.income missing');
    if (!('savingsRate' in dashboard.totals)) throw new Error('totals.savingsRate missing');
    if (!('overBudget' in dashboard.totals)) throw new Error('totals.overBudget missing');
  });

  /* ── Budget tab ─────────────────────────────────────────────── */
  await step('GET /api/budget/categories', async () => {
    const cats = await api('/api/budget/categories');
    if (!Array.isArray(cats)) throw new Error('not an array');
    if (cats.length === 0) throw new Error('Dad should have categories');
    const c = cats[0];
    for (const k of ['id', 'name', 'monthlyLimit', 'amountSpent']) {
      if (!(k in c)) throw new Error(`missing ${k}`);
    }
  });

  /* ── Goals tab ──────────────────────────────────────────────── */
  let dadGoal;
  await step('POST /api/goals creates personal goal', async () => {
    dadGoal = await api('/api/goals', {
      method: 'POST',
      body: { name: 'Test Goal from FE flow', targetAmount: 500, deadline: '2026-12-31', isShared: false },
    });
    if (!dadGoal.id) throw new Error('no id returned');
    if (dadGoal.isShared) throw new Error('should not be shared');
  });

  await step('POST /api/goals/:id/contribute', async () => {
    const updated = await api(`/api/goals/${dadGoal.id}/contribute`, { method: 'POST', body: { amount: 75 } });
    if (Number(updated.currentAmount) !== 75) throw new Error(`expected currentAmount 75, got ${updated.currentAmount}`);
  });

  await step('GET /api/goals returns the new goal in list', async () => {
    const list = await api('/api/goals');
    const found = list.find((g) => g.id === dadGoal.id);
    if (!found) throw new Error('goal not in list');
    if (found.progressPercent !== 15) throw new Error(`expected 15%, got ${found.progressPercent}%`);
  });

  /* ── Add transaction (with role validation) ──────────────────── */
  await step('POST /api/transactions adds expense and updates spend', async () => {
    const before = await api('/api/dashboard/me');
    const beforeSpent = before.totals.spent;

    const result = await api('/api/transactions', {
      method: 'POST',
      body: { description: 'FE-flow test', amount: 12.50, type: 'expense', category: 'Groceries', date: '2026-05-04' },
    });
    if (!result.transaction?.id) throw new Error('no transaction id');
    if (!result.category) throw new Error('category should be returned for expense');

    const after = await api('/api/dashboard/me');
    const delta = after.totals.spent - beforeSpent;
    if (Math.abs(delta - 12.50) > 0.01) {
      throw new Error(`spent delta wrong: expected 12.50, got ${delta}`);
    }
    if (after.cached) throw new Error('cache should have been invalidated');
  });

  /* ── Forbidden actions ──────────────────────────────────────── */
  await step('Dad cannot view Mom\'s transactions', async () => {
    try {
      await api(`/api/transactions?memberId=${mom.id}`);
      throw new Error('should have thrown');
    } catch (e) {
      if (e.status !== 403) throw new Error(`expected 403, got ${e.status}`);
    }
  });

  await step('Dad cannot create profile (admin only)', async () => {
    try {
      await api('/api/profiles', { method: 'POST', body: { name: 'X', role: 'member', pin: '0000' } });
      throw new Error('should have thrown');
    } catch (e) {
      if (e.status !== 403) throw new Error(`expected 403, got ${e.status}`);
    }
  });

  /* ── Switch to Mom (admin) ──────────────────────────────────── */
  token = null;
  await step('Admin PIN bypass for Mom', async () => {
    const r = await api('/api/auth/admin-login', { method: 'POST', body: { memberId: mom.id }, anonymous: true });
    if (!r.token) throw new Error('no token');
    token = r.token;
  });

  await step('Admin gets family dashboard with all members', async () => {
    const fam = await api('/api/dashboard/family');
    if (!Array.isArray(fam.members) || fam.members.length < 4) throw new Error('expected 4+ members');
    if (typeof fam.totalSpent !== 'number') throw new Error('totalSpent not a number');
  });

  await step('Admin can update Dad\'s monthly limit', async () => {
    const updated = await api(`/api/profiles/${dad.id}`, { method: 'PATCH', body: { monthlyLimit: 6000 } });
    if (Number(updated.monthlyLimit) !== 6000) throw new Error('limit not updated');
  });

  await step('Admin sends nudge to Jordan', async () => {
    const n = await api('/api/notifications', {
      method: 'POST',
      body: { recipientId: teen.id, type: 'nudge', title: 'Slow down', body: 'Over budget' },
    });
    if (!n.id) throw new Error('no notification id');
  });

  await step('Admin creates shared goal', async () => {
    const g = await api('/api/goals', {
      method: 'POST',
      body: { name: 'FE-flow shared', targetAmount: 1000, isShared: true },
    });
    if (!g.isShared) throw new Error('should be shared');
  });

  /* ── Junior cannot log transactions ─────────────────────────── */
  await step('Backend rejects transaction for Junior', async () => {
    try {
      await api('/api/transactions', {
        method: 'POST',
        body: { memberId: kid.id, description: 'forbidden', amount: 1, type: 'expense', category: 'Treats & Snacks', date: '2026-05-04' },
      });
      throw new Error('should have rejected');
    } catch (e) {
      if (e.status !== 400) throw new Error(`expected 400, got ${e.status}`);
      if (!/junior/i.test(e.body?.error || '')) throw new Error(`expected junior error, got "${e.body?.error}"`);
    }
  });

  await step('Logout invalidates token', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    try {
      await api('/api/auth/me');
      throw new Error('me should fail after logout');
    } catch (e) {
      if (e.status !== 401) throw new Error(`expected 401, got ${e.status}`);
    }
  });

  /* ── Report ─────────────────────────────────────────────────── */
  console.log(results.join('\n'));
  console.log();
  if (fail === 0) {
    console.log(`✓ ALL ${pass} INTEGRATION TESTS PASSED`);
    process.exit(0);
  } else {
    console.log(`✗ ${fail} failed, ${pass} passed`);
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
