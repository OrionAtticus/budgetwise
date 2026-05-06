// Savings goals API.

import { apiGet, apiPost, apiPatch } from './client.js';

export const listGoals = (memberId) => {
  const q = memberId ? `?memberId=${encodeURIComponent(memberId)}` : '';
  return apiGet(`/api/goals${q}`);
};

export const listFamilyGoals = () =>
  apiGet('/api/goals/family');

export const createGoal = (data) =>
  apiPost('/api/goals', data);

export const contributeToGoal = (id, amount) =>
  apiPost(`/api/goals/${id}/contribute`, { amount });

export const archiveGoal = (id) =>
  apiPatch(`/api/goals/${id}/archive`, {});
