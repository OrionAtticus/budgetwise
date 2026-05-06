// End-to-end test for the smart insights + shared-goal contributors features.
// Run from repo root: node test-insights-contributors.mjs
// (Requires the API running on :3000 with a fresh seed.)

const BASE = 'http://localhost:3000';
let token = null;

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token && !opts.anonymous) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET', headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const err = new Error(body?.error || res.statusText);
    err.status = res.status; err.body = body;
    throw err;
  }
  return body;
}

let pass = 0, fail = 0;
const log = (ok, name, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else    { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

(async () => {
  console.log('Smart insights + shared-goal contributors test\n');

  /* ── Setup: get IDs and tokens ─────────────────────────────── */
  const summary = await api('/api/public/family-summary', { anonymous: true });
  const mom = summary.members.find((m) => m.role === 'admin');
  const dad = summary.members.find((m) => m.role === 'member');
  const teen = summary.members.find((m) => m.role === 'teen');

  const dadAuth = await api('/api/auth/login', {
    method: 'POST', body: { memberId: dad.id, pin: '1234' }, anonymous: true,
  });
  const dadToken = dadAuth.token;

  const momAuth = await api('/api/auth/admin-login', {
    method: 'POST', body: { memberId: mom.id }, anonymous: true,
  });
  const momToken = momAuth.token;

  /* ── Section 1: Smart insights ─────────────────────────────── */
  console.log('Smart Insights:');

  token = dadToken;
  const dash = await api('/api/dashboard/me');
  log(typeof dash.insight === 'string' && dash.insight.length > 0,
      `Dashboard payload includes insight string`,
      `got: ${typeof dash.insight}`);
  log(/[💡⚠⭐]/.test(dash.insight) || dash.insight.includes('Keep tracking'),
      `Insight has emoji or is the empty-state fallback`,
      `got: "${dash.insight}"`);

  // Dollar amounts in the insight should always be properly formatted
  // (no float-precision artifacts like "12.499999999999998")
  const moneyInInsight = dash.insight.match(/\$([\d,]+\.\d+|\d+)/g) || [];
  const allTwoDp = moneyInInsight.every((m) => /^\$[\d,]+\.\d{2}$/.test(m) || /^\$\d+$/.test(m));
  log(allTwoDp, `Insight money is formatted with 2 decimals (no float artifacts)`,
      `got: ${JSON.stringify(moneyInInsight)}`);

  // Categories should NOT be re-sorted by spend (they should remain in
  // alphabetical/listing order from listCategories)
  const catNames = dash.categories.map((c) => c.name);
  const sortedAlpha = [...catNames].sort();
  log(JSON.stringify(catNames) === JSON.stringify(sortedAlpha),
      `Categories preserved in original order (insight sort doesn't mutate)`,
      `got: ${JSON.stringify(catNames)}`);

  /* ── Section 2: Shared goal contributors ────────────────────── */
  console.log('\nShared Goal Contributors:');

  // Mom creates a shared goal
  token = momToken;
  const goal = await api('/api/goals', {
    method: 'POST',
    body: { name: 'Test Shared Goal', targetAmount: 1000, isShared: true },
  });
  log(goal.isShared === true && goal.id, 'Mom creates shared goal');

  // Initially no contributors
  const initial = await api(`/api/goals/${goal.id}/contributors`);
  log(Array.isArray(initial) && initial.length === 0,
      'New shared goal has empty contributor list');

  // Mom contributes $200
  await api(`/api/goals/${goal.id}/contribute`, {
    method: 'POST', body: { amount: 200 },
  });

  // Dad contributes $150
  token = dadToken;
  await api(`/api/goals/${goal.id}/contribute`, {
    method: 'POST', body: { amount: 150 },
  });

  // Mom contributes another $50 (testing the upsert/increment)
  token = momToken;
  await api(`/api/goals/${goal.id}/contribute`, {
    method: 'POST', body: { amount: 50 },
  });

  // Check the ledger
  const contribs = await api(`/api/goals/${goal.id}/contributors`);
  log(contribs.length === 2, `Contributor ledger has 2 distinct members — got ${contribs.length}`);

  const momContrib = contribs.find((c) => c.memberId === mom.id);
  log(momContrib && Math.abs(momContrib.totalContributed - 250) < 0.001,
      `Mom's total = $250 (200 + 50 via upsert) — got $${momContrib?.totalContributed}`);

  const dadContrib = contribs.find((c) => c.memberId === dad.id);
  log(dadContrib && Math.abs(dadContrib.totalContributed - 150) < 0.001,
      `Dad's total = $150 — got $${dadContrib?.totalContributed}`);

  // Ledger should be sorted by total contributed (descending)
  log(contribs[0].totalContributed >= contribs[1].totalContributed,
      `Ledger is sorted by contribution descending`);

  // Goal's current_amount should be sum of contributions
  const refreshed = (await api('/api/goals/family')).find((g) => g.id === goal.id);
  log(Math.abs(refreshed.currentAmount - 400) < 0.001,
      `Goal current_amount = $400 (250 + 150) — got $${refreshed?.currentAmount}`);

  // Last contribution timestamp present
  log(momContrib.lastContribution && !isNaN(new Date(momContrib.lastContribution)),
      `Last contribution timestamp recorded`);

  /* ── Section 3: Authorization ──────────────────────────────── */
  console.log('\nAuthorization:');

  // Personal goals don't have contributor ledgers (return [])
  token = dadToken;
  const personalGoal = await api('/api/goals', {
    method: 'POST',
    body: { name: 'Dad personal', targetAmount: 500, isShared: false },
  });
  await api(`/api/goals/${personalGoal.id}/contribute`, {
    method: 'POST', body: { amount: 100 },
  });
  const personalContribs = await api(`/api/goals/${personalGoal.id}/contributors`);
  log(personalContribs.length === 0,
      `Personal goals return empty contributor list (no ledger created)`);

  // Verify the personal goal didn't accidentally write to shared_goal_contributors
  // by checking that its goal-level current_amount still reflects the contribution
  const personalRefreshed = (await api('/api/goals')).find((g) => g.id === personalGoal.id);
  log(personalRefreshed && Math.abs(personalRefreshed.currentAmount - 100) < 0.001,
      `Personal goal current_amount still updates correctly`);

  /* ── Report ────────────────────────────────────────────────── */
  console.log();
  if (fail === 0) {
    console.log(`✓ ALL ${pass} TESTS PASSED`);
    process.exit(0);
  } else {
    console.log(`✗ ${fail} failed, ${pass} passed`);
    process.exit(1);
  }
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
