// Thin fetch wrapper. Attaches the bearer token from sessionStorage,
// parses JSON, and turns non-2xx responses into thrown ApiError objects
// that carry status code and parsed body.
//
// Why sessionStorage instead of localStorage:
//   - Tab-scoped: closing the tab logs out, mirroring TV-style "switch profile"
//   - Not shared with other tabs (matches single-active-profile model)
//   - Survives page refresh, which is what we actually need

const TOKEN_KEY = 'bw_session_token';

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/* ── Token storage ────────────────────────────────────────────────── */

export function getToken() {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setToken(token) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {/* sessionStorage might be disabled — degrade gracefully */}
}

export function clearToken() {
  setToken(null);
}

/* ── Core request function ────────────────────────────────────────── */

/**
 * Make an API request. Returns parsed JSON body on success, throws
 * ApiError on non-2xx.
 *
 * @param {string} path   Path beginning with /api/...
 * @param {object} [opts] Optional { method, body, signal, anonymous }
 *                        anonymous: skip the Authorization header even if a token exists
 */
async function request(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };

  if (!opts.anonymous) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const init = {
    method: opts.method || 'GET',
    headers,
    signal: opts.signal,
  };
  if (opts.body !== undefined) {
    init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }

  let res;
  try {
    res = await fetch(path, init);
  } catch (err) {
    // Network-level failure — DNS error, server down, CORS, etc.
    throw new ApiError(0, `Network error: ${err.message}`, null);
  }

  // No body (e.g. 204) — return null without parsing
  let body = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try { body = await res.json(); }
    catch { body = null; }
  } else {
    try { body = await res.text(); } catch { body = null; }
  }

  if (!res.ok) {
    const message = (body && typeof body === 'object' && body.error) || res.statusText || 'Request failed';
    throw new ApiError(res.status, message, body);
  }

  return body;
}

/* ── Convenience verbs ────────────────────────────────────────────── */

export const apiGet    = (path, opts)            => request(path,                            opts);
export const apiPost   = (path, body, opts)      => request(path, { ...opts, method: 'POST',   body });
export const apiPatch  = (path, body, opts)      => request(path, { ...opts, method: 'PATCH',  body });
export const apiDelete = (path, opts)            => request(path, { ...opts, method: 'DELETE'    });
