import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { query, tx, close } from '../db.js';
import { config } from '../config.js';
import { getPeriodStartDate } from '../domain/rules.js';

const DEFAULT_PIN = '1234';
const args = process.argv.slice(2);
const SHOULD_RESET = args.includes('--reset');

async function reset() {
  console.log('[seed] --reset specified, truncating all tables…');
  await query(`
    TRUNCATE TABLE
      auth.sessions,
      auth.credentials,
      shared_goal_contributors,
      insights_cache,
      notifications,
      savings_goals,
      transactions,
      budget_categories,
      user_profiles,
      family_accounts
    RESTART IDENTITY CASCADE
  `);
}

async function alreadySeeded() {
  const r = await query(
    `SELECT 1 FROM family_accounts WHERE billing_email = 'mom@johnson.com' LIMIT 1`,
  );
  return r.rowCount > 0;
}

async function seed() {
  if (SHOULD_RESET) await reset();

  if (!SHOULD_RESET && (await alreadySeeded())) {
    console.log('[seed] Johnson family already present — skipping.');
    console.log('       (Use `npm run reset-and-seed` to wipe and re-seed.)');
    return;
  }

  const pinHash = await bcrypt.hash(DEFAULT_PIN, config.auth.bcryptCost);
  const periodStart = getPeriodStartDate();

  await tx(async (c) => {
    const fam = await c.query(
      `INSERT INTO family_accounts (name, plan_tier, billing_email, max_members)
       VALUES ('Johnson Family', 'family_pro', 'mom@johnson.com', 6)
       RETURNING id`,
    );
    const familyId = fam.rows[0].id;
    console.log(`[seed] Family created: ${familyId}`);

    const makeProfile = async (input) => {
      const p = await c.query(
        `INSERT INTO user_profiles
           (family_id, name, email, role, monthly_income, monthly_limit,
            primary_goal, accent_colour, onboarding_complete, income_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9)
         RETURNING id, name, role`,
        [
          familyId, input.name, input.email, input.role, input.monthlyIncome ?? 0,
          input.monthlyLimit ?? 0, input.primaryGoal ?? null, input.accentColour ?? '#3d6b52', input.incomeType ?? null,
        ],
      );
      const member = p.rows[0];
      await c.query(`INSERT INTO auth.credentials (member_id, pin_hash) VALUES ($1, $2)`, [member.id, pinHash]);
      console.log(`[seed]   ${member.role.padEnd(6)} ${member.name}  (PIN ${DEFAULT_PIN})`);
      return member.id;
    };

    const momId = await makeProfile({ name: 'Mom', email: 'mom@johnson.com', role: 'admin', monthlyIncome: 5200, monthlyLimit: 5200, primaryGoal: 'Save for family vacation', accentColour: '#3d6b52', incomeType: 'salaried' });
    const dadId = await makeProfile({ name: 'Dad', email: 'dad@johnson.com', role: 'member', monthlyIncome: 5800, monthlyLimit: 5800, primaryGoal: 'Pay down mortgage', accentColour: '#3b5fa0', incomeType: 'salaried' });
    const teenId = await makeProfile({ name: 'Jordan', email: 'jordan@johnson.com', role: 'teen', monthlyIncome: 200, monthlyLimit: 800, primaryGoal: 'New headphones', accentColour: '#8b5e3c', incomeType: 'student' });
    const kidId = await makeProfile({ name: 'Sam', email: null, role: 'junior', monthlyIncome: 0, monthlyLimit: 200, primaryGoal: 'New bike', accentColour: '#7c3d6e' });

    const catsForMember = async (memberId, cats) => {
      for (const c0 of cats) {
        await c.query(
          `INSERT INTO budget_categories
             (member_id, name, type, icon, monthly_limit, amount_spent, parent_group, period_start)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [memberId, c0.name, c0.type || 'expense', c0.icon, c0.limit, c0.spent ?? 0, c0.group ?? null, periodStart],
        );
      }
    };

    await catsForMember(momId, [
      { name: 'Salary / Wages', type: 'income', icon: '💼', limit: 0 },
      { name: 'Refunds',        type: 'income', icon: '↩️', limit: 0 },
      { name: 'Groceries',      type: 'expense', icon: '🛒', limit: 800, spent: 524, group: 'Housing & Food' },
      { name: 'Dining Out',     type: 'expense', icon: '🍽️', limit: 300, spent: 218, group: 'Housing & Food' },
      { name: 'Transport',      type: 'expense', icon: '🚗', limit: 400, spent: 312, group: 'Essentials' },
      { name: 'Utilities',      type: 'expense', icon: '⚡', limit: 300, spent: 285, group: 'Essentials' },
      { name: 'Entertainment',  type: 'expense', icon: '🎬', limit: 250, spent: 180 },
      { name: 'Shopping',       type: 'expense', icon: '🛍️', limit: 350, spent: 405 },
    ]);

    await catsForMember(dadId, [
      { name: 'Salary / Wages',    type: 'income', icon: '💼', limit: 0 },
      { name: 'Investment Income', type: 'income', icon: '📈', limit: 0 },
      { name: 'Groceries',         type: 'expense', icon: '🛒', limit: 600, spent: 478, group: 'Housing & Food' },
      { name: 'Dining Out',        type: 'expense', icon: '🍽️', limit: 400, spent: 392, group: 'Housing & Food' },
      { name: 'Transport',         type: 'expense', icon: '🚗', limit: 500, spent: 420, group: 'Essentials' },
      { name: 'Tech & Gadgets',    type: 'expense', icon: '💻', limit: 400, spent: 315 },
      { name: 'Hobbies',           type: 'expense', icon: '🎸', limit: 250, spent: 175 },
    ]);

    await catsForMember(teenId, [
      { name: 'Allowance',      type: 'income', icon: '💵', limit: 0 },
      { name: 'Fast Food',      type: 'expense', icon: '🍔', limit: 150, spent: 188 },
      { name: 'Gaming & Apps',  type: 'expense', icon: '🎮', limit: 100, spent: 95  },
      { name: 'Clothing',       type: 'expense', icon: '👕', limit: 200, spent: 145 },
      { name: 'Music',          type: 'expense', icon: '🎵', limit: 50,  spent: 25  },
    ]);

    await catsForMember(kidId, [
      { name: 'Allowance',       type: 'income', icon: '💵', limit: 0 },
      { name: 'Treats & Snacks', type: 'expense', icon: '🍭', limit: 60,  spent: 32 },
      { name: 'Toys & Games',    type: 'expense', icon: '🧸', limit: 80,  spent: 42 },
      { name: 'Books',           type: 'expense', icon: '📚', limit: 40,  spent: 12 },
    ]);

    const txsFor = async (memberId, txs) => {
      for (const t of txs) {
        await c.query(
          `INSERT INTO transactions (member_id, description, amount, type, category, date)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [memberId, t.desc, t.amount, t.type, t.cat, t.date],
        );
      }
    };
    const today = new Date();
    const d = (offset) => {
      const x = new Date(today);
      x.setDate(x.getDate() - offset);
      return x.toISOString().slice(0, 10);
    };

    await txsFor(momId, [
      { desc: 'Trader Joe\'s',     amount: 84.50, type: 'expense', cat: 'Groceries',       date: d(1) },
      { desc: 'Gas — Shell',       amount: 52.20, type: 'expense', cat: 'Transport',       date: d(2) },
      { desc: 'Salary deposit',    amount: 5200,  type: 'income',  cat: 'Salary / Wages',  date: d(3) },
      { desc: 'Dinner — Italian',  amount: 68.40, type: 'expense', cat: 'Dining Out',      date: d(4) },
    ]);
    await txsFor(dadId, [
      { desc: 'Costco run',        amount: 192.30, type: 'expense', cat: 'Groceries',      date: d(1) },
      { desc: 'Salary deposit',    amount: 5800,   type: 'income',  cat: 'Salary / Wages', date: d(3) },
      { desc: 'New keyboard',      amount: 145.00, type: 'expense', cat: 'Tech & Gadgets', date: d(5) },
    ]);
    await txsFor(teenId, [
      { desc: 'Chipotle',          amount: 14.50, type: 'expense', cat: 'Fast Food',       date: d(1) },
      { desc: 'Spotify',           amount: 10.99, type: 'expense', cat: 'Music',           date: d(7) },
      { desc: 'Weekly Allowance',  amount: 25.00, type: 'income',  cat: 'Allowance',       date: d(2) },
    ]);

    const goal = async (memberId, name, icon, target, current, deadline, isShared) =>
      c.query(
        `INSERT INTO savings_goals
           (member_id, family_id, name, icon, target_amount, current_amount, deadline, is_shared)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [memberId, familyId, name, icon, target, current, deadline, isShared],
      );

    await goal(momId, 'Family Vacation',   '🏖️', 6000,  3840,  '2026-08-01', true);
    await goal(momId, 'Home Renovation',   '🏠',  20000, 7200,  '2027-12-01', true);
    await goal(momId, 'Emergency Fund',    '🛡️', 10000, 6400,  null,         false);
    await goal(dadId, 'New Guitar',        '🎸',  1200,  680,   null,         false);
    await goal(teenId,'New Headphones',    '🎧',  300,   180,   null,         false);
    await goal(kidId, 'New Bicycle',       '🚲',  200,   86,    null,         false);
  });

  console.log(`\n[seed] Done. Default PIN for every member is ${DEFAULT_PIN}.`);
  console.log('       Listing profiles:\n');
  const r = await query(
    `SELECT name, role FROM user_profiles ORDER BY
       CASE role WHEN 'admin' THEN 0 WHEN 'member' THEN 1 WHEN 'teen' THEN 2 ELSE 3 END`,
  );
  r.rows.forEach((p) => console.log(`         ${p.role.padEnd(7)} ${p.name}`));
  console.log();
}

seed()
  .catch((err) => { console.error('[seed] failed:', err); process.exitCode = 1; })
  .finally(() => close());