import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { action } from '~/routes/api.github-user';
import { resetRateLimitState } from '~/lib/security';

const fetchMock = vi.fn();

const serverContext = {
  cloudflare: {
    env: {
      GITHUB_TOKEN: 'server-secret-token',
      VITE_GITHUB_ACCESS_TOKEN: 'server-vite-token',
    },
  },
};

function post(body: unknown, extra: { cookie?: string; context?: unknown } = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'cf-connecting-ip': '203.0.113.80',
  };

  if (extra.cookie) {
    headers.Cookie = extra.cookie;
  }

  return action({
    request: new Request('http://example.test/api/github-user', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    params: {},
    context: extra.context === undefined ? serverContext : extra.context,
  } as any) as Promise<Response>;
}

describe('POST /api/github-user', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    resetRateLimitState();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetRateLimitState();
  });

  it('does not export a server or cookie GitHub token', async () => {
    const cookie = `apiKeys=${encodeURIComponent(JSON.stringify({ GITHUB_API_KEY: 'cookie-github-token' }))}`;
    const response = await post({ action: 'get_token' }, { cookie });
    const text = await response.text();

    expect(response.status).toBe(403);
    expect(text).toContain('not exported');
    expect(text).not.toContain('server-secret-token');
    expect(text).not.toContain('server-vite-token');
    expect(text).not.toContain('cookie-github-token');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses get_token even when no token is configured and the cookie is corrupt', async () => {
    const response = await post({ action: 'get_token' }, { cookie: 'apiKeys=%', context: {} });

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still lists repositories with the server token', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    const response = await post({ action: 'get_repos' });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(body)).toEqual({ repos: [] });
    expect(body).not.toContain('server-secret-token');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(url).toContain('https://api.github.com/user/repos');
    expect(headers.Authorization).toBe('Bearer server-secret-token');
  });

  it('treats a corrupt apiKeys cookie as empty and still uses the server token', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    const response = await post({ action: 'get_repos' }, { cookie: 'apiKeys=not-json' });

    expect(response.status).toBe(200);

    const headers = (fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;

    expect(headers.Authorization).toBe('Bearer server-secret-token');
  });

  it.each(['owner/repo', 'xKevIsDev/bolt-expo-template', 'acme/repo.js'])('lists branches for %s', async (repo) => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            name: 'main',
            commit: { sha: 'abc123', url: `https://api.github.com/repos/${repo}/commits/abc123` },
            protected: false,
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const response = await post({ action: 'get_branches', repo });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      branches: [
        {
          name: 'main',
          commit: { sha: 'abc123', url: `https://api.github.com/repos/${repo}/commits/abc123` },
          protected: false,
        },
      ],
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(url).toBe(`https://api.github.com/repos/${repo}/branches`);
    expect(headers.Authorization).toBe('Bearer server-secret-token');
  });

  it.each(['../x', 'foo/bar?x', 'foo/bar#x', 'foo bar/baz', 'owner/..', './x', 'foo/bar/baz'])(
    'rejects get_branches repo %s without calling GitHub',
    async (repo) => {
      const response = await post({ action: 'get_branches', repo });
      const text = await response.text();

      expect(response.status).toBe(400);
      expect(text).toContain('not allowed');
      expect(text).not.toContain('server-secret-token');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
