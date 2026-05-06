// CSV parser unit test — runs in plain Node.js with no deps.
// Run from repo root: node test-csv-parser.mjs

import { parseCSV, parseDate, parseAmount, guessColumnMapping } from './frontend/src/lib/csv.js';

let pass = 0, fail = 0;
const log = (ok, name, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else    { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('CSV parser unit test\n');

/* ── parseCSV ──────────────────────────────────────────────── */
log(eq(parseCSV(''),         []),                'empty input → []');
log(eq(parseCSV('a,b,c'),    [['a','b','c']]),   'single line, no newline');
log(eq(parseCSV('a,b\nc,d'), [['a','b'],['c','d']]), 'two lines, LF');
log(eq(parseCSV('a,b\r\nc,d'),[['a','b'],['c','d']]),'two lines, CRLF');
log(eq(parseCSV('"a,b",c'),  [['a,b','c']]),     'quoted comma');
log(eq(parseCSV('"a""b",c'), [['a"b','c']]),     'escaped quote');
log(eq(parseCSV('a,,c'),     [['a','','c']]),    'empty field');
log(eq(parseCSV('a,b\n'),    [['a','b']]),       'trailing newline dropped');
log(eq(parseCSV('\uFEFFa,b'),[['a','b']]),       'UTF-8 BOM stripped');

/* ── parseDate ─────────────────────────────────────────────── */
log(parseDate('2026-05-04')      === '2026-05-04', 'ISO passthrough');
log(parseDate('05/04/2026')      === '2026-05-04', 'M/D/YYYY (US)');
log(parseDate('15/04/2026')      === '2026-04-15', 'D/M/YYYY when day > 12');
log(parseDate('2026/05/04')      === '2026-05-04', 'YYYY/MM/DD slash');
log(parseDate('2026.05.04')      === '2026-05-04', 'YYYY.MM.DD dot');
log(parseDate('May 4, 2026')     === '2026-05-04', 'long form date');
log(parseDate('not-a-date')      === null,         'gibberish → null');
log(parseDate('')                === null,         'empty → null');
log(parseDate(null)              === null,         'null → null');

/* ── parseAmount ───────────────────────────────────────────── */
{
  const t = (input, expected, neg) => {
    const r = parseAmount(input);
    const ok = (Number.isNaN(expected) ? Number.isNaN(r.amount) : Math.abs(r.amount - expected) < 0.001) && r.isNegative === neg;
    log(ok, `parseAmount(${JSON.stringify(input)})`, ok ? '' : `got ${JSON.stringify(r)}, want { amount: ${expected}, isNegative: ${neg} }`);
  };
  t('120.50',   120.50, false);
  t('$120.50',  120.50, false);
  t('-45.20',   45.20,  true);
  t('($45.20)', 45.20,  true);
  t('1,234.56', 1234.56,false);
  t('+50',      50,     false);
  t('',         NaN,    false);
  t('garbage',  NaN,    false);
}

/* ── guessColumnMapping ────────────────────────────────────── */
{
  const m = guessColumnMapping(['Date', 'Description', 'Amount', 'Type', 'Category']);
  log(m.date === 0 && m.description === 1 && m.amount === 2 && m.type === 3 && m.category === 4,
      'exact-match headers');
}
{
  const m = guessColumnMapping(['Posting Date', 'Merchant Name', 'Debit', 'Memo']);
  log(m.date === 0 && m.description === 1 && m.amount === 2,
      'fuzzy-match bank-style headers',
      `got ${JSON.stringify(m)}`);
}

/* ── Report ────────────────────────────────────────────────── */
console.log();
if (fail === 0) {
  console.log(`✓ ALL ${pass} CSV PARSER TESTS PASSED`);
  process.exit(0);
} else {
  console.log(`✗ ${fail} failed, ${pass} passed`);
  process.exit(1);
}
