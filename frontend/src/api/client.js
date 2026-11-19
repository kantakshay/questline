// Single place the frontend talks to the Questline API.
// Cookies carry the session, so every request uses credentials: 'include'.

export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function apiFetch(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error || `Request failed (${res.status})`);
  return data;
}

// A plain link, not fetch: the browser must actually navigate to Gitea's consent page.
export const GITEA_LOGIN_URL = `${API_URL}/auth/gitea/login`;

export const getMe = () => apiFetch('/api/me').then((d) => d.user);
export const setExperienceLevel = (experienceLevel) =>
  apiFetch('/api/me', { method: 'PATCH', body: { experienceLevel } }).then((d) => d.user);
export const logout = () => apiFetch('/auth/logout', { method: 'POST' });
