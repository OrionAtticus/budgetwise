// Notifications routes.
//   GET  /api/notifications              caller's own notifications
//   POST /api/notifications              admin enqueues a nudge to a member
//   POST /api/notifications/:id/read     mark one read (recipient only)

import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAuth, requireAdmin, assertMemberInFamily } from '../middleware/auth.js';
import {
  enqueueNotification,
  listForRecipient,
  markRead,
} from '../services/notificationService.js';
import { badRequest } from '../middleware/errors.js';

export const notificationsRouter = express.Router();

// GET /notifications
notificationsRouter.get('/', requireAuth, asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  res.json(await listForRecipient(req.session.memberId, limit));
}));

// POST /notifications  (admin sends a nudge — FR-30)
notificationsRouter.post('/', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { recipientId, type = 'nudge', title, body } = req.body || {};
  if (!recipientId) throw badRequest('recipientId is required');
  await assertMemberInFamily(recipientId, req.session.familyId);

  const notif = await enqueueNotification({
    recipientId,
    senderId: req.session.memberId,
    type,
    title,
    body,
  });
  res.status(201).json(notif);
}));

// POST /notifications/:id/read
notificationsRouter.post('/:id/read', requireAuth, asyncHandler(async (req, res) => {
  await markRead(req.params.id, req.session.memberId);
  res.json({ ok: true });
}));
