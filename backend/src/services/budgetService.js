// BudgetService — budget_categories CRUD and spend tracking.
// Owns the "increment amount_spent on transaction insert" rule (FR-12).

import { query, tx } from '../db.js';
import { getPeriodStartDate } from '../domain/rules.js';
import { badRequest, notFound } from '../middleware/errors.js';
import * as cache from './cacheService.js';

function rowToCategory(row) {
  return {
    id:            row.id,
    memberId:      row.member_id,
    name:          row.name,
    icon:          row.icon,
    monthlyLimit:  Number(row.monthly_limit) || 0,
    amountSpent:   Number(row.amount_spent)  || 0,
    parentGroup:   row.parent_group,
    periodStart:   row.period_start,
  };
}

export async function listCategories(memberId, periodStart = null) {
  const params = [memberId];
  let where = 'WHERE member_id = $1';
  if (periodStart) {
    params.push(periodStart);
    where += ` AND period_start = $${params.length}`;
  }
  const r = await query(
    `SELECT id, member_id, name, icon, monthly_limit, amount_spent, parent_group, period_start
       FROM budget_categories ${where}
      ORDER BY name ASC`,
    params,
  );
  return r.rows.map(rowToCategory);
}

export async function createCategory(memberId, input) {
  const { name, icon, monthlyLimit, parentGroup } = input;
  if (!name || !name.trim()) throw badRequest('Category name is required');
  if (typeof monthlyLimit !== 'number' || monthlyLimit < 0) {
    throw badRequest('monthlyLimit must be a non-negative number');
  }
  const r = await query(
    `INSERT INTO budget_categories (member_id, name, icon, monthly_limit, parent_group, period_start)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, member_id, name, icon, monthly_limit, amount_spent, parent_group, period_start`,
    [memberId, name.trim(), icon || '📊', monthlyLimit, parentGroup || null, getPeriodStartDate()],
  );
  cache.invalidateMember(memberId);
  return rowToCategory(r.rows[0]);
}

export async function updateCategory(categoryId, memberId, fields) {
  const sets = [];
  const vals = [];
  if (fields.name !== undefined)         { vals.push(fields.name);         sets.push(`name = $${vals.length}`); }
  if (fields.icon !== undefined)         { vals.push(fields.icon);         sets.push(`icon = $${vals.length}`); }
  if (fields.monthlyLimit !== undefined) { vals.push(fields.monthlyLimit); sets.push(`monthly_limit = $${vals.length}`); }
  if (fields.parentGroup !== undefined)  { vals.push(fields.parentGroup);  sets.push(`parent_group = $${vals.length}`); }
  if (sets.length === 0) {
    const r = await query(
      `SELECT id, member_id, name, icon, monthly_limit, amount_spent, parent_group, period_start
         FROM budget_categories WHERE id = $1 AND member_id = $2`,
      [categoryId, memberId],
    );
    if (r.rowCount === 0) throw notFound('Category not found');
    return rowToCategory(r.rows[0]);
  }
  vals.push(categoryId, memberId);
  const r = await query(
    `UPDATE budget_categories SET ${sets.join(', ')}
      WHERE id = $${vals.length - 1} AND member_id = $${vals.length}
      RETURNING id, member_id, name, icon, monthly_limit, amount_spent, parent_group, period_start`,
    vals,
  );
  if (r.rowCount === 0) throw notFound('Category not found');
  cache.invalidateMember(memberId);
  return rowToCategory(r.rows[0]);
}

export async function deleteCategory(categoryId, memberId) {
  const r = await query(
    'DELETE FROM budget_categories WHERE id = $1 AND member_id = $2',
    [categoryId, memberId],
  );
  if (r.rowCount === 0) throw notFound('Category not found');
  cache.invalidateMember(memberId);
}

/**
 * Increment amount_spent for the named category in a single statement.
 * Returns the updated row, or null if no category by that name exists.
 *
 * Called by TransactionService inside its own transaction; pass the
 * client through so the increment shares the same TX.
 */
export async function incrementSpend(client, memberId, categoryName, amount) {
  const r = await client.query(
    `UPDATE budget_categories
        SET amount_spent = amount_spent + $1
      WHERE member_id = $2 AND name = $3
      RETURNING id, member_id, name, icon, monthly_limit, amount_spent, parent_group, period_start`,
    [amount, memberId, categoryName],
  );
  return r.rowCount === 0 ? null : rowToCategory(r.rows[0]);
}

/** Reset all amount_spent to 0 for the start of a new period. Admin/cron use. */
export async function resetPeriod(memberId) {
  await query(
    `UPDATE budget_categories
        SET amount_spent = 0,
            period_start = $1
      WHERE member_id = $2`,
    [getPeriodStartDate(), memberId],
  );
  cache.invalidateMember(memberId);
}
