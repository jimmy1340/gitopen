import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXTERNAL_API_PROBE_TTL_MS, loader, resetExternalApiProbeCache } from '~/routes/api.system.diagnostics';

const fetchMock = vi.fn();

const GITHUB_ENV_TOKEN = 'gh_env_secret_day4';
const NETLIFY_ENV_TOKEN = 'nf_env_secret_day4';
const GITHUB_CONTEXT_TOKEN = 'gh_context_secret_day4';
const NETLIFY_CONTEXT_TOKEN = 'nf_context_secret_day4';
const GITHUB_COOKIE_TOKEN = 'gh_cookie_secret_day4';
const NETLIFY_COOKIE_TOKEN = 'nf_cookie_secret_day4';

interface DiagnosticsBody {
  status: string;
  environment: { hasGithubToken: boolean; hasNetlifyToken: boolean };
  cookies: {
    hasGithubTokenCookie: boolean;
    hasGithubUsernameCookie: boolean;
    hasNetlifyCookie: boolean;
  };
  externalApis: {
    github: { isReachable: boolean; status?: number; statusText?: string; error?: string };
    netlify: { isReachable: boolean; status?: number; statusText?: string; error?: string };
  };
  technicalDetails: { serverTimestamp: string };
}

function load() {
  return loader({
    request: new Request('http://example.test/api/system/diagnostics', {
      headers: {
        Cookie: `githubToken=${GITHUB_COOKIE_TOKEN}; githubUsername=octocat; netlifyToken=${NETLIFY_COOKIE_TOKEN}`,
        'User-Agent': 'diagnostics-test',
      },
    }),
    params: {},
    context: {
      env: {
        GITHUB_ACCESS_TOKEN: GITHUB_CONTEXT_TOKEN,
        NETLIFY_TOKEN: NETLIFY_CONTEXT_TOKEN,
      },
    },
  } as any) as Promise<Response>;
}

function okResponse(body: string) {
  return new Response(body, { status: 200, statusText: 'OK' });
}

describe('GET /api/system/diagnostics', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    resetExternalApiProbeCache();
    vi.stubEnv('GITHUB_ACCESS_TOKEN', GITHUB_ENV_TOKEN);
    vi.stubEnv('NETLIFY_TOKEN', NETLIFY_ENV_TOKEN);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetExternalApiProbeCache();
  });

  it('reports reachability without returning any token and caches probes for the TTL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T00:00:00.000Z'));

    fetchMock.mockImplementation(async (url: string) => {
      if (url === 'https://api.github.com/zen') {
        return okResponse('Keep it logically awesome.');
      }

      if (url === 'https://api.netlify.com/api/v1/') {
        return okResponse('{}');
      }

      throw new Error(`unexpected fetch ${url}`);
    });

    const first = await load();
    const firstText = await first.clone().text();
    const firstBody = (await first.json()) as DiagnosticsBody;

    expect(first.status).toBe(200);
    expect(firstBody.status).toBe('success');
    expect(firstBody.environment).toMatchObject({ hasGithubToken: true, hasNetlifyToken: true });
    expect(firstBody.cookies).toEqual({
      hasGithubTokenCookie: true,
      hasGithubUsernameCookie: true,
      hasNetlifyCookie: true,
    });
    expect(firstBody.externalApis).toEqual({
      github: { isReachable: true, status: 200, statusText: 'OK' },
      netlify: { isReachable: true, status: 200, statusText: 'OK' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://api.github.com/zen',
      'https://api.netlify.com/api/v1/',
    ]);

    for (const secret of [
      GITHUB_ENV_TOKEN,
      NETLIFY_ENV_TOKEN,
      GITHUB_CONTEXT_TOKEN,
      NETLIFY_CONTEXT_TOKEN,
      GITHUB_COOKIE_TOKEN,
      NETLIFY_COOKIE_TOKEN,
    ]) {
      expect(firstText).not.toContain(secret);
      expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(secret);
    }

    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers((init as RequestInit | undefined)?.headers).get('Authorization')).toBeNull();
    }

    vi.advanceTimersByTime(1_000);

    const second = await load();
    const secondBody = (await second.json()) as DiagnosticsBody;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(secondBody.externalApis).toEqual(firstBody.externalApis);
    expect(secondBody.technicalDetails.serverTimestamp).not.toBe(firstBody.technicalDetails.serverTimestamp);

    vi.advanceTimersByTime(EXTERNAL_API_PROBE_TTL_MS - 1_000);

    await load();

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('caches a failed probe so a second call does not fetch again', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    const first = (await (await load()).json()) as DiagnosticsBody;
    const second = (await (await load()).json()) as DiagnosticsBody;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first.externalApis.github).toEqual({ isReachable: false, error: 'network down' });
    expect(first.externalApis.netlify).toEqual({ isReachable: false, error: 'network down' });
    expect(second.externalApis).toEqual(first.externalApis);
  });

  it('dedupes probes that are already in flight', async () => {
    const pending: Array<(value: Response) => void> = [];

    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          pending.push(resolve);
        }),
    );

    const first = load();
    const second = load();

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/zen');

    pending[0](okResponse('zen'));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.netlify.com/api/v1/');

    pending[1](okResponse('{}'));

    const [left, right] = await Promise.all([first, second]);
    const leftBody = (await left.json()) as DiagnosticsBody;
    const rightBody = (await right.json()) as DiagnosticsBody;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(leftBody.externalApis.github.isReachable).toBe(true);
    expect(rightBody.externalApis.netlify.isReachable).toBe(true);
  });
});
