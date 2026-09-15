import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  authenticatedFetch,
  issueWebSocketTicket,
  prepareAccountStorage,
  resetAuthTokenProvider,
  setAuthTokenProvider,
} from './sessionClient';

afterEach(() => resetAuthTokenProvider());

describe('authenticated API transport', () => {
  it('uses the deterministic development session when no provider secrets exist', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));

    await authenticatedFetch(fetcher, 'https://api.test/resource', {
      headers: { 'Content-Type': 'application/json' },
    });

    const headers = new Headers(fetcher.mock.calls[0][1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer dev-session-token');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('uses the current Clerk token provider instead of a client user id', async () => {
    setAuthTokenProvider(async () => 'verified-session-token');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));

    await authenticatedFetch(fetcher, 'https://api.test/resource');

    const headers = new Headers(fetcher.mock.calls[0][1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer verified-session-token');
    expect(headers.has('x-user-id')).toBe(false);
  });

  it('issues a short-lived ticket over REST and never places the bearer token in the WS URL', async () => {
    setAuthTokenProvider(async () => 'secret-session-token');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ticket: 'opaque ticket', expires_in_seconds: 30 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const ticket = await issueWebSocketTicket({ baseUrl: 'https://api.test/', fetcher });

    expect(ticket).toBe('opaque ticket');
    expect(fetcher.mock.calls[0][0]).toBe('https://api.test/api/session/ws-ticket');
    expect(String(fetcher.mock.calls[0][0])).not.toContain('secret-session-token');
  });

  it('starts verified accounts empty and clears the previous account before a switch', () => {
    localStorage.setItem('vslingo:writing', 'anonymous draft');
    prepareAccountStorage('user-a');
    expect(localStorage.getItem('vslingo:writing')).toBeNull();

    localStorage.setItem('vslingo:writing', 'user A draft');
    prepareAccountStorage('user-a');
    expect(localStorage.getItem('vslingo:writing')).toBe('user A draft');

    prepareAccountStorage('user-b');
    expect(localStorage.getItem('vslingo:writing')).toBeNull();
  });
});
