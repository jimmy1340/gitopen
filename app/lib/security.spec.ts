import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DisallowedUrlError,
  MAX_RATE_LIMIT_KEYS,
  checkRateLimit,
  fetchPublicHttps,
  getRateLimitStoreSize,
  isPrivateOrLocalHost,
  resetRateLimitState,
  resolveRateLimit,
  withSecurity,
} from './security';

const hostOf = (url: string) => new URL(url).hostname;

describe('isPrivateOrLocalHost', () => {
  it.each([
    'https://localhost/x',
    'https://app.localhost/x',
    'https://printer.local/x',
    'https://db.internal/x',
    'https://127.0.0.1/x',
    'https://127.1/x',
    'https://2130706433/x',
    'https://0x7f000001/x',
    'https://10.0.0.5/x',
    'https://172.16.4.1/x',
    'https://192.168.1.10/x',
    'https://169.254.169.254/latest/meta-data',
    'https://100.64.0.1/x',
    'https://[::1]/x',
    'https://[fd00::1]/x',
    'https://[fe80::1]/x',
    'https://[::ffff:127.0.0.1]/x',
  ])('blocks %s', (url) => {
    expect(isPrivateOrLocalHost(hostOf(url))).toBe(true);
  });

  it.each([
    'https://github.com/a/b.git',
    'https://gitlab.com/a/b.git',
    'https://gitlab.example.org/a/b.git',
    'https://8.8.8.8/x',
    'https://172.32.0.1/x',
    'https://[2606:4700::1111]/x',
  ])('allows %s', (url) => {
    expect(isPrivateOrLocalHost(hostOf(url))).toBe(false);
  });
});

describe('withSecurity', () => {
  const ok = async () => new Response('ok');
  const call = (handler: ReturnType<typeof withSecurity>) =>
    handler({ request: new Request('http://example.test/api/thing'), params: {}, context: {} } as any);

  it('serves routes that do not ask for authentication', async () => {
    expect((await call(withSecurity(ok, { rateLimit: false }))).status).toBe(200);
  });

  it('rejects routes that require authentication because no auth backend exists', async () => {
    expect((await call(withSecurity(ok, { requireAuth: true, rateLimit: false }))).status).toBe(401);
  });
});

const limitedRequest = (endpoint: string, ip: string) =>
  new Request(`http://example.test${endpoint}`, { headers: { 'cf-connecting-ip': ip } });

describe('resolveRateLimit', () => {
  it('prefers the longest specific pattern over the /api/* catch-all', () => {
    expect(resolveRateLimit('/api/llmcall')).toEqual({ windowMs: 60_000, maxRequests: 10 });
    expect(resolveRateLimit('/api/github-stats')).toEqual({ windowMs: 60_000, maxRequests: 30 });
    expect(resolveRateLimit('/api/github-user')).toEqual({ windowMs: 60_000, maxRequests: 30 });
    expect(resolveRateLimit('/api/netlify-user')).toEqual({ windowMs: 60_000, maxRequests: 20 });
    expect(resolveRateLimit('/api/netlify-deploy')).toEqual({ windowMs: 60_000, maxRequests: 20 });
    expect(resolveRateLimit('/api/supabase-user')).toEqual({ windowMs: 15 * 60 * 1000, maxRequests: 100 });
    expect(resolveRateLimit('/api/gitlab-projects')).toEqual({ windowMs: 15 * 60 * 1000, maxRequests: 100 });
  });

  it('does not treat unrelated paths as API routes', () => {
    expect(resolveRateLimit('/health')).toBeUndefined();
    expect(resolveRateLimit('/apiculture')).toBeUndefined();
    expect(resolveRateLimit('/api')).toBeUndefined();
  });
});

