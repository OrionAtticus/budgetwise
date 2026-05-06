// Express app construction. Kept separate from index.js so future tests
// can `import { createApp } from './server.js'` without binding to a port.

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import { config } from './config.js';
import { ping } from './db.js';
import * as cache from './services/cacheService.js';
import { errorHandler } from './middleware/errorHandler.js';

import { authRouter }          from './routes/auth.js';
import { familyRouter, profilesRouter, publicRouter } from './routes/family.js';
import { transactionsRouter }  from './routes/transactions.js';
import { budgetRouter }        from './routes/budget.js';
import { goalsRouter }         from './routes/goals.js';
import { notificationsRouter } from './routes/notifications.js';
import { dashboardRouter }     from './routes/dashboard.js';

export function createApp() {
  const app = express();

  // Security & infra middleware
  app.use(helmet({
    // Disable strict CSP since we serve no HTML — frontend is on its own origin
    contentSecurityPolicy: false,
  }));
  app.use(cors({
    origin: config.corsOrigin,
    credentials: false,            // we use Bearer tokens, not cookies
  }));
  // 1 MB body limit — large enough for a 500-row bulk transaction import,
  // small enough to reject obvious abuse. The bulk endpoint enforces
  // its own 500-row cap separately.
  app.use(express.json({ limit: '1mb' }));
  if (config.nodeEnv !== 'test') {
    app.use(morgan('dev'));
  }

  // Health endpoints — useful for the docker compose healthcheck and humans
  app.get('/health', async (_req, res) => {
    let dbOk = false;
    try { dbOk = await ping(); } catch { dbOk = false; }
    res.status(dbOk ? 200 : 503).json({
      status: dbOk ? 'ok' : 'degraded',
      db:     dbOk,
      cache:  cache.stats(),
      time:   new Date().toISOString(),
    });
  });

  // Mount routers
  app.use('/api/public',        publicRouter);          // unauthenticated discovery
  app.use('/api/auth',          authRouter);
  app.use('/api',               familyRouter);          // /api/family
  app.use('/api/profiles',      profilesRouter);
  app.use('/api/transactions',  transactionsRouter);
  app.use('/api/budget',        budgetRouter);
  app.use('/api/goals',         goalsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/dashboard',     dashboardRouter);

  // 404 for any unmatched /api/*
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found' }));

  // Final error handler must be LAST
  app.use(errorHandler);

  return app;
}
