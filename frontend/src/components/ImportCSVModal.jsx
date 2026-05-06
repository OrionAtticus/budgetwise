// CSV Import modal. Three-step flow:
//   1. Pick file (or paste text)
//   2. Preview parsed rows + map columns + assign default category
//   3. Confirm → bulk-import → show summary
//
// Used from the Budget tab and Overview tab. Junior role doesn't see the
// trigger button (matching the existing "+ Add transaction" gating).

import { useState, useMemo, useRef } from 'react';
import { parseCSV, parseDate, parseAmount, guessColumnMapping } from '../lib/csv.js';
import { bulkImportTransactions } from '../api/transactions.js';
import { Modal, FormField, inputStyle, selectStyle, btnPrimary, btnSecondary } from './shared.jsx';
import { INCOME_CATEGORY_OPTIONS, mergeCategoryOptions } from '../domain/categories.js';

const SAMPLE_CSV = `Date,Description,Amount,Type,Category
2026-05-01,Trader Joe's,84.50,expense,Groceries
2026-05-02,Gas Station,52.20,expense,Transport
2026-05-03,Salary deposit,5200.00,income,Salary/Wages
2026-05-04,Lunch with team,28.40,expense,Dining Out`;

export default function ImportCSVModal({
  open, onClose, onShowToast, accentColor, memberId,
  availableCategories, // string[] — names of the member's budget categories
}) {
  // Step state: 'pick' | 'map' | 'submitting' | 'done'
  const [step, setStep]           = useState('pick');
  const [fileName, setFileName]   = useState('');
  const [rawText, setRawText]     = useState('');
  const [rows, setRows]           = useState([]);     // string[][]
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping]     = useState({ date: -1, description: -1, amount: -1, type: -1, category: -1 });
  const [defaultType, setDefaultType] = useState('expense');     // when no Type column
  const [defaultCategory, setDefaultCategory] = useState('');     // when no Category column
  const [error, setError]         = useState(null);
  const [result, setResult]       = useState(null);   // { imported, skipped, overLimitCategories }
  const fileInputRef = useRef(null);

  /* ── File handling ──────────────────────────────────────────── */
  const ingestText = (text, name = 'pasted.csv') => {
    setError(null);
    const parsed = parseCSV(text);
    if (parsed.length === 0) {
      setError('No rows found in file');
      return;
    }
    setFileName(name);
    setRawText(text);
    setRows(parsed);
    // Auto-guess mapping from first row (assumed header)
    setMapping(guessColumnMapping(parsed[0]));
    setStep('map');
  };

  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => ingestText(String(e.target.result), file.name);
    reader.onerror = () => setError('Could not read file');
    reader.readAsText(file);
  };

  const handleDownloadTemplate = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'budgetwise-template.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /* ── Validation + transform on every render ─────────────────── */
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const { previewRows, validCount, errorRows } = useMemo(() => {
    if (rows.length === 0) return { previewRows: [], validCount: 0, errorRows: [] };
    const previewRows = [];
    const errorRows = [];
    let valid = 0;

    dataRows.forEach((cells, i) => {
      const out = {
        rowNumber: i + 1 + (hasHeader ? 1 : 0), // 1-based, accounting for header
        raw: cells,
      };

      // Date
      const dateRaw = mapping.date >= 0 ? cells[mapping.date] : '';
      out.date = parseDate(dateRaw) || '';
      // Description
      const descRaw = mapping.description >= 0 ? cells[mapping.description] : '';
      out.description = String(descRaw || '').trim();
      // Amount
      const amtRaw = mapping.amount >= 0 ? cells[mapping.amount] : '';
      const { amount, isNegative } = parseAmount(amtRaw);
      out.amount = amount;
      // Type — explicit column wins, else infer from sign, else default
      let type = defaultType;
      if (mapping.type >= 0) {
        const t = String(cells[mapping.type] || '').toLowerCase().trim();
        if (t.startsWith('inc') || t === 'credit' || t === 'deposit') type = 'income';
        else if (t.startsWith('exp') || t === 'debit' || t === 'withdrawal') type = 'expense';
      } else if (mapping.amount >= 0 && isNegative) {
        type = 'expense'; // negative number on a bank statement = money out
      } else if (mapping.amount >= 0 && !isNegative && defaultType === 'expense') {
        // Positive number with no Type column → trust the user's default
        type = defaultType;
      }
      out.type = type;
      // Category — explicit column wins, else default
      out.category = mapping.category >= 0
        ? String(cells[mapping.category] || '').trim() || defaultCategory
        : defaultCategory;
      // Idempotency key — deterministic per row so a re-import skips
      out.idempotencyKey = `csv:${memberId}:${out.date}:${out.description}:${out.amount.toFixed(2)}:${out.type}:${out.category}`;

      // Per-row validation
      const rowErrors = [];
      if (!out.date)        rowErrors.push('date');
      if (!out.description) rowErrors.push('description');
      if (!isFinite(out.amount) || out.amount <= 0) rowErrors.push('amount');
      if (!out.category)    rowErrors.push('category');
      if (!out.type)        rowErrors.push('type');

      if (rowErrors.length === 0) valid++;
      else errorRows.push({ row: out.rowNumber, fields: rowErrors });

      previewRows.push({ ...out, errors: rowErrors });
    });

    return { previewRows, validCount: valid, errorRows };
  }, [rows, dataRows, hasHeader, mapping, defaultType, defaultCategory, memberId]);

  /* ── Submit ─────────────────────────────────────────────────── */
  const handleSubmit = async () => {
    if (errorRows.length > 0) {
      setError(`${errorRows.length} row(s) have problems. Fix or change column mapping.`);
      return;
    }
    if (validCount === 0) {
      setError('Nothing to import');
      return;
    }

    setStep('submitting');
    setError(null);
    try {
      const payload = previewRows.map((r) => ({
        description: r.description,
        amount: r.amount,
        type: r.type,
        category: r.category,
        date: r.date,
        idempotencyKey: r.idempotencyKey,
      }));
      const r = await bulkImportTransactions(payload, memberId);
      setResult(r);
      setStep('done');
    } catch (err) {
      setError(err.message || 'Import failed');
      // Show backend's per-row errors if it returned any
      if (err.body?.details) setError(err.message + ' — ' + JSON.stringify(err.body.details).slice(0, 200));
      setStep('map');
    }
  };

  /* ── Reset on close ─────────────────────────────────────────── */
  const handleClose = () => {
    onClose();
    // Defer reset so it doesn't flash during close animation
    setTimeout(() => {
      setStep('pick'); setFileName(''); setRawText(''); setRows([]);
      setMapping({ date: -1, description: -1, amount: -1, type: -1, category: -1 });
      setDefaultCategory(''); setDefaultType('expense');
      setError(null); setResult(null);
    }, 250);
  };

  if (!open) return null;

  /* ── STEP: pick ─────────────────────────────────────────────── */
  if (step === 'pick') {
    return (
      <Modal open={open} onClose={handleClose} title="Import transactions from CSV" subtitle="Bulk-load transactions from a bank statement export.">
        {error && <div style={{ background: 'rgba(192,57,43,.06)', color: '#c0392b', padding: '8px 12px', borderRadius: 8, fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <div style={{ border: '1.5px dashed #d8d3cc', borderRadius: 12, padding: 28, textAlign: 'center', marginBottom: 14, cursor: 'pointer', transition: 'border-color .2s' }}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = accentColor; }}
          onDragLeave={(e) => { e.currentTarget.style.borderColor = '#d8d3cc'; }}
          onDrop={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = '#d8d3cc'; handleFile(e.dataTransfer.files?.[0]); }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1c1917', marginBottom: 4 }}>Click to browse or drop a CSV file</div>
          <div style={{ fontSize: 11, color: '#a8a29e' }}>Most bank statements work. We'll preview before importing.</div>
        </div>
        <input ref={fileInputRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }}
          onChange={(e) => handleFile(e.target.files?.[0])} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#a8a29e', margin: '8px 0 14px' }}>
          <span>Need a starting point?</span>
          <button onClick={handleDownloadTemplate} style={{ background: 'none', border: 'none', color: accentColor, fontSize: 12, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}>
            Download CSV template
          </button>
        </div>

        <details style={{ fontSize: 12, color: '#57534e' }}>
          <summary style={{ cursor: 'pointer', color: '#a8a29e', fontWeight: 600 }}>Or paste CSV text directly</summary>
          <textarea
            style={{ ...inputStyle, marginTop: 8, fontFamily: "'DM Mono',monospace", fontSize: 11, minHeight: 100, resize: 'vertical' }}
            placeholder={SAMPLE_CSV}
            onBlur={(e) => { if (e.target.value.trim()) ingestText(e.target.value, 'pasted.csv'); }}
          />
        </details>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
          <button style={btnSecondary} onClick={handleClose}>Cancel</button>
        </div>
      </Modal>
    );
  }

  /* ── STEP: map ──────────────────────────────────────────────── */
  if (step === 'map' || step === 'submitting') {
    const headers = rows[0] || [];
    const colOptions = (
      <>
        <option value={-1}>— not in file —</option>
        {headers.map((h, i) => <option key={i} value={i}>{`Col ${i + 1}: ${h || '(empty)'}`}</option>)}
      </>
    );
    const defaultCategoryOptions = mapping.type >= 0
      ? mergeCategoryOptions(availableCategories, INCOME_CATEGORY_OPTIONS)
      : defaultType === 'income'
        ? INCOME_CATEGORY_OPTIONS
        : mergeCategoryOptions(availableCategories, []);

    return (
      <Modal open={open} onClose={handleClose} title={`Map columns · ${fileName}`} subtitle={`${dataRows.length} data row(s) detected. Match each field to a column.`}>
        {error && <div style={{ background: 'rgba(192,57,43,.06)', color: '#c0392b', padding: '8px 12px', borderRadius: 8, fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, fontSize: 12, color: '#57534e' }}>
          <input type="checkbox" id="hashdr" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
          <label htmlFor="hashdr" style={{ cursor: 'pointer' }}>First row is a header</label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Date column">
            <select style={selectStyle} value={mapping.date} onChange={(e) => setMapping({ ...mapping, date: parseInt(e.target.value, 10) })}>{colOptions}</select>
          </FormField>
          <FormField label="Description column">
            <select style={selectStyle} value={mapping.description} onChange={(e) => setMapping({ ...mapping, description: parseInt(e.target.value, 10) })}>{colOptions}</select>
          </FormField>
          <FormField label="Amount column">
            <select style={selectStyle} value={mapping.amount} onChange={(e) => setMapping({ ...mapping, amount: parseInt(e.target.value, 10) })}>{colOptions}</select>
          </FormField>
          <FormField label="Type column (optional)">
            <select style={selectStyle} value={mapping.type} onChange={(e) => setMapping({ ...mapping, type: parseInt(e.target.value, 10) })}>{colOptions}</select>
          </FormField>
          <FormField label="Category column (optional)">
            <select style={selectStyle} value={mapping.category} onChange={(e) => setMapping({ ...mapping, category: parseInt(e.target.value, 10) })}>{colOptions}</select>
          </FormField>
          {mapping.type < 0 && (
            <FormField label="Default type (no Type column)">
              <select style={selectStyle} value={defaultType} onChange={(e) => { setDefaultType(e.target.value); setDefaultCategory(''); }}>
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            </FormField>
          )}
        </div>

        {mapping.category < 0 && (
          <FormField label="Default category for all rows (no Category column)">
            <select style={selectStyle} value={defaultCategory} onChange={(e) => setDefaultCategory(e.target.value)}>
              <option value="">— pick one —</option>
              {defaultCategoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </FormField>
        )}

        {/* Preview table */}
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: '#57534e', marginTop: 14, marginBottom: 6 }}>
          Preview · {validCount} valid / {errorRows.length} with issues
        </div>
        <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid #e8e4df', borderRadius: 8, fontSize: 11 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: "'DM Mono',monospace" }}>
            <thead style={{ position: 'sticky', top: 0, background: '#f7f5f2' }}>
              <tr style={{ textAlign: 'left' }}>
                <th style={{ padding: '6px 8px', borderBottom: '1px solid #e8e4df', fontSize: 10 }}>#</th>
                <th style={{ padding: '6px 8px', borderBottom: '1px solid #e8e4df', fontSize: 10 }}>Date</th>
                <th style={{ padding: '6px 8px', borderBottom: '1px solid #e8e4df', fontSize: 10 }}>Description</th>
                <th style={{ padding: '6px 8px', borderBottom: '1px solid #e8e4df', fontSize: 10, textAlign: 'right' }}>Amount</th>
                <th style={{ padding: '6px 8px', borderBottom: '1px solid #e8e4df', fontSize: 10 }}>Type</th>
                <th style={{ padding: '6px 8px', borderBottom: '1px solid #e8e4df', fontSize: 10 }}>Category</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.slice(0, 50).map((r, i) => {
                const isErr = r.errors.length > 0;
                return (
                  <tr key={i} style={{ background: isErr ? '#fef2f2' : 'transparent' }}>
                    <td style={{ padding: '4px 8px', color: '#a8a29e' }}>{r.rowNumber}</td>
                    <td style={{ padding: '4px 8px', color: r.errors.includes('date') ? '#c0392b' : '#1c1917' }}>{r.date || '—'}</td>
                    <td style={{ padding: '4px 8px', color: r.errors.includes('description') ? '#c0392b' : '#1c1917', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description || '—'}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', color: r.errors.includes('amount') ? '#c0392b' : (r.type === 'income' ? '#3d6b52' : '#1c1917') }}>
                      {isFinite(r.amount) ? `${r.type === 'income' ? '+' : '−'}$${r.amount.toFixed(2)}` : '—'}
                    </td>
                    <td style={{ padding: '4px 8px' }}>{r.type}</td>
                    <td style={{ padding: '4px 8px', color: r.errors.includes('category') ? '#c0392b' : '#1c1917' }}>{r.category || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {previewRows.length > 50 && (
            <div style={{ padding: 6, fontSize: 10, color: '#a8a29e', textAlign: 'center', borderTop: '1px solid #e8e4df' }}>
              Showing first 50 of {previewRows.length} rows
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 14 }}>
          <button style={btnSecondary} onClick={() => { setStep('pick'); setError(null); }} disabled={step === 'submitting'}>← Back</button>
          <div style={{ display: 'flex', gap: 10 }}>
            <button style={btnSecondary} onClick={handleClose} disabled={step === 'submitting'}>Cancel</button>
            <button
              style={{ ...btnPrimary(accentColor), opacity: (errorRows.length > 0 || validCount === 0 || step === 'submitting') ? .5 : 1 }}
              onClick={handleSubmit}
              disabled={errorRows.length > 0 || validCount === 0 || step === 'submitting'}
            >
              {step === 'submitting' ? 'Importing…' : `Import ${validCount} row${validCount === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  /* ── STEP: done ─────────────────────────────────────────────── */
  return (
    <Modal open={open} onClose={handleClose} title="Import complete" subtitle="">
      <div style={{ textAlign: 'center', padding: '12px 0 18px' }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>✓</div>
        <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 22, color: '#1c1917', marginBottom: 4 }}>
          {result?.imported || 0} transaction{result?.imported === 1 ? '' : 's'} imported
        </div>
        {result?.skipped > 0 && (
          <div style={{ fontSize: 12, color: '#a8a29e', marginBottom: 4 }}>
            {result.skipped} skipped (already imported previously)
          </div>
        )}
        {result?.overLimitCategories?.length > 0 && (
          <div style={{ marginTop: 10, padding: 10, background: 'rgba(192,57,43,.06)', borderRadius: 8, color: '#c0392b', fontSize: 12 }}>
            ⚠ Over budget: {result.overLimitCategories.map((c) => c.name).join(', ')}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
        <button style={btnPrimary(accentColor)} onClick={() => { onShowToast('Imported!'); handleClose(); }}>Done</button>
      </div>
    </Modal>
  );
}
