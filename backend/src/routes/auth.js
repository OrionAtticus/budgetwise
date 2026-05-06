// Auth routes:
//   POST /api/auth/login         { memberId, pin }      → { token, member, family }
//   POST /api/auth/admin-login   { memberId }           → admin-only PIN bypass per spec §2.1
//   POST /api/auth/logout                               → revokes current session
//   GET  /api/auth/me                                   → current session info

import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAuth } from '../middleware/auth.js';
import {
  verifyPin,
  createSession,
  revokeSession,
  getMember,
} from '../services/authService.js';
import { getFamily } from '../services/familyService.js';
import { badRequest, unauthorized, forbidden } from '../middleware/errors.js';

export const authRouter = express.Router();

// POST /login
authRouter.post('/login', asyncHandler(async (req, res) => {
  const { memberId, pin } = req.body || {};
  if (!memberId || !pin) throw badRequest('memberId and pin are required');

  const member = await getMember(memberId);
  if (!member) throw unauthorized('Invalid credentials'); // don't leak which IDs exist

  const result = await verifyPin(memberId, pin);
  if (!result.success) {
    if (result.locked) {
      return res.status(423).json({
        error: 'Account locked due to too many failed attempts',
        lockedUntil: result.lockedUntil,
      });
    }
    throw unauthorized(`Incorrect PIN. ${result.remainingAttempts} attempt(s) remaining.`);
  }

  const session = await createSession(memberId);
  const family  = await getFamily(member.familyId);

  res.json({
    token:     session.token,
    expiresAt: session.expiresAt,
    member,
    family,
  });
}));

// POST /admin-login — Admin bypasses PIN per Architecture spec §2.1
// "Family Admin: ... bypasses PIN screen"
// Note: this is a deliberate spec choice for the household-trust model,
// not a security oversight. Admin still gets a real session token.
authRouter.post('/admin-login', asyncHandler(async (req, res) => {
  const { memberId } = req.body || {};
  if (!memberId) throw badRequest('memberId is required');

  const member = await getMember(memberId);
  if (!member) throw unauthorized('Invalid credentials');
  if (member.role !== 'admin') throw forbidden('PIN bypass only available for admin role');

  const session = await createSession(memberId);
  const family  = await getFamily(member.familyId);
  res.json({ token: session.token, expiresAt: session.expiresAt, member, family });
}));

// POST /logout
authRouter.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  await revokeSession(req.session.token);
  res.json({ ok: true });
}));

// GET /me
authRouter.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const member = await getMember(req.session.memberId);
  if (!member) throw unauthorized('Session points to a deleted member');
  const family = await getFamily(member.familyId);
  res.json({ member, family });
}));
