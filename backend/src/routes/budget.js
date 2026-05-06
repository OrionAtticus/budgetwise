// Budget category routes.
//   GET    /api/budget/categories?memberId=
//   POST   /api/budget/categories
//   PATCH  /api/budget/categories/:id
//   DELETE /api/budget/categories/:id
//   POST   /api/budget/reset?memberId=          (admin or self)

import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAuth, assertMemberInFamily } from '../middleware/auth.js';
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  resetPeriod,
} from '../services/budgetService.js';
import { forbidden, notFound } from '../middleware/errors.js';
import { query } from '../db.js';

export const budgetRouter = express.Router();

async function resolveTargetMember(req) {
  const target = req.query.memberId || req.body?.memberId || req.session.memberId;
  const isAdmin = req.session.role === 'admin';
  if (target !== req.session.memberId) {
    if (!isAdmin) throw forbidden('Cannot operate on another member\'s budget');
    await assertMemberInFamily(target, req.session.familyId);
  }
  return target;
}

// GET /categories
budgetRouter.get('/categories', requireAuth, asyncHandler(async (req, res) => {
  const memberId = await resolveTargetMember(req);
  res.json(await listCategories(memberId));
}));

// POST /categories
budgetRouter.post('/categories', requireAuth, asyncHandler(async (req, res) => {
  const memberId = await resolveTargetMember(req);
  const cat = await createCategory(memberId, {
    name:         req.body.name,
    icon:         req.body.icon,
    monthlyLimit: Number(req.body.monthlyLimit),
    parentGroup:  req.body.parentGroup,
  });
  res.status(201).json(cat);
}));

// PATCH /categories/:id
// Caller must own the category, OR be an admin in the same family as the owner.
budgetRouter.patch('/categories/:id', requireAuth, asyncHandler(async (req, res) => {
  const owner = await query(
    `SELECT bc.member_id, p.family_id
       FROM budget_categories bc
       JOIN user_profiles p ON p.id = bc.member_id
      WHERE bc.id = $1`,
    [req.params.id],
  );
  if (owner.rowCount === 0) throw notFound('Category not found');
  const isOwner = owner.rows[0].member_id === req.session.memberId;
  const isAdminSameFamily = req.session.role === 'admin' && owner.rows[0].family_id === req.session.familyId;
  if (!isOwner && !isAdminSameFamily) throw forbidden('Not your category');

  const updated = await updateCategory(req.params.id, owner.rows[0].member_id, {
    name:         req.body.name,
    icon:         req.body.icon,
    monthlyLimit: req.body.monthlyLimit !== undefined ? Number(req.body.monthlyLimit) : undefined,
    parentGroup:  req.body.parentGroup,
  });
  res.json(updated);
}));

// DELETE /categories/:id
budgetRouter.delete('/categories/:id', requireAuth, asyncHandler(async (req, res) => {
  const owner = await query(
    `SELECT bc.member_id, p.family_id
       FROM budget_categories bc
       JOIN user_profiles p ON p.id = bc.member_id
      WHERE bc.id = $1`,
    [req.params.id],
  );
  if (owner.rowCount === 0) throw notFound('Category not found');
  const isOwner = owner.rows[0].member_id === req.session.memberId;
  const isAdminSameFamily = req.session.role === 'admin' && owner.rows[0].family_id === req.session.familyId;
  if (!isOwner && !isAdminSameFamily) throw forbidden('Not your category');

  await deleteCategory(req.params.id, owner.rows[0].member_id);
  res.json({ ok: true });
}));

// POST /reset — wipe amount_spent and bump period_start (start of new month)
budgetRouter.post('/reset', requireAuth, asyncHandler(async (req, res) => {
  const memberId = await resolveTargetMember(req);
  await resetPeriod(memberId);
  res.json({ ok: true });
}));
