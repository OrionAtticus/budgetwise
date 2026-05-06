// Auth middleware. Validates a Bearer token against auth.sessions
// and attaches { memberId, familyId, role } to req.session.
//
// Usage on a route:
//   router.get('/whatever', requireAuth, handler);
//   router.post('/admin-thing', requireAuth, requireAdmin, handler);

import { query } from '../db.js';
import { unauthorized, forbidden } from './errors.js';

/**
 * Strict auth — request must have a valid, unexpired session.
 * On success: sets req.session = { memberId, familyId, role, token }.
 */
export async function requireAuth(req, _res, next) {
  try {
    const header = req.get('authorization') || '';
    const m = header.match(/^Bearer\s+(.+)$/i);
    if (!m) throw unauthorized('Missing Authorization header');

    const token = m[1].trim();
    const r = await query(
      `SELECT s.token, s.member_id, s.expires_at,
              p.family_id, p.role
         FROM auth.sessions s
         JOIN public.user_profiles p ON p.id = s.member_id
        WHERE s.token = $1`,
      [token],
    );

    if (r.rowCount === 0) throw unauthorized('Invalid session token');

    const row = r.rows[0];
    if (new Date(row.expires_at) <= new Date()) {
      // Don't leave dead sessions lying around
      await query('DELETE FROM auth.sessions WHERE token = $1', [token]).catch(() => {});
      throw unauthorized('Session expired');
    }

    req.session = {
      token,
      memberId: row.member_id,
      familyId: row.family_id,
      role:     row.role,
    };
    next();
  } catch (err) {
    next(err);
  }
}

/** Must be called AFTER requireAuth. Rejects non-admins. */
export function requireAdmin(req, _res, next) {
  if (!req.session) return next(unauthorized());
  if (req.session.role !== 'admin') return next(forbidden('Admin role required'));
  next();
}

/**
 * Ensure the targeted member belongs to the caller's family.
 * Use this when admins act on other members.
 * The memberId can come from req.params, req.body, or req.query — caller picks.
 */
export async function assertMemberInFamily(memberId, familyId) {
  const r = await query(
    'SELECT 1 FROM user_profiles WHERE id = $1 AND family_id = $2',
    [memberId, familyId],
  );
  if (r.rowCount === 0) throw forbidden('Member not in your family');
}
