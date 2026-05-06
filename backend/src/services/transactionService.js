// TransactionService — log/list transactions.
// Owns the data-flow described in Architecture spec §8:
//   1. Validate
//   2. INSERT transaction
//   3. UPDATE matching budget_categories.amount_spent
//   4. If over-limit, enqueue notification to the family admin
//   5. Invalidate dashboard cache for this member
// All three writes happen in a single Postgres transaction so we never end
// up with a transaction row but no spend update (or vice versa).

import { query, tx } from '../db.js';
import { validateTransaction } from '../domain/rules.js';
import { incrementSpend } from './budgetService.js';
import { enqueueNotification } from './notificationService.js';
import { badRequest, notFound, conflict } from '../middleware/errors.js';
import * as cache from './cacheService.js';

function rowToTx(row) {
  return {
    id:              row.id,
    memberId:        row.member_id,
    description:     row.description,
    amount:          Number(row.amount),
    type:            row.type,
    category:        row.category,
    date:            row.date instanceof Date ? row.date.toISOString().slice(0, 10) : row.date,
    idempotencyKey:  row.idempotency_key,
    createdAt:       row.created_at,
  };
}

export async function listRecent(memberId, limit = 20) {
  const r = await query(
    `SELECT id, member_id, description, amount, type, category, date,
            idempotency_key, created_at
       FROM transactions
      WHERE member_id = $1
      ORDER BY date DESC, created_at DESC
      LIMIT $2`,
    [memberId, limit],
  );
  return r.rows.map(rowToTx);
}

export async function getHistory(memberId) {
  const r = await query(
    `SELECT id, member_id, description, amount, type, category, date,
            idempotency_key, created_at
       FROM transactions
      WHERE member_id = $1
      ORDER BY date DESC, created_at DESC`,
    [memberId],
  );
  return r.rows.map(rowToTx);
}

/**
 * Log a new transaction. The full Architecture §8 workflow.
 *
 * @param {string} memberId
 * @param {object} input - { description, amount, type, category, date, idempotencyKey? }
 * @returns {Promise<{transaction, category?, overLimit, notification?}>}
 */
export async function logTransaction(memberId, input) {
  // Step 0: load member's role for category validation
  const memberR = await query(
    'SELECT role, name, family_id FROM user_profiles WHERE id = $1',
    [memberId],
  );
  if (memberR.rowCount === 0) throw notFound('Member not found');
  const member = memberR.rows[0];

  // Step 1: domain validation
  const v = validateTransaction(
    {
      description: input.description,
      amount:      Number(input.amount),
      type:        input.type,
      category:    input.category,
    },
    member.role,
  );
  if (!v.valid) throw badRequest(v.error);

  const date = input.date || new Date().toISOString().slice(0, 10);

  // Step 2-4: insert + update + maybe notify, all in one DB transaction
  const result = await tx(async (client) => {
    let txRow;
    try {
      const ins = await client.query(
        `INSERT INTO transactions
           (member_id, description, amount, type, category, date, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, member_id, description, amount, type, category, date,
                   idempotency_key, created_at`,
        [
          memberId,
          input.description.trim(),
          Number(input.amount),
          input.type,
          input.category,
          date,
          input.idempotencyKey || null,
        ],
      );
      txRow = ins.rows[0];
    } catch (err) {
      // Surface the duplicate-idempotency-key case as 409
      if (err.code === '23505' && err.constraint === 'transactions_idempotency_key_key') {
        throw conflict('Duplicate transaction (idempotency key already used)');
      }
      throw err;
    }

    // Only expenses count against budget categories
    let updatedCat = null;
    let overLimit = false;
    if (input.type === 'expense') {
      updatedCat = await incrementSpend(client, memberId, input.category, Number(input.amount));
      if (updatedCat && updatedCat.amountSpent > updatedCat.monthlyLimit) {
        overLimit = true;
      }
    }

    return { txRow, updatedCat, overLimit };
  });

  // Step 5: side effects outside the DB transaction
  cache.invalidateMember(memberId);

  let notification = null;
  if (result.overLimit && result.updatedCat) {
    // Enqueue a budget warning to the family admin (FR-16)
    const adminR = await query(
      `SELECT id, name FROM user_profiles
         WHERE family_id = $1 AND role = 'admin' LIMIT 1`,
      [member.family_id],
    );
    if (adminR.rowCount > 0) {
      notification = await enqueueNotification({
        recipientId: adminR.rows[0].id,
        senderId:    memberId,
        type:        'budget_warning',
        title:       `${member.name} exceeded ${result.updatedCat.name} budget`,
        body:        `$${result.updatedCat.amountSpent.toFixed(2)} spent of $${result.updatedCat.monthlyLimit.toFixed(2)} limit`,
      });
    }
  }

  return {
    transaction: rowToTx(result.txRow),
    category:    result.updatedCat,
    overLimit:   result.overLimit,
    notification,
  };
}

