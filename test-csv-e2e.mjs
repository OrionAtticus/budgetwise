// End-to-end CSV import test. Simulates the full path:
// raw CSV text → parseCSV → guessColumnMapping → bulk POST → DB verify.
//
// Run with: node test-csv-e2e.mjs (after `node src/index.js` from backend/)

import { parseCSV, parseDate, parseAmount, guessColumnMapping } from './frontend/src/lib/csv.js';

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
const log = (ok, name) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else    { fail++; console.log(`  ✗ ${name}`); }
};

(async () => {
  console.log('CSV import end-to-end test\n');

  // 1) Find Dad and log in
  const summary = await api('/api/public/family-summary', { anonymous: true });
  const dad = summary.members.find((m) => m.role === 'member');
  const r = await api('/api/auth/login', {
    method: 'POST', body: { memberId: dad.id, pin: '1234' }, anonymous: true,
  });
  token = r.token;
  log(true, 'Login as Dad');

  // 2) Build a realistic bank-style CSV
  const csv = [
    'Posting Date,Description,Amount,Type',
    '05/01/2026,Trader Joe\'s,84.50,Debit',
    '05/02/2026,"Big-box, mart",192.30,Debit',  // quoted comma
    '05/03/2026,Salary deposit,5800.00,Credit',
    '05/04/2026,Gas station,52.20,Debit',
  ].join('\n');

  // 3) Parse like the frontend would
  const rows = parseCSV(csv);
  log(rows.length === 5, `parseCSV returns 5 rows (1 header + 4 data) — got ${rows.length}`);

  const mapping = guessColumnMapping(rows[0]);
  log(mapping.date >= 0 && mapping.description >= 0 && mapping.amount >= 0 && mapping.type >= 0,
      `guessColumnMapping found all 4 columns: ${JSON.stringify(mapping)}`);

  // 4) Build the payload exactly like the modal does
  const dataRows = rows.slice(1);
  const payload = dataRows.map((cells, i) => {
    const date = parseDate(cells[mapping.date]);
    const description = cells[mapping.description];
    const { amount } = parseAmount(cells[mapping.amount]);
    const typeRaw = cells[mapping.type].toLowerCase();
    const type = typeRaw === 'credit' ? 'income' : 'expense';
    const category = type === 'income' ? 'Income' : 'Groceries'; // user-picked default
    return {
      date, description, amount, type, category,
      idempotencyKey: `csv-e2e:${i}:${date}:${amount}`,
    };
  });

  // 5) Submit via bulk endpoint
  const result = await api('/api/transactions/bulk', { method: 'POST', body: { rows: payload } });
  log(result.imported === 4, `4 rows imported — got ${result.imported}`);
  log(result.skipped === 0,  `0 rows skipped — got ${result.skipped}`);

  // 6) Re-import the same payload (idempotency)
  const result2 = await api('/api/transactions/bulk', { method: 'POST', body: { rows: payload } });
  log(result2.imported === 0, `re-import: 0 imported — got ${result2.imported}`);
  log(result2.skipped === 4,  `re-import: 4 skipped — got ${result2.skipped}`);

  // 7) Verify spend was tracked: Groceries went up by 84.50 + 192.30 + 52.20 = 329
  const cats = await api('/api/budget/categories');
  const groceries = cats.find((c) => c.name === 'Groceries');
  // Seed had Dad's Groceries at $478. After import: 478 + 329 = 807
  const expected = 478 + 84.50 + 192.30 + 52.20;
  const ok = Math.abs(groceries.amountSpent - expected) < 0.01;
  log(ok, `Groceries spend = $${groceries.amountSpent} (expected ~$${expected})`);

  // 8) Verify transactions appear in history
  const txs = await api('/api/transactions?limit=10');
  const big = txs.find((t) => t.description === 'Big-box, mart');
  log(big && Math.abs(big.amount - 192.30) < 0.01,
      `quoted-comma transaction landed correctly: ${big ? '$' + big.amount : 'NOT FOUND'}`);

  // 9) Junior cannot import (admin tries on their behalf, gets rejected)
  token = null;
  const mom = summary.members.find((m) => m.role === 'admin');
  const adminAuth = await api('/api/auth/admin-login', {
    method: 'POST', body: { memberId: mom.id }, anonymous: true,
  });
  token = adminAuth.token;
  const kid = summary.members.find((m) => m.role === 'junior');
  try {
    await api('/api/transactions/bulk', {
      method: 'POST',
      body: {
        memberId: kid.id,
        rows: [{ description: 'x', amount: 1, type: 'expense', category: 'Treats & Snacks', date: '2026-05-04' }],
      },
    });
    log(false, 'Junior import should have been rejected');
  } catch (e) {
    const detailsStr = JSON.stringify(e.body?.details || '');
    log(e.status === 400 && /junior/i.test(detailsStr),
        `Junior import rejected with 400 — got ${e.status}: ${detailsStr.slice(0, 80)}`);
  }

  // 10) Mid-batch all-or-nothing: invalid + valid rows should reject everything
  token = null;
  token = (await api('/api/auth/login', {
    method: 'POST', body: { memberId: dad.id, pin: '1234' }, anonymous: true,
  })).token;
  try {
    await api('/api/transactions/bulk', {
      method: 'POST',
      body: {
        rows: [
          { description: 'Valid', amount: 10, type: 'expense', category: 'Groceries', date: '2026-05-05', idempotencyKey: 'should-not-land-1' },
          { description: 'BadAmt', amount: -5, type: 'expense', category: 'Groceries', date: '2026-05-05', idempotencyKey: 'should-not-land-2' },
        ],
      },
    });
    log(false, 'Mixed batch should have rejected');
  } catch (e) {
    log(e.status === 400, `Mixed batch rejected with 400 — got ${e.status}`);
  }

  // 11) Confirm the "Valid" row from step 10 did NOT land
  const txsAfter = await api('/api/transactions?limit=20&all=true');
  const found = txsAfter.find((t) => t.idempotencyKey === 'should-not-land-1');
  log(!found, 'Valid row from rejected batch did not land');

  console.log();
  if (fail === 0) {
    console.log(`✓ ALL ${pass} CSV E2E TESTS PASSED`);
    process.exit(0);
  } else {
    console.log(`✗ ${fail} failed, ${pass} passed`);
    process.exit(1);
  }
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
