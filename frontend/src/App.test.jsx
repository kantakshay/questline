import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import * as api from './api/client';
import { loginErrorMessage } from './pages/Login';

vi.mock('./api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getMe: vi.fn(), setExperienceLevel: vi.fn(), logout: vi.fn() };
});

const baseUser = {
  id: '1',
  username: 'ravi',
  displayName: 'Ravi',
  role: 'student',
  experienceLevel: 'junior',
  needsOnboarding: false,
};

describe('App sign-in flow', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));
  afterEach(() => cleanup());

  it('shows the sign-in screen with a link to the Gitea login when not signed in', async () => {
    api.getMe.mockRejectedValue(new api.ApiError(401, 'sign in required'));
    render(<App />);
    const link = await screen.findByRole('link', { name: 'Sign in with Gitea' });
    expect(link.getAttribute('href')).toBe(api.GITEA_LOGIN_URL);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a friendly message for ?login_error and removes it from the URL', async () => {
    window.history.replaceState(null, '', '/?login_error=denied');
    api.getMe.mockRejectedValue(new api.ApiError(401, 'sign in required'));
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Sign-in was cancelled on Gitea. Ready when you are.',
    );
    expect(window.location.search).toBe('');
  });

  it('never shows raw error codes: unknown codes fall back to a generic message', () => {
    expect(loginErrorMessage('<script>alert(1)</script>')).toBe(loginErrorMessage('server'));
    expect(loginErrorMessage(null)).toBeNull();
  });

  it('shows a server-down message for errors other than 401', async () => {
    api.getMe.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<App />);
    expect(await screen.findByText(/Can't reach the Questline server/)).toBeTruthy();
  });

  it('asks a new user to pick a level, saves it, then shows the dashboard', async () => {
    api.getMe.mockResolvedValue({ ...baseUser, experienceLevel: null, needsOnboarding: true });
    api.setExperienceLevel.mockResolvedValue({ ...baseUser, experienceLevel: 'senior' });
    render(<App />);

    const submit = await screen.findByRole('button', { name: 'Start my first mission' });
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /Senior/ }));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => expect(api.setExperienceLevel).toHaveBeenCalledWith('senior'));
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('keeps the user on onboarding and shows the error if saving fails', async () => {
    api.getMe.mockResolvedValue({ ...baseUser, experienceLevel: null, needsOnboarding: true });
    api.setExperienceLevel.mockRejectedValue(new api.ApiError(409, 'experience level is already set'));
    render(<App />);

    fireEvent.click(await screen.findByRole('radio', { name: /Junior/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start my first mission' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'experience level is already set');
    expect(screen.getByRole('button', { name: 'Start my first mission' }).disabled).toBe(false);
  });

  it('shows the dashboard for an onboarded user and signs out back to the login screen', async () => {
    api.getMe.mockResolvedValue(baseUser);
    api.logout.mockResolvedValue(null);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('link', { name: 'Sign in with Gitea' })).toBeTruthy();
    expect(api.logout).toHaveBeenCalledOnce();
  });

  it('still signs the user out locally if the logout request fails', async () => {
    api.getMe.mockResolvedValue(baseUser);
    api.logout.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('link', { name: 'Sign in with Gitea' })).toBeTruthy();
  });
});
