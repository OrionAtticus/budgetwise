// Final error handler. Express recognises this as an error middleware
// because it has the (err, req, res, next) signature.

import { HttpError } from './errors.js';

export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error:   err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
  }

  // Unique-violation from Postgres → 409 Conflict
  if (err.code === '23505') {
    return res.status(409).json({
      error: 'Resource already exists',
      details: err.detail,
    });
  }

  // Foreign-key violation → 400 Bad Request (caller referenced something missing)
  if (err.code === '23503') {
    return res.status(400).json({
      error: 'Referenced resource not found',
      details: err.detail,
    });
  }

  // Check-constraint violation → 400 Bad Request
  if (err.code === '23514') {
    return res.status(400).json({
      error: 'Constraint violation',
      details: err.detail,
    });
  }

  // Anything else: log and return 500
  console.error('[error]', err);
  return res.status(500).json({ error: 'Internal server error' });
}

/** Wraps async route handlers so thrown errors hit errorHandler. */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
