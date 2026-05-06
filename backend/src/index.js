// Entry point. Loads .env, builds the app, starts listening,
// and wires up graceful shutdown.

import 'dotenv/config';
import { createApp } from './server.js';
import { config } from './config.js';
import { ping, close } from './db.js';
import { purgeExpiredSessions } from './services/authService.js';

const app = createApp();

async function start() {
  // Verify DB connectivity before binding the port — fail-fast in dev
  try {
    const ok = await ping();
    if (!ok) throw new Error('SELECT 1 returned unexpected result');
    console.log(`[startup] DB connection OK (${config.db.host}:${config.db.port}/${config.db.database})`);
  } catch (err) {
    console.error(`[startup] DB connection FAILED: ${err.message}`);
    console.error('  Is Postgres running? Try: docker compose up -d');
    process.exit(1);
  }

  // Best-effort cleanup of expired sessions on boot
  try {
    const purged = await purgeExpiredSessions();
    if (purged > 0) console.log(`[startup] Purged ${purged} expired session(s)`);
  } catch (err) {
    console.warn(`[startup] Session cleanup skipped: ${err.message}`);
  }

  const server = app.listen(config.port, () => {
    console.log(`[startup] BudgetWise API listening on http://localhost:${config.port}`);
    console.log(`[startup] CORS origin: ${config.corsOrigin}`);
    console.log(`[startup] Try:  curl http://localhost:${config.port}/health`);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n[shutdown] Received ${signal}, closing...`);
    server.close(async () => {
      await close();
      process.exit(0);
    });
    // Force after 10 s
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
