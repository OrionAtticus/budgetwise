// AuthService — login, session management, PIN handling.
// Equivalent of the JSX AuthService + AuthStore, ported to Postgres + bcrypt.

import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { query, tx } from '../db.js';
import { config } from '../config.js';
import { badRequest, unauthorized, notFound } from '../middleware/errors.js';

/** Generate a 128-char hex token (64 random bytes). */
function newToken() {
  return crypto.randomBytes(64).toString('hex');
}

/**
 * Set a member's PIN. Used by onboarding and (future) PIN reset.
 * Always hashes with bcrypt at the configured cost.
 */
export async function setPin(memberId, pin) {
  if (!/^\d{4}$/.test(String(pin))) {
    throw badRequest('PIN must be exactly 4 digits');
  }
  const hash = await bcrypt.hash(String(pin), config.auth.bcryptCost);
  await query(
    `INSERT INTO auth.credentials (member_id, pin_hash, failed_attempts, locked_until)
     VALUES ($1, $2, 0, NULL)
     ON CONFLICT (member_id) DO UPDATE
        SET pin_hash = EXCLUDED.pin_hash,
            failed_attempts = 0,
            locked_until = NULL,
            updated_at = NOW()`,
    [memberId, hash],
  );
}

/**
 * Verify a PIN attempt. Implements lockout per spec §4.1:
 *   - 5 wrong attempts ⇒ 15-minute lockout
 *   - any successful attempt resets the counter
 *
 * Returns { success, remainingAttempts?, lockedUntil? }.
 * Throws 401 with a generic message if the member has no creds.
 */
export async function verifyPin(memberId, pinAttempt) {
  return tx(async (c) => {
    const r = await c.query(
      'SELECT pin_hash, failed_attempts, locked_until FROM auth.credentials WHERE member_id = $1 FOR UPDATE',
      [memberId],
    );
    if (r.rowCount === 0) throw unauthorized('No credentials on file for this member');
    const cred = r.rows[0];

    // Still locked out?
    if (cred.locked_until && new Date(cred.locked_until) > new Date()) {
      return { success: false, locked: true, lockedUntil: cred.locked_until };
    }

    const ok = await bcrypt.compare(String(pinAttempt), cred.pin_hash);
    if (ok) {
      await c.query(
        'UPDATE auth.credentials SET failed_attempts = 0, locked_until = NULL WHERE member_id = $1',
        [memberId],
      );
      return { success: true };
    }

    const attempts = (cred.failed_attempts || 0) + 1;
    const lockNow = attempts >= config.auth.pinMaxAttempts;
    const lockedUntil = lockNow
      ? new Date(Date.now() + config.auth.pinLockoutMinutes * 60_000)
      : null;

    await c.query(
      'UPDATE auth.credentials SET failed_attempts = $1, locked_until = $2 WHERE member_id = $3',
      [attempts, lockedUntil, memberId],
    );

    return {
      success: false,
      locked: lockNow,
      lockedUntil: lockedUntil?.toISOString() || null,
      remainingAttempts: Math.max(config.auth.pinMaxAttempts - attempts, 0),
    };
  });
}

/** Create a session row and return the token + expiry. */
export async function createSession(memberId) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + config.auth.sessionTtlHours * 3600_000);
  await query(
    `INSERT INTO auth.sessions (token, member_id, expires_at) VALUES ($1, $2, $3)`,
    [token, memberId, expiresAt],
  );
  return { token, expiresAt: expiresAt.toISOString() };
}

/** Delete a session row (logout). Idempotent. */
export async function revokeSession(token) {
  await query('DELETE FROM auth.sessions WHERE token = $1', [token]);
}

/** Cleanup task — call from a scheduler in production; we run it on startup. */
export async function purgeExpiredSessions() {
  const r = await query('DELETE FROM auth.sessions WHERE expires_at <= NOW()');
  return r.rowCount;
}

/**
 * Look up a member by ID — used in the auth flow before PIN is checked.
 * Returns null if the member does not exist.
 */
export async function getMember(memberId) {
  const r = await query(
    `SELECT id, family_id, name, email, role, monthly_income, monthly_limit,
            primary_goal, accent_colour, onboarding_complete
       FROM user_profiles WHERE id = $1`,
    [memberId],
  );
  if (r.rowCount === 0) return null;
  return rowToMember(r.rows[0]);
}

/** snake_case → camelCase mapping for the API response shape. */
export function rowToMember(row) {
  return {
    id:                  row.id,
    familyId:            row.family_id,
    name:                row.name,
    email:               row.email,
    role:                row.role,
    monthlyIncome:       Number(row.monthly_income) || 0,
    monthlyLimit:        Number(row.monthly_limit)  || 0,
    primaryGoal:         row.primary_goal,
    accentColour:        row.accent_colour,
    onboardingComplete:  row.onboarding_complete,
  };
}
