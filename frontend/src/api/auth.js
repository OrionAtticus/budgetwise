// Auth API. Uses the anonymous flag for login routes since they don't
// take a bearer token (you don't have one yet).
//
// Convention: every function returns the API's raw JSON body. The caller
// is responsible for setting the token via setToken() if needed.

import { apiGet, apiPost, setToken, clearToken } from './client.js';

/**
 * PIN login. Returns { token, expiresAt, member, family }.
 * Throws ApiError on wrong PIN (401), lockout (423), etc.
 */
export async function login(memberId, pin) {
  const result = await apiPost('/api/auth/login', { memberId, pin }, { anonymous: true });
  if (result?.token) setToken(result.token);
  return result;
}

/** Admin PIN bypass per spec §2.1. Returns same shape as login. */
export async function adminLogin(memberId) {
  const result = await apiPost('/api/auth/admin-login', { memberId }, { anonymous: true });
  if (result?.token) setToken(result.token);
  return result;
}

/** Logout the current session. Always clears the token even on error. */
export async function logout() {
  try { await apiPost('/api/auth/logout', undefined); }
  catch {/* ignore — we're going to clear anyway */}
  clearToken();
}

/** Returns { member, family } for the current session, or null if not logged in. */
export async function fetchMe() {
  return apiGet('/api/auth/me');
}