/**
 * Bulk-import transactions for a member. Used by CSV import.
 *
 * All rows are validated up front. If ANY row fails domain validation, the
 * entire batch is rejected (atomic — partial imports are confusing). Inside
 * the DB transaction, individual idempotency-key conflicts are tolerated:
 * those rows are skipped (counted as `skipped`), so re-running an import
 * doesn't create duplicates but also doesn't fail wholesale.
 *
 * @param {string} memberId
 * @param {Array<object>} rows  - each: { description, amount, type, category, date, idempotencyKey? }
 * @returns {Promise<{ imported, skipped, overLimitCategories, errors }>}
 */
export async function bulkLogTransactions(memberId, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw badRequest('rows must be a non-empty array');
  }
  if (rows.length > 500) {
    // Sanity cap. A single bank statement export shouldn't exceed this
    // for a normal household, and it bounds memory + DB transaction time.
    throw badRequest('Batch size exceeds 500-row limit');
  }

  const memberR = await query(
    'SELECT role, name, family_id FROM user_profiles WHERE id = $1',
    [memberId],
  );
  if (memberR.rowCount === 0) throw notFound('Member not found');
  const member = memberR.rows[0];

  // Pre-validate every row before opening a DB transaction. We collect
  // ALL errors so the user sees the full picture, not just the first one.
  const validated = [];
  const errors = [];
  rows.forEach((raw, i) => {
    const row = {
      description: raw.description,
      amount:      Number(raw.amount),
      type:        raw.type,
      category:    raw.category,
      date:        raw.date,
      idempotencyKey: raw.idempotencyKey || null,
    };
    const v = validateTransaction(row, member.role);
    if (!v.valid) {
      errors.push({ row: i + 1, error: v.error });
    } else {
      validated.push(row);
    }
  });

  if (errors.length > 0) {
    // Don't import anything if any row is bad — keeps the user's mental
    // model simple: either the whole import worked, or none of it did.
    throw badRequest(
      `${errors.length} row(s) failed validation. Fix and retry.`,
      errors.slice(0, 20), // cap details payload
    );
  }

  // Track per-category spend deltas so we can run a single UPDATE per
  // category at the end instead of one per row. Much faster for big imports.
  const spendByCategory = new Map();
  let imported = 0;
  let skipped = 0;
  const overLimitCats = [];

  await tx(async (client) => {
    for (let i = 0; i < validated.length; i++) {
      const row = validated[i];
      const sp = `sp_${i}`; // savepoint name — unique per row

      // Without a savepoint, a unique-violation here aborts the whole
      // transaction (Postgres error 25P02 on subsequent statements).
      // SAVEPOINT lets us roll back just this row and keep going.
      await client.query(`SAVEPOINT ${sp}`);
      try {
        await client.query(
          `INSERT INTO transactions
             (member_id, description, amount, type, category, date, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            memberId,
            row.description.trim(),
            row.amount,
            row.type,
            row.category,
            row.date || new Date().toISOString().slice(0, 10),
            row.idempotencyKey,
          ],
        );
        await client.query(`RELEASE SAVEPOINT ${sp}`);
        imported++;
        if (row.type === 'expense') {
          spendByCategory.set(row.category, (spendByCategory.get(row.category) || 0) + row.amount);
        }
      } catch (err) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        if (err.code === '23505' && err.constraint === 'transactions_idempotency_key_key') {
          // Re-import of an already-imported row → silently skip
          skipped++;
        } else {
          throw err; // any other error rolls back the whole batch
        }
      }
    }

    // One UPDATE per category, summing the imported expense rows
    for (const [catName, delta] of spendByCategory.entries()) {
      const r = await client.query(
        `UPDATE budget_categories
            SET amount_spent = amount_spent + $1
          WHERE member_id = $2 AND name = $3
          RETURNING name, amount_spent, monthly_limit`,
        [delta, memberId, catName],
      );
      if (r.rowCount > 0) {
        const c = r.rows[0];
        if (Number(c.amount_spent) > Number(c.monthly_limit)) {
          overLimitCats.push({
            name: c.name,
            spent: Number(c.amount_spent),
            limit: Number(c.monthly_limit),
          });
        }
      }
    }
  });

  // Side effects outside the transaction
  cache.invalidateMember(memberId);

  // One consolidated notification per over-limit category from the import,
  // not one per row (would spam the admin's inbox)
  if (overLimitCats.length > 0) {
    const adminR = await query(
      `SELECT id FROM user_profiles
         WHERE family_id = $1 AND role = 'admin' LIMIT 1`,
      [member.family_id],
    );
    if (adminR.rowCount > 0) {
      for (const c of overLimitCats) {
        await enqueueNotification({
          recipientId: adminR.rows[0].id,
          senderId:    memberId,
          type:        'budget_warning',
          title:       `${member.name} over ${c.name} budget after import`,
          body:        `$${c.spent.toFixed(2)} spent of $${c.limit.toFixed(2)} limit`,
        });
      }
    }
  }

  return { imported, skipped, overLimitCategories: overLimitCats };
}
