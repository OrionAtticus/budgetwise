// NotificationService — INSERT into notifications and (in production)
// dispatch via SendGrid/FCM. For dev we just log the dispatch.

import { query } from '../db.js';
import { badRequest, notFound } from '../middleware/errors.js';

function rowToNotif(row) {
  return {
    id:           row.id,
    recipientId:  row.recipient_id,
    senderId:     row.sender_id,
    type:         row.type,
    title:        row.title,
    body:         row.body,
    isRead:       row.is_read,
    deliveredAt:  row.delivered_at,
    createdAt:    row.created_at,
  };
}

export async function enqueueNotification(input) {
  const { recipientId, senderId = null, type, title, body = null } = input;
  if (!recipientId)                        throw badRequest('recipientId required');
  if (!['nudge','budget_warning','weekly_report','invite','system'].includes(type)) {
    throw badRequest('invalid notification type');
  }
  if (!title || !title.trim())             throw badRequest('title required');

  const r = await query(
    `INSERT INTO notifications (recipient_id, sender_id, type, title, body)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, recipient_id, sender_id, type, title, body, is_read,
               delivered_at, created_at`,
    [recipientId, senderId, type, title.trim(), body],
  );

  // Stub for the External Services Layer — would call SendGrid/FCM here.
  // We mark delivered_at immediately in dev so the UI shows accurate state.
  console.log(`[notify] ${type} → ${recipientId}: ${title}`);
  await query(
    `UPDATE notifications SET delivered_at = NOW() WHERE id = $1`,
    [r.rows[0].id],
  );
  r.rows[0].delivered_at = new Date();

  return rowToNotif(r.rows[0]);
}

export async function listForRecipient(recipientId, limit = 50) {
  const r = await query(
    `SELECT id, recipient_id, sender_id, type, title, body, is_read,
            delivered_at, created_at
       FROM notifications
      WHERE recipient_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [recipientId, limit],
  );
  return r.rows.map(rowToNotif);
}

export async function markRead(notifId, recipientId) {
  const r = await query(
    `UPDATE notifications SET is_read = TRUE
      WHERE id = $1 AND recipient_id = $2
      RETURNING id`,
    [notifId, recipientId],
  );
  if (r.rowCount === 0) throw notFound('Notification not found');
}
