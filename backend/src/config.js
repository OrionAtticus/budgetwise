// Centralised configuration. Reads from .env via dotenv (loaded in index.js).
// Every other module imports from here rather than touching process.env directly.

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  port:        num(process.env.PORT, 3000),
  nodeEnv:     process.env.NODE_ENV || 'development',
  corsOrigin:  process.env.CORS_ORIGIN || 'http://localhost:5173',

  db: {
    host:     process.env.PGHOST     || 'localhost',
    port:     num(process.env.PGPORT, 5432),
    database: process.env.PGDATABASE || 'budgetwise',
    user:     process.env.PGUSER     || 'budgetwise',
    password: process.env.PGPASSWORD || 'budgetwise_dev',
  },

  auth: {
    sessionTtlHours:    num(process.env.SESSION_TTL_HOURS, 24),
    bcryptCost:         num(process.env.BCRYPT_COST, 12),
    pinMaxAttempts:     num(process.env.PIN_MAX_ATTEMPTS, 5),
    pinLockoutMinutes:  num(process.env.PIN_LOCKOUT_MINUTES, 15),
  },

  cache: {
    dashboardTtlSeconds: num(process.env.DASHBOARD_CACHE_TTL_SECONDS, 300),
  },
};
