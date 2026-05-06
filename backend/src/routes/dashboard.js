// Dashboard aggregation routes.
//   GET /api/dashboard/me                  caller's own dashboard
//   GET /api/dashboard/member/:id          another member (admin only)
//   GET /api/dashboard/family               family-level rollup (any member)

import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAuth, assertMemberInFamily } from '../middleware/auth.js';
import { getDashboard, getFamilyOverview } from '../services/dashboardService.js';
import { forbidden } from '../middleware/errors.js';

export const dashboardRouter = express.Router();

// GET /me
dashboardRouter.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json(await getDashboard(req.session.memberId, req.session.familyId));
}));

// GET /member/:id
dashboardRouter.get('/member/:id', requireAuth, asyncHandler(async (req, res) => {
  if (req.params.id !== req.session.memberId && req.session.role !== 'admin') {
    throw forbidden('Cannot view another member\'s dashboard');
  }
  await assertMemberInFamily(req.params.id, req.session.familyId);
  res.json(await getDashboard(req.params.id, req.session.familyId));
}));

// GET /family
dashboardRouter.get('/family', requireAuth, asyncHandler(async (req, res) => {
  res.json(await getFamilyOverview(req.session.familyId));
}));
