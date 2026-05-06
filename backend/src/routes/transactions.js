// Transactions routes.
//
//   GET  /api/transactions?memberId=&limit=    list (defaults to caller's own)
//   POST /api/transactions                     log a new one
//   POST /api/transactions/bulk                bulk import (CSV)
//
// Members log transactions for themselves.
// Admins may log transactions on behalf of any member in their family.

import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAuth, assertMemberInFamily } from '../middleware/auth.js';
import { listRecent, getHistory, logTransaction, bulkLogTransactions } from '../services/transactionService.js';
import { forbidden } from '../middleware/errors.js';

export const transactionsRouter = express.Router();

// GET /transactions
transactionsRouter.get('/', requireAuth, asyncHandler(async (req, res) => {
  const requestedMemberId = req.query.memberId || req.session.memberId;
  const isAdmin = req.session.role === 'admin';
  if (requestedMemberId !== req.session.memberId) {
    if (!isAdmin) throw forbidden('Cannot view another member\'s transactions');
    await assertMemberInFamily(requestedMemberId, req.session.familyId);
  }

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 200);
  const all   = req.query.all === 'true';

  const data = all
    ? await getHistory(requestedMemberId)
    : await listRecent(requestedMemberId, limit);
  res.json(data);
}));

// POST /transactions
transactionsRouter.post('/', requireAuth, asyncHandler(async (req, res) => {
  const targetMemberId = req.body.memberId || req.session.memberId;
  const isAdmin = req.session.role === 'admin';
  if (targetMemberId !== req.session.memberId) {
    if (!isAdmin) throw forbidden('Cannot log a transaction for another member');
    await assertMemberInFamily(targetMemberId, req.session.familyId);
  }

  const result = await logTransaction(targetMemberId, {
    description:    req.body.description,
    amount:         Number(req.body.amount),
    type:           req.body.type,
    category:       req.body.category,
    date:           req.body.date,
    idempotencyKey: req.body.idempotencyKey,
  });
  res.status(201).json(result);
}));

// POST /transactions/bulk — CSV import
transactionsRouter.post('/bulk', requireAuth, asyncHandler(async (req, res) => {
  const targetMemberId = req.body.memberId || req.session.memberId;
  const isAdmin = req.session.role === 'admin';
  if (targetMemberId !== req.session.memberId) {
    if (!isAdmin) throw forbidden('Cannot import transactions for another member');
    await assertMemberInFamily(targetMemberId, req.session.familyId);
  }

  const result = await bulkLogTransactions(targetMemberId, req.body.rows || []);
  res.status(201).json(result);
}));
