// Shared transaction category lists for frontend dropdowns.
// Expense categories are budget-facing; income categories are transaction labels.

export const EXPENSE_CATEGORY_OPTIONS = [
  'Groceries',
  'Dining Out',
  'Transport',
  'Entertainment',
  'Shopping',
  'Utilities',
  'Housing',
  'Healthcare',
  'Insurance',
  'Subscriptions',
  'Travel',
  'Personal Care',
  'Home & Repairs',
  'Education',
  'Childcare',
  'Pets',
  'Gifts & Donations',
  'Tech & Gadgets',
  'Hobbies',
  'Fast Food',
  'Gaming & Apps',
  'Clothing',
  'School Supplies',
  'Music',
  'Treats & Snacks',
  'Toys & Games',
  'Books',
  'Art Supplies',
];

export const INCOME_CATEGORY_OPTIONS = [
  'Salary/Wages',
  'Side Job',
  'Freelance',
  'Passive Income',
  'Investment Income',
  'Rental Income',
  'Bonus',
  'Gifts',
  'Refunds/Reimbursements',
  'Other Income',
];

export const TEEN_EXPENSE_CATEGORY_OPTIONS = [
  'Fast Food',
  'Gaming & Apps',
  'Clothing',
  'Transport',
  'School Supplies',
  'Music',
];

export function mergeCategoryOptions(primary = [], fallback = []) {
  return Array.from(new Set([...primary.filter(Boolean), ...fallback.filter(Boolean)]));
}
