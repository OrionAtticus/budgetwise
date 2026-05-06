// Family + profiles API.

import { apiGet, apiPost, apiPatch, apiDelete } from './client.js';

export const fetchFamily = () =>
  apiGet('/api/family');

export const listProfiles = () =>
  apiGet('/api/profiles');

export const getProfile = (id) =>
  apiGet(`/api/profiles/${id}`);

export const createProfile = (data) =>
  apiPost('/api/profiles', data);

export const updateProfile = (id, fields) =>
  apiPatch(`/api/profiles/${id}`, fields);

export const setPin = (id, pin) =>
  apiPatch(`/api/profiles/${id}/pin`, { pin });

export const deleteProfile = (id) =>
  apiDelete(`/api/profiles/${id}`);
