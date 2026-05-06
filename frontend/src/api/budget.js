// Budget categories API.

import { apiGet, apiPost, apiPatch, apiDelete } from './client.js';

export const listCategories = (memberId) => {
  const q = memberId ? `?memberId=${encodeURIComponent(memberId)}` : '';
  return apiGet(`/api/budget/categories${q}`);
};

export const createCategory = (data) =>
  apiPost('/api/budget/categories', data);

export const updateCategory = (id, fields) =>
  apiPatch(`/api/budget/categories/${id}`, fields);

export const deleteCategory = (id) =>
  apiDelete(`/api/budget/categories/${id}`);

export const resetBudgetPeriod = (memberId) =>
  apiPost('/api/budget/reset', memberId ? { memberId } : {});
