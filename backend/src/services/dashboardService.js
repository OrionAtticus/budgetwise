// DashboardService — server-side aggregation for the Personal Overview tab.
// Replaces the JSX prototype's per-render reduce()/filter() chains.
//
// Cached in-memory for 5 min by default (config.cache.dashboardTtlSeconds).
// Cache is invalidated whenever a transaction posts (TransactionService) or
// a category/goal write happens (BudgetService/GoalsService).

import { query } from '../db.js';
import {
  computeSavingsRate,
  computeCategoryStatus,
  computeGoalProgress,
  getCurrentPeriod,
  getPeriodStartDate,
} from '../domain/rules.js';
import { config } from '../config.js';
import * as cache from './cacheService.js';
import { listRecent } from './transactionService.js';
import { listCategories } from './budgetService.js';
import { listForMember as listGoals } from './goalsService.js';
import { notFound } from '../middleware/errors.js';

const cacheKey = (memberId) => `dash:${memberId}`;

async function getIncomeThisMonth(memberId, periodStart = getPeriodStartDate()) {
  const r = await query(
    `SELECT COALESCE(SUM(amount), 0)::float AS income
       FROM transactions
      WHERE member_id = $1
        AND type = 'income'
        AND date >= $2::date
        AND date < ($2::date + INTERVAL '1 month')`,
    [memberId, periodStart],
  );
  return Number(r.rows[0]?.income) || 0;
}

async function getIncomeThisMonthByMember(memberIds, periodStart = getPeriodStartDate()) {
  if (!memberIds.length) return new Map();

  const r = await query(
    `SELECT member_id, COALESCE(SUM(amount), 0)::float AS income
       FROM transactions
      WHERE member_id = ANY($1::uuid[])
        AND type = 'income'
        AND date >= $2::date
        AND date < ($2::date + INTERVAL '1 month')
      GROUP BY member_id`,
    [memberIds, periodStart],
  );

  return new Map(r.rows.map((row) => [row.member_id, Number(row.income) || 0]));
}

/**
 * Build the personal dashboard payload for a member.
 * Pulls from cache if present and fresh.
 */
export async function getDashboard(memberId, familyId) {
  const cached = cache.get(cacheKey(memberId));
  if (cached) return { ...cached, cached: true };

  const profileR = await query(
    `SELECT id, name, role, monthly_income, monthly_limit, primary_goal, accent_colour
       FROM user_profiles WHERE id = $1 AND family_id = $2`,
    [memberId, familyId],
  );
  if (profileR.rowCount === 0) throw notFound('Member not found');
  const p = profileR.rows[0];

  const periodStart = getPeriodStartDate();
  const [categories, recentTxs, goals, incomeThisMonth] = await Promise.all([
    listCategories(memberId),
    listRecent(memberId, 6),
    listGoals(memberId, familyId),
    getIncomeThisMonth(memberId, periodStart),
  ]);

  const totalSpent = categories.reduce((s, c) => s + c.amountSpent, 0);

  // The JSX uses profile.monthly_limit as the headline limit, BUT also shows
  // sum-of-category-limits on the Budget tab. We expose both.
  const profileLimit         = Number(p.monthly_limit) || 0;
  const sumCategoryLimits    = categories.reduce((s, c) => s + c.monthlyLimit, 0);
  const plannedMonthlyIncome = Number(p.monthly_income) || 0;
  const remaining            = profileLimit - totalSpent;
  const savingsRate          = computeSavingsRate(incomeThisMonth, totalSpent);

  const categoriesSummary = categories.map((c) => ({
    ...c,
    status:         computeCategoryStatus(c.amountSpent, c.monthlyLimit).status,
    statusLabel:    computeCategoryStatus(c.amountSpent, c.monthlyLimit).label,
    percentageUsed: c.monthlyLimit > 0 ? Math.round((c.amountSpent / c.monthlyLimit) * 100) : 0,
    overLimit:      c.amountSpent > c.monthlyLimit,
  }));

  const goalsSummary = goals.map((g) => ({
    ...g,
    progressPercent: computeGoalProgress(g.currentAmount, g.targetAmount),
  }));

  const payload = {
    period:               getCurrentPeriod(),
    profile: {
      id:            p.id,
      name:          p.name,
      role:          p.role,
      monthlyIncome: plannedMonthlyIncome,
      monthlyLimit:  profileLimit,
      primaryGoal:   p.primary_goal,
      accentColour:  p.accent_colour,
    },
    totals: {
      spent:              totalSpent,
      income:             incomeThisMonth,
      plannedIncome:      plannedMonthlyIncome,
      limit:              profileLimit,
      sumCategoryLimits,
      remaining,
      savingsRate,
      overBudget:         remaining < 0,
      onTrack:            remaining >= 0,
    },
    categories: categoriesSummary,
    recentTransactions: recentTxs,
    goals: goalsSummary,
    insight: buildSmartInsight({
      remaining,
      savingsRate,
      totalSpent,
      categories: categoriesSummary,
      hasIncome: incomeThisMonth > 0,
    }),
    cached: false,
  };

  cache.set(cacheKey(memberId), payload, config.cache.dashboardTtlSeconds);
  return payload;
}

