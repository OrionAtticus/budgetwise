// Transactions API.

import { apiGet, apiPost } from './client.js';

/**
 * List recent transactions. If memberId omitted, the backend defaults to
 * the caller's own. Admins can pass any family member's id.
 */
export const listTransactions = (memberId, limit = 20) => {
  const params = new URLSearchParams();
  if (memberId) params.set('memberId', memberId);
  params.set('limit', String(limit));
  return apiGet(`/api/transactions?${params.toString()}`);
};

/**
 * Log a new transaction. If memberId omitted, the backend uses the
 * authenticated caller. Returns { transaction, category, overLimit, notification }.
 */
export const createTransaction = (input) =>
  apiPost('/api/transactions', input);

/**
 * Bulk-import transactions (used by CSV import). Takes an array of rows
 * shaped like createTransaction's input. Returns { imported, skipped, overLimitCategories }.
 *
 * Idempotency keys on each row prevent duplicate imports if the user
 * imports the same CSV twice.
 */
export const bulkImportTransactions = (rows, memberId) =>
  apiPost('/api/transactions/bulk', memberId ? { memberId, rows } : { rows });
