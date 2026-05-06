// Minimal CSV parser. Handles:
//   - Comma-separated values
//   - Quoted fields ("Hello, World")
//   - Escaped quotes inside quoted fields ("She said ""hi""")
//   - CRLF or LF line endings
//   - Empty trailing line
//
// Does NOT handle: alternate delimiters (semicolon, tab), BOM markers
// (we strip the UTF-8 BOM if present), or multi-line quoted values
// (rare in bank exports). Sufficient for typical bank CSV exports.

/** @returns {string[][]} array of rows, each row is an array of strings */
export function parseCSV(text) {
  if (!text) return [];

  // Strip UTF-8 BOM that Excel sometimes prepends
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++; // skip the escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\r' && next === '\n') {
        row.push(field); rows.push(row);
        field = ''; row = [];
        i++; // skip the \n
      } else if (ch === '\n' || ch === '\r') {
        row.push(field); rows.push(row);
        field = ''; row = [];
      } else {
        field += ch;
      }
    }
  }
  // Final field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop trailing empty rows that come from a final newline
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c === '')) {
    rows.pop();
  }

  return rows;
}

/**
 * Try to parse a date string in several common formats.
 * Returns ISO YYYY-MM-DD on success, null on failure.
 *
 * Accepts:
 *   2026-05-04
 *   05/04/2026   (US format — month first)
 *   04/05/2026   (will only ever resolve to a valid date — months > 12
 *                 force day-first interpretation)
 *   May 4, 2026
 *   4 May 2026
 *   2026/05/04
 */
export function parseDate(input) {
  if (!input) return null;
  const s = String(input).trim();

  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + 'T00:00:00');
    return isNaN(d) ? null : s;
  }

  // YYYY/MM/DD
  let m = s.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  // M/D/YYYY or D/M/YYYY — disambiguate by month value
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    let [, a, b, y] = m;
    a = parseInt(a, 10); b = parseInt(b, 10);
    let mo, d;
    if (a > 12)      { d = a; mo = b; }   // must be D/M/YYYY
    else if (b > 12) { mo = a; d = b; }   // must be M/D/YYYY
    else             { mo = a; d = b; }   // ambiguous — assume US M/D/YYYY
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // Fallback to JS Date parser (handles "May 4, 2026" etc.)
  const d = new Date(s);
  if (isNaN(d)) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Parse an amount string. Strips $ commas and parens (parens often indicate
 * negative on bank statements). Returns { amount, isNegative } where amount
 * is always non-negative. Caller decides whether to flip type based on sign.
 */
export function parseAmount(input) {
  if (input === null || input === undefined) return { amount: NaN, isNegative: false };
  const s = String(input).trim();
  if (!s) return { amount: NaN, isNegative: false };

  let isNegative = false;
  let cleaned = s;

  // Handle parenthesised negatives like ($12.34)
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    isNegative = true;
    cleaned = cleaned.slice(1, -1);
  }
  // Handle leading minus
  if (cleaned.startsWith('-')) {
    isNegative = true;
    cleaned = cleaned.slice(1);
  } else if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1);
  }

  // Strip currency symbols and thousands separators
  cleaned = cleaned.replace(/[$£€¥,]/g, '').trim();

  const n = parseFloat(cleaned);
  if (!isFinite(n) || n < 0) return { amount: NaN, isNegative };
  return { amount: n, isNegative };
}

/** Heuristic guess: which CSV header maps to which transaction field? */
export function guessColumnMapping(headers) {
  const result = { date: -1, description: -1, amount: -1, type: -1, category: -1 };
  const lc = headers.map((h) => String(h).toLowerCase().trim());

  // Walk headers left-to-right and return the first one that matches any
  // candidate (either exactly or as a substring). Earlier columns win
  // because banks put the most descriptive column first (e.g. "Merchant
  // Name" at col 1 should beat "Memo" at col 3 for the description field).
  const find = (...candidates) => {
    for (let i = 0; i < lc.length; i++) {
      const h = lc[i];
      if (candidates.includes(h)) return i;
      if (candidates.some((c) => h.includes(c))) return i;
    }
    return -1;
  };

  result.date        = find('date', 'transaction date', 'posted', 'posting date');
  result.description = find('description', 'merchant', 'payee', 'name', 'details', 'memo');
  result.amount      = find('amount', 'value', 'debit', 'credit');
  result.type        = find('type', 'transaction type');
  result.category    = find('category', 'class');
  return result;
}
