import { query } from '../db.js';
import { computeGoalProgress } from '../domain/rules.js';
import { badRequest, notFound, forbidden } from '../middleware/errors.js';
import * as cache from './cacheService.js';

function rowToGoal(row) {
  const targetAmount  = Number(row.target_amount)  || 0;
  const currentAmount = Number(row.current_amount) || 0;
  return {
    id:               row.id,
    memberId:         row.member_id,
    familyId:         row.family_id,
    name:             row.name,
    icon:             row.icon,
    targetAmount,
    currentAmount,
    progressPercent:  computeGoalProgress(currentAmount, targetAmount),
    deadline:         row.deadline instanceof Date ? row.deadline.toISOString().slice(0, 10) : row.deadline,
    isShared:         row.is_shared,
    isArchived:       row.is_archived,
    createdAt:        row.created_at,
  };
}

export async function listForMember(memberId, familyId) {
  const r = await query(
    `SELECT id, member_id, family_id, name, icon, target_amount, current_amount,
            deadline, is_shared, is_archived, created_at
       FROM savings_goals
      WHERE is_archived = FALSE
        AND (member_id = $1 OR (is_shared = TRUE AND family_id = $2))
      ORDER BY is_shared ASC, created_at DESC`,
    [memberId, familyId],
  );
  return r.rows.map(rowToGoal);
}

export async function listFamilyShared(familyId) {
  const r = await query(
    `SELECT id, member_id, family_id, name, icon, target_amount, current_amount,
            deadline, is_shared, is_archived, created_at
       FROM savings_goals
      WHERE family_id = $1 AND is_shared = TRUE AND is_archived = FALSE
      ORDER BY created_at DESC`,
    [familyId],
  );
  return r.rows.map(rowToGoal);
}

export async function createGoal(memberId, familyId, input) {
  const { name, icon, targetAmount, deadline, isShared = false } = input;
  if (!name || !name.trim()) throw badRequest('Goal name is required');
  if (typeof targetAmount !== 'number' || targetAmount <= 0) {
    throw badRequest('targetAmount must be a positive number');
  }
  const r = await query(
    `INSERT INTO savings_goals
       (member_id, family_id, name, icon, target_amount, deadline, is_shared)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, member_id, family_id, name, icon, target_amount, current_amount,
               deadline, is_shared, is_archived, created_at`,
    [memberId, familyId, name.trim(), icon || '🎯', targetAmount, deadline || null, !!isShared],
  );
  cache.invalidateMember(memberId);
  return rowToGoal(r.rows[0]);
}

export async function addSavings(goalId, callerMemberId, callerFamilyId, amount) {
  if (typeof amount !== 'number' || amount <= 0) {
    throw badRequest('amount must be a positive number');
  }

  const auth = await query(
    `SELECT id, member_id, family_id, is_shared FROM savings_goals WHERE id = $1`,
    [goalId],
  );
  if (auth.rowCount === 0) throw notFound('Goal not found');
  const g = auth.rows[0];
  const allowed = g.member_id === callerMemberId || (g.is_shared && g.family_id === callerFamilyId);
  if (!allowed) throw forbidden('Cannot contribute to this goal');

  const r = await query(
    `UPDATE savings_goals
        SET current_amount = current_amount + $1
      WHERE id = $2
      RETURNING id, member_id, family_id, name, icon, target_amount, current_amount,
                deadline, is_shared, is_archived, created_at`,
    [amount, goalId],
  );

  if (g.is_shared) {
    const famR = await query('SELECT id FROM user_profiles WHERE family_id = $1', [g.family_id]);
    famR.rows.forEach(row => cache.invalidateMember(row.id));
  } else {
    cache.invalidateMember(g.member_id);
    if (callerMemberId !== g.member_id) cache.invalidateMember(callerMemberId);
  }

  return rowToGoal(r.rows[0]);
}

export async function archiveGoal(goalId, callerMemberId) {
  const r = await query(
    `UPDATE savings_goals SET is_archived = TRUE
      WHERE id = $1 AND member_id = $2
      RETURNING id`,
    [goalId, callerMemberId],
  );
  if (r.rowCount === 0) throw notFound('Goal not found or not yours to archive');
  cache.invalidateMember(callerMemberId);
}