describe('checkRateLimit', () => {
  beforeEach(() => {
    resetRateLimitState();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetRateLimitState();
  });

  it('blocks the next request once the specific limit is reached and resets when the window ends', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T00:00:00.000Z'));

    const hit = () => checkRateLimit(limitedRequest('/api/llmcall', '203.0.113.10'), '/api/llmcall');

    for (let i = 0; i < 10; i++) {
      expect(hit().allowed).toBe(true);
    }

    const blocked = hit();

    expect(blocked.allowed).toBe(false);
    expect(blocked.resetTime).toBe(Date.now() + 60_000);

    vi.advanceTimersByTime(60_000);

    expect(hit().allowed).toBe(true);
  });

  it('applies the github limit without consuming the catch-all budget for other routes', () => {
    const hit = (endpoint: string) => checkRateLimit(limitedRequest(endpoint, '203.0.113.20'), endpoint);

    for (let i = 0; i < 30; i++) {
      expect(hit('/api/github-user').allowed).toBe(true);
    }

    expect(hit('/api/github-user').allowed).toBe(false);
    expect(hit('/api/supabase-user').allowed).toBe(true);
  });

  it('does not store counters for paths without a rule', () => {
    expect(checkRateLimit(limitedRequest('/health', '203.0.113.21'), '/health').allowed).toBe(true);
    expect(getRateLimitStoreSize()).toBe(0);
  });

  it('caps the number of in-memory keys', () => {
    for (let i = 0; i < MAX_RATE_LIMIT_KEYS + 1; i++) {
      const result = checkRateLimit(limitedRequest('/api/llmcall', `198.51.100.${i}`), '/api/llmcall');

      expect(result.allowed).toBe(true);
    }

    expect(getRateLimitStoreSize()).toBeLessThanOrEqual(MAX_RATE_LIMIT_KEYS);
  });

  it('returns 429 from withSecurity once the matched limit is exhausted', async () => {
    let calls = 0;
    const handler = withSecurity(async () => {
      calls += 1;
      return new Response('ok');
    });

    let lastStatus = 0;

    for (let i = 0; i < 31; i++) {
      const response = await handler({
        request: limitedRequest('/api/github-stats', '203.0.113.30'),
        params: {},
        context: {},
      } as any);

      lastStatus = response.status;
    }

    expect(calls).toBe(30);
    expect(lastStatus).toBe(429);
  });
});

describe('fetchPublicHttps', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    'http://gitlab.com/api/v4/projects',
    'https://127.0.0.1/api',
    'https://2130706433/latest/meta-data',
    'https://169.254.169.254/latest/meta-data',
    'https://10.1.2.3/api',
    'https://[::1]/api',
    'https://user:secret@gitlab.com/api',
    'not a url',
  ])('rejects %s before fetching', async (target) => {
    await expect(
      fetchPublicHttps(target, { headers: { Authorization: 'Bearer secret-token' } }),
    ).rejects.toBeInstanceOf(DisallowedUrlError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches a public https host without following redirects automatically', async () => {
    fetchMock.mockResolvedValue(new Response('ok'));

    const response = await fetchPublicHttps('https://gitlab.com/api/v4/projects', {
      headers: { Authorization: 'Bearer user-token' },
    });

    expect(response.status).toBe(200);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe('https://gitlab.com/api/v4/projects');
    expect(init.redirect).toBe('manual');
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer user-token');
  });

  it('does not follow a redirect onto a private host', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { Location: 'https://127.0.0.1/admin' } }),
    );

    await expect(fetchPublicHttps('https://gitlab.com/api/v4/projects')).rejects.toBeInstanceOf(DisallowedUrlError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows a same-origin https redirect and keeps credentials', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: '/api/v4/projects?page=2' } }))
      .mockResolvedValueOnce(new Response('ok'));

    const response = await fetchPublicHttps('https://gitlab.com/api/v4/projects', {
      headers: { Authorization: 'Bearer user-token' },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];

    expect(url).toBe('https://gitlab.com/api/v4/projects?page=2');
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer user-token');
  });

  it('drops credentials when a redirect changes origin', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { Location: 'https://gitlab.example.org/api/v4/projects' } }),
      )
      .mockResolvedValueOnce(new Response('ok'));

    await fetchPublicHttps('https://gitlab.com/api/v4/projects', {
      headers: { Authorization: 'Bearer user-token' },
    });

    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];

    expect((init.headers as Headers).has('Authorization')).toBe(false);
  });
});
