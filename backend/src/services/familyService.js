// FamilyService — read/write family_accounts and user_profiles.
// Handles plan-tier member-limit enforcement (FR-29 / spec §3.1).

import { query, tx } from '../db.js';
import { setPin } from './authService.js';
import { rowToMember } from './authService.js';
import { PLAN_LIMITS } from '../domain/rules.js';
import { badRequest, notFound, conflict } from '../middleware/errors.js';
import * as cache from './cacheService.js';

/* ── Family ────────────────────────────────────────────────────────── */

export async function getFamily(familyId) {
  const r = await query(
    `SELECT id, name, plan_tier, billing_email, max_members, created_at
       FROM family_accounts WHERE id = $1`,
    [familyId],
  );
  if (r.rowCount === 0) return null;
  return rowToFamily(r.rows[0]);
}

function rowToFamily(row) {
  return {
    id:           row.id,
    name:         row.name,
    planTier:     row.plan_tier,
    billingEmail: row.billing_email,
    maxMembers:   row.max_members,
    createdAt:    row.created_at,
  };
}

/* ── Profiles ──────────────────────────────────────────────────────── */

export async function listProfiles(familyId) {
  const r = await query(
    `SELECT id, family_id, name, email, role, monthly_income, monthly_limit,
            primary_goal, accent_colour, onboarding_complete
       FROM user_profiles
      WHERE family_id = $1
      ORDER BY
        CASE role WHEN 'admin' THEN 0 WHEN 'member' THEN 1 WHEN 'teen' THEN 2 ELSE 3 END,
        name ASC`,
    [familyId],
  );
  return r.rows.map(rowToMember);
}

export async function getProfile(memberId, familyId) {
  const r = await query(
    `SELECT id, family_id, name, email, role, monthly_income, monthly_limit,
            primary_goal, accent_colour, onboarding_complete
       FROM user_profiles
      WHERE id = $1 AND family_id = $2`,
    [memberId, familyId],
  );
  if (r.rowCount === 0) return null;
  return rowToMember(r.rows[0]);
}

/**
 * Create a new family member. Admin-only at the route layer.
 * Initial PIN is required so the member can sign in.
 *
 * Enforces family.max_members against PLAN_LIMITS for the current tier.
 */
export async function createProfile(familyId, input) {
  const { name, email, role, monthlyLimit = 0, monthlyIncome = 0, pin } = input;

  if (!name || !name.trim()) throw badRequest('Name is required');
  if (!['admin', 'member', 'teen', 'junior'].includes(role)) {
    throw badRequest("Role must be one of: admin, member, teen, junior");
  }
  if (!/^\d{4}$/.test(String(pin || ''))) {
    throw badRequest('A 4-digit initial PIN is required');
  }

  return tx(async (c) => {
    // Lock the family row so concurrent inserts can't both squeak past max_members
    const fam = await c.query(
      'SELECT plan_tier, max_members FROM family_accounts WHERE id = $1 FOR UPDATE',
      [familyId],
    );
    if (fam.rowCount === 0) throw notFound('Family not found');
    const cap = Math.min(fam.rows[0].max_members, PLAN_LIMITS[fam.rows[0].plan_tier] ?? 1);

    const cnt = await c.query(
      'SELECT COUNT(*)::int AS n FROM user_profiles WHERE family_id = $1',
      [familyId],
    );
    if (cnt.rows[0].n >= cap) {
      throw conflict(`Plan tier "${fam.rows[0].plan_tier}" allows up to ${cap} members`);
    }

    const ins = await c.query(
      `INSERT INTO user_profiles
         (family_id, name, email, role, monthly_income, monthly_limit, onboarding_complete)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE)
       RETURNING id, family_id, name, email, role, monthly_income, monthly_limit,
                 primary_goal, accent_colour, onboarding_complete`,
      [familyId, name.trim(), email || null, role, monthlyIncome, monthlyLimit],
    );
    const member = rowToMember(ins.rows[0]);

    // Hash + persist PIN inside the same transaction so we never leave a
    // member without credentials.
    // setPin uses the pool, not this client — but bcrypt + 1 row is fast,
    // and credentials.member_id has FK to user_profiles which is now committed-locally.
    // To keep things atomic we do the upsert directly here:
    const bcrypt = await import('bcryptjs');
    const { config } = await import('../config.js');
    const hash = await bcrypt.default.hash(String(pin), config.auth.bcryptCost);
    await c.query(
      `INSERT INTO auth.credentials (member_id, pin_hash) VALUES ($1, $2)`,
      [member.id, hash],
    );

    return member;
  });
}

/**
 * Update mutable fields on a profile. The caller decides which fields
 * are allowed (e.g. admin vs self-edit) at the route layer.
 */
export async function updateProfile(memberId, familyId, fields) {
  const allowed = [
    ['name',               'name'],
    ['email',              'email'],
    ['role',               'role'],
    ['monthlyIncome',      'monthly_income'],
    ['monthlyLimit',       'monthly_limit'],
    ['primaryGoal',        'primary_goal'],
    ['accentColour',       'accent_colour'],
    ['onboardingComplete', 'onboarding_complete'],
    ['incomeType',         'income_type'],
  ];

  const sets = [];
  const vals = [];
  for (const [key, col] of allowed) {
    if (fields[key] !== undefined) {
      vals.push(fields[key]);
      sets.push(`${col} = $${vals.length}`);
    }
  }
  if (sets.length === 0) {
    return getProfile(memberId, familyId); // nothing to change
  }

  vals.push(memberId, familyId);
  const r = await query(
    `UPDATE user_profiles SET ${sets.join(', ')}
      WHERE id = $${vals.length - 1} AND family_id = $${vals.length}
      RETURNING id, family_id, name, email, role, monthly_income, monthly_limit,
                primary_goal, accent_colour, onboarding_complete`,
    vals,
  );
  if (r.rowCount === 0) throw notFound('Profile not found');

  cache.invalidateMember(memberId);
  return rowToMember(r.rows[0]);
}

export async function deleteProfile(memberId, familyId) {
  // Refuse if this is the family's only admin — locking out the family is bad UX
  const adminCount = await query(
    `SELECT COUNT(*)::int AS n FROM user_profiles WHERE family_id = $1 AND role = 'admin'`,
    [familyId],
  );
  const target = await getProfile(memberId, familyId);
  if (!target) throw notFound('Profile not found');
  if (target.role === 'admin' && adminCount.rows[0].n <= 1) {
    throw conflict('Cannot remove the only admin of the family');
  }

  // FK cascades take care of transactions/categories/goals/credentials/sessions
  await query('DELETE FROM user_profiles WHERE id = $1 AND family_id = $2', [memberId, familyId]);
  cache.invalidateMember(memberId);
}
