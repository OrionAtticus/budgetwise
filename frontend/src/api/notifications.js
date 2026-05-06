// Notifications API.

import { apiGet, apiPost } from './client.js';

export const listNotifications = (limit = 50) =>
  apiGet(`/api/notifications?limit=${limit}`);

export const sendNotification = (data) =>
  apiPost('/api/notifications', data);

export const markNotificationRead = (id) =>
  apiPost(`/api/notifications/${id}/read`, undefined);
