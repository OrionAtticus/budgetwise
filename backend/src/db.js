// PostgreSQL connection pool. Single shared instance for the whole process.
// All other modules use `query()` / `tx()` from here rather than touching pg directly.

import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

// pg returns NUMERIC as string by default to avoid float precision loss.
// We override that for our DECIMAL(12,2) money columns so the API serves
// numbers, not strings — which is what the React frontend already expects.
// (Safe because JS numbers can represent every cent up to ~$90 trillion.)
pg.types.setTypeParser(1700, parseFloat); // OID 1700 = numeric

export const pool = new Pool({
  host:     config.db.host,
  port:     config.db.port,
  database: config.db.database,
  user:     config.db.user,
  password: config.db.password,
  // Reasonable pool sizing for a single-process dev API
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  // Connection-lost on idle clients — log and let pg auto-recreate
  console.error('[db] idle client error:', err.message);
});

/**
 * Run a single parameterised query.
 * Always use $1, $2, ... placeholders — never string-concat user input.
 */
export async function query(text, params = []) {
  return pool.query(text, params);
}

/**
 * Run a function inside a transaction. Auto-commits on success,
 * auto-rollbacks on any thrown error. The callback receives a client
 * that supports .query() with the same signature as the pool.
 *
 * Usage:
 *   const result = await tx(async (client) => {
 *     await client.query('INSERT ...');
 *     await client.query('UPDATE ...');
 *     return something;
 *   });
 */
export async function tx(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Health check — used by GET /health and on server startup */
export async function ping() {
  const r = await query('SELECT 1 AS ok');
  return r.rows[0]?.ok === 1;
}

/** Graceful shutdown */
export async function close() {
  await pool.end();
}
