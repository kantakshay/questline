import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_URL, ApiError, apiFetch, GITEA_LOGIN_URL } from './client';

const jsonResponse = (status, body) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('apiFetch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('always sends cookies and returns parsed JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { user: { id: '1' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/api/me')).resolves.toEqual({ user: { id: '1' } });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_URL}/api/me`);
    expect(options.credentials).toBe('include');
    expect(options.body).toBeUndefined();
  });

  it('sends a JSON body with the right content type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch('/api/me', { method: 'PATCH', body: { experienceLevel: 'junior' } });
    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe('PATCH');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(options.body)).toEqual({ experienceLevel: 'junior' });
  });

  it('returns null for 204 No Content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(apiFetch('/auth/logout', { method: 'POST' })).resolves.toBeNull();
  });

  it('throws ApiError with the status and server message on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: 'sign in required' })));
    const err = await apiFetch('/api/me').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.message).toBe('sign in required');
  });

  it('still throws a useful ApiError when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>oops</html>', { status: 502 })));
    const err = await apiFetch('/api/me').catch((e) => e);
    expect(err.status).toBe(502);
    expect(err.message).toBe('Request failed (502)');
  });

  it('points the sign-in link at the backend Gitea login route', () => {
    expect(GITEA_LOGIN_URL).toBe(`${API_URL}/auth/gitea/login`);
  });
});
