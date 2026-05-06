// Goals routes.
//   GET   /api/goals?memberId=         goals visible to that member (their personal + family-shared)
//   GET   /api/goals/family            shared family goals only
//   GET   /api/goals/:id/contributors  per-member contribution breakdown (shared goals only)
//   POST  /api/goals                   create goal (caller's own; isShared:true allowed by anyone)
//   POST  /api/goals/:id/contribute    add to current_amount
//   PATCH /api/goals/:id/archive       soft-delete (owner only)

import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAuth, assertMemberInFamily } from '../middleware/auth.js';
import {
  listForMember,
  listFamilyShared,
  createGoal,
  addSavings,
  archiveGoal,
  listContributors,
} from '../services/goalsService.js';
import { forbidden } from '../middleware/errors.js';

export const goalsRouter = express.Router();

// GET /goals
goalsRouter.get('/', requireAuth, asyncHandler(async (req, res) => {
  const target = req.query.memberId || req.session.memberId;
  if (target !== req.session.memberId) {
    if (req.session.role !== 'admin') throw forbidden('Cannot view another member\'s goals');
    await assertMemberInFamily(target, req.session.familyId);
  }
  res.json(await listForMember(target, req.session.familyId));
}));

// GET /goals/family
goalsRouter.get('/family', requireAuth, asyncHandler(async (req, res) => {
  res.json(await listFamilyShared(req.session.familyId));
}));

// GET /goals/:id/contributors
goalsRouter.get('/:id/contributors', requireAuth, asyncHandler(async (req, res) => {
  res.json(await listContributors(req.params.id, req.session.familyId));
}));

// POST /goals
goalsRouter.post('/', requireAuth, asyncHandler(async (req, res) => {
  const created = await createGoal(req.session.memberId, req.session.familyId, {
    name:         req.body.name,
    icon:         req.body.icon,
    targetAmount: Number(req.body.targetAmount),
    deadline:     req.body.deadline,
    isShared:     !!req.body.isShared,
  });
  res.status(201).json(created);
}));

// POST /goals/:id/contribute
goalsRouter.post('/:id/contribute', requireAuth, asyncHandler(async (req, res) => {
  const updated = await addSavings(
    req.params.id,
    req.session.memberId,
    req.session.familyId,
    Number(req.body.amount),
  );
  res.json(updated);
}));

// PATCH /goals/:id/archive
goalsRouter.patch('/:id/archive', requireAuth, asyncHandler(async (req, res) => {
  await archiveGoal(req.params.id, req.session.memberId);
  res.json({ ok: true });
}));
