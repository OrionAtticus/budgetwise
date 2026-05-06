// Family & profile routes.
//
// Listing / reading is open to any family member (filtered by familyId).
// Creating / editing / deleting is admin-only.
//
// Endpoints:
//   GET    /api/public/family-summary  → minimal listing for the profile selector (no auth)
//   GET    /api/family                 → current family
//   GET    /api/profiles               → all profiles in current family
//   GET    /api/profiles/:id           → one profile
//   POST   /api/profiles               (admin) create new member
//   PATCH  /api/profiles/:id           update profile (self or admin)
//   DELETE /api/profiles/:id           (admin) remove member

import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  getFamily,
  listProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
} from '../services/familyService.js';
import { setPin } from '../services/authService.js';
import { forbidden, notFound, badRequest } from '../middleware/errors.js';
import { query } from '../db.js';

/* ── Public selector data (no auth) ───────────────────────────────────
 * The profile selector screen needs to render profile cards BEFORE any
 * member has signed in. We expose a minimal, read-only summary here.
 *
 * Single-tenant assumption: this dev/demo instance hosts ONE family.
 * In a real multi-tenant deployment you'd key off a subdomain or
 * invite-token instead of returning the only family blindly.
 *
 * The response intentionally omits email addresses, monthly_income/limit,
 * and anything else not needed to show the selector card.
 */
export const publicRouter = express.Router();

publicRouter.get('/family-summary', asyncHandler(async (_req, res) => {
  // Pick the first family. (Demo instance has exactly one.)
  const famR = await query(
    `SELECT id, name, plan_tier FROM family_accounts ORDER BY created_at ASC LIMIT 1`,
  );
  if (famR.rowCount === 0) {
    return res.json({ family: null, members: [] });
  }
  const fam = famR.rows[0];

  // Each member with their current month's total spend, but no PII.
  const r = await query(
    `SELECT p.id, p.name, p.role,
            COALESCE(SUM(c.amount_spent), 0)::float AS spent
       FROM user_profiles p
       LEFT JOIN budget_categories c ON c.member_id = p.id
      WHERE p.family_id = $1
      GROUP BY p.id
      ORDER BY
        CASE p.role WHEN 'admin' THEN 0 WHEN 'member' THEN 1 WHEN 'teen' THEN 2 ELSE 3 END,
        p.name ASC`,
    [fam.id],
  );

  res.json({
    family: { id: fam.id, name: fam.name, planTier: fam.plan_tier },
    members: r.rows.map((row) => ({
      id: row.id, name: row.name, role: row.role, spent: Number(row.spent),
    })),
  });
}));

export const familyRouter = express.Router();

// GET /family
familyRouter.get('/family', requireAuth, asyncHandler(async (req, res) => {
  const f = await getFamily(req.session.familyId);
  if (!f) throw notFound('Family not found');
  res.json(f);
}));

export const profilesRouter = express.Router();

// GET /profiles
profilesRouter.get('/', requireAuth, asyncHandler(async (req, res) => {
  const list = await listProfiles(req.session.familyId);
  res.json(list);
}));

// GET /profiles/:id
profilesRouter.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const p = await getProfile(req.params.id, req.session.familyId);
  if (!p) throw notFound('Profile not found');
  res.json(p);
}));

// POST /profiles  (admin)
profilesRouter.post('/', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const created = await createProfile(req.session.familyId, req.body || {});
  res.status(201).json(created);
}));

// PATCH /profiles/:id
//   - admins can edit any field on any member
//   - non-admins can only edit a small whitelist on themselves
profilesRouter.patch('/:id', requireAuth, asyncHandler(async (req, res) => {
  const targetId = req.params.id;
  const isAdmin  = req.session.role === 'admin';
  const isSelf   = req.session.memberId === targetId;
  if (!isAdmin && !isSelf) throw forbidden('Cannot edit another member');

  let fields = req.body || {};
  if (!isAdmin) {
    // Self-edit whitelist — keeps non-admins from elevating role or limit
    const allowedSelfKeys = ['name', 'email', 'primaryGoal', 'accentColour', 'incomeType', 'monthlyIncome', 'onboardingComplete'];
    fields = Object.fromEntries(Object.entries(fields).filter(([k]) => allowedSelfKeys.includes(k)));
  }

  const updated = await updateProfile(targetId, req.session.familyId, fields);
  res.json(updated);
}));

// PATCH /profiles/:id/pin — set/change a PIN. Self or admin.
profilesRouter.patch('/:id/pin', requireAuth, asyncHandler(async (req, res) => {
  const targetId = req.params.id;
  const isAdmin  = req.session.role === 'admin';
  const isSelf   = req.session.memberId === targetId;
  if (!isAdmin && !isSelf) throw forbidden('Cannot change another member\'s PIN');

  const { pin } = req.body || {};
  if (!pin) throw badRequest('pin is required');

  // If admin sets PIN for someone else, require that someone is in their family
  if (isAdmin && !isSelf) {
    const target = await getProfile(targetId, req.session.familyId);
    if (!target) throw notFound('Profile not found');
  }

  await setPin(targetId, pin);
  res.json({ ok: true });
}));

// DELETE /profiles/:id  (admin)
profilesRouter.delete('/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  await deleteProfile(req.params.id, req.session.familyId);
  res.json({ ok: true });
}));