/**
 * Rule-based "Smart Insight" generator. Pure function — no DB access,
 * no side effects. Picks the most relevant tip from a priority list
 * based on the member's current numbers.
 *
 * Order matters: over-budget warnings beat savings praise, which beat
 * generic spending advice, which beats the empty-state fallback.
 */
export function buildSmartInsight({ remaining, savingsRate, totalSpent, categories, hasIncome }) {
  // 1. Over budget — most urgent
  if (remaining < 0) {
    return `⚠️ Heads up — you're over budget by $${Math.abs(remaining).toFixed(2)}. Try cutting back on non-essentials this week.`;
  }

  // 2. Crushing it — celebrate at 20%+ savings rate
  //    Only meaningful when there's actually income flowing in.
  if (hasIncome && savingsRate >= 20) {
    return `⭐ Incredible job — you're saving ${savingsRate}% of your income. Consider moving the excess into your primary goal.`;
  }

  // 3. Highest expense category — actionable advice
  if (totalSpent > 0 && categories.length > 0) {
    // Don't mutate the input array — sort a copy
    const top = [...categories].sort((a, b) => b.amountSpent - a.amountSpent)[0];
    if (top && top.amountSpent > 0) {
      return `💡 Your biggest expense this month is ${top.name} ($${top.amountSpent.toFixed(2)}). Could you trim this next month?`;
    }
  }

  // 4. Empty-state fallback
  return 'Keep tracking your expenses to see personalised insights here!';
}

/**
 * Family-level rollup for the Admin Panel hero stats and Family tab.
 * Computed on demand — small enough that we don't bother caching for now.
 */
export async function getFamilyOverview(familyId) {
  const profilesR = await query(
    `SELECT id, name, role, monthly_income, monthly_limit
       FROM user_profiles WHERE family_id = $1`,
    [familyId],
  );
  const profiles = profilesR.rows;
  const memberIds = profiles.map((p) => p.id);
  const periodStart = getPeriodStartDate();

  // One aggregate query: total spend per member from their categories table.
  const [spendR, incomeMap] = await Promise.all([
    query(
      `SELECT p.id AS member_id, COALESCE(SUM(c.amount_spent), 0)::float AS spent
         FROM user_profiles p
         LEFT JOIN budget_categories c ON c.member_id = p.id
        WHERE p.family_id = $1
        GROUP BY p.id`,
      [familyId],
    ),
    getIncomeThisMonthByMember(memberIds, periodStart),
  ]);
  const spendMap = Object.fromEntries(spendR.rows.map((r) => [r.member_id, Number(r.spent)]));

  const members = profiles.map((p) => {
    const spent = spendMap[p.id] || 0;
    const limit = Number(p.monthly_limit) || 0;
    const incomeThisMonth = incomeMap.get(p.id) || 0;
    return {
      id:             p.id,
      name:           p.name,
      role:           p.role,
      monthlyIncome:  incomeThisMonth,
      plannedIncome:  Number(p.monthly_income) || 0,
      monthlyLimit:   limit,
      spent,
      remaining:      limit - spent,
      percentageUsed: limit > 0 ? Math.round((spent / limit) * 100) : 0,
      status:         computeCategoryStatus(spent, limit).status,
    };
  });

  const totalIncome = members.reduce((s, m) => s + m.monthlyIncome, 0);
  const totalSpent  = members.reduce((s, m) => s + m.spent,         0);

  const sharedGoalsR = await query(
    `SELECT id, name, icon, target_amount, current_amount, deadline
       FROM savings_goals
      WHERE family_id = $1 AND is_shared = TRUE AND is_archived = FALSE
      ORDER BY created_at DESC`,
    [familyId],
  );
  const sharedGoals = sharedGoalsR.rows.map((g) => ({
    id:              g.id,
    name:            g.name,
    icon:            g.icon,
    targetAmount:    Number(g.target_amount),
    currentAmount:   Number(g.current_amount),
    deadline:        g.deadline instanceof Date ? g.deadline.toISOString().slice(0, 10) : g.deadline,
    progressPercent: computeGoalProgress(Number(g.current_amount), Number(g.target_amount)),
  }));

  const personalGoalsR = await query(
    `SELECT COUNT(*)::int AS n FROM savings_goals
      WHERE family_id = $1 AND is_shared = FALSE AND is_archived = FALSE`,
    [familyId],
  );

  return {
    period:        getCurrentPeriod(),
    totalIncome,
    totalSpent,
    totalSavings:  totalIncome - totalSpent,
    savingsRate:   computeSavingsRate(totalIncome, totalSpent),
    members,
    sharedGoals,
    activeGoalsCount: sharedGoals.length + personalGoalsR.rows[0].n,
  };
}
