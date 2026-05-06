// Dashboard aggregation API. Server-side computed totals + recent activity.

import { apiGet } from './client.js';

/** Personal dashboard for the authenticated caller. */
export const fetchMyDashboard = () =>
  apiGet('/api/dashboard/me');

/** Another member's dashboard (admin only). */
export const fetchMemberDashboard = (memberId) =>
  apiGet(`/api/dashboard/member/${memberId}`);

/** Family-wide rollup for the Admin Panel hero stats and Family tab. */
export const fetchFamilyDashboard = () =>
  apiGet('/api/dashboard/family');
