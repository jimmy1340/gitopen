import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loader } from '~/routes/api.github-stats';
import { resetRateLimitState } from '~/lib/security';

const fetchMock = vi.fn();

const serverContext = {
  cloudflare: {
    env: {
      GITHUB_TOKEN: 'stats-server-token',
    },
  },
};

const USER = {
  login: 'octocat',
  avatar_url: 'https://avatars.githubusercontent.com/u/1',
  html_url: 'https://github.com/octocat',
  name: 'The Octocat',
  bio: 'bio',
  public_repos: 2,
  followers: 8,
  following: 1,
  public_gists: 3,
  created_at: '2011-01-25T18:44:36Z',
  updated_at: '2026-10-01T00:00:00Z',
};

const REPO_PAGE = (page: number) =>
  `https://api.github.com/user/repos?sort=updated&per_page=100&page=${page}&affiliation=owner,organization_member`;

function jsonResponse(body: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function makeRepo(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: index + 1,
    name: `repo-${index}`,
    full_name: `octocat/repo-${index}`,
    html_url: `https://github.com/octocat/repo-${index}`,
    clone_url: `https://github.com/octocat/repo-${index}.git`,
    description: 'desc',
    private: false,
    language: 'TypeScript',
    updated_at: '2026-09-01T00:00:00Z',
    stargazers_count: 1,
    forks_count: 2,
    watchers_count: 3,
    topics: ['bolt'],
    fork: false,
    archived: false,
    size: 10,
    default_branch: 'main',
    languages_url: `https://api.github.com/repos/octocat/repo-${index}/languages`,
    ...overrides,
  };
}

interface StatsBody {
  repos: unknown[];
  organizations: unknown[];
  recentActivity: unknown[];
  languages: Record<string, number>;
  totalGists: number;
  publicRepos: number;
  privateRepos: number;
  stars: number;
  forks: number;
  totalStars: number;
  totalForks: number;
  followers: number;
  publicGists: number;
  privateGists: number;
}

function getStats(ip: string) {
  return loader({
    request: new Request('http://example.test/api/github-stats', {
      headers: { 'cf-connecting-ip': ip },
    }),
    params: {},
    context: serverContext,
  } as any) as Promise<Response>;
}

describe('GET /api/github-stats', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    resetRateLimitState();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetRateLimitState();
  });

  it('keeps the GitHubStats shape for a single page of repos', async () => {
    const repos = [
      {
        id: 11,
        name: 'alpha',
        full_name: 'octocat/alpha',
        html_url: 'https://github.com/octocat/alpha',
        clone_url: 'https://github.com/octocat/alpha.git',
        description: 'Alpha',
        private: false,
        language: 'TypeScript',
        updated_at: '2026-09-01T00:00:00Z',
        stargazers_count: 4,
        forks_count: 1,
        watchers_count: 6,
        topics: ['a', 'b'],
        fork: false,
        archived: false,
        size: 42,
        default_branch: 'main',
        languages_url: 'https://api.github.com/repos/octocat/alpha/languages',
      },
      {
        id: 12,
        name: 'beta',
        full_name: 'octocat/beta',
        html_url: 'https://github.com/octocat/beta',
        description: null,
        private: true,
        language: null,
        updated_at: '2026-08-01T00:00:00Z',
      },
    ];

    fetchMock.mockImplementation((url: string) => {
      const href = String(url);

      if (href === 'https://api.github.com/user') {
        return Promise.resolve(jsonResponse(USER));
      }

      if (href === REPO_PAGE(1)) {
        return Promise.resolve(jsonResponse(repos));
      }

      if (href === 'https://api.github.com/repos/octocat/alpha/branches?per_page=1') {
        return Promise.resolve(
          jsonResponse([], { Link: '<https://api.github.com/repos/octocat/alpha/branches?page=3>; rel="last"' }),
        );
      }

      if (href === 'https://api.github.com/repos/octocat/beta/branches?per_page=1') {
        return Promise.resolve(jsonResponse([{ name: 'main' }]));
      }

      return Promise.reject(new Error(`unexpected fetch ${href}`));
    });

    const response = await getStats('203.0.113.91');
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).not.toContain('stats-server-token');

    const body = JSON.parse(text);
    const { lastUpdated, ...rest } = body;

    expect(lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(rest).toEqual({
      repos: [
        {
          id: 11,
          name: 'alpha',
          full_name: 'octocat/alpha',
          html_url: 'https://github.com/octocat/alpha',
          clone_url: 'https://github.com/octocat/alpha.git',
          description: 'Alpha',
          private: false,
          language: 'TypeScript',
          updated_at: '2026-09-01T00:00:00Z',
          stargazers_count: 4,
          forks_count: 1,
          watchers_count: 6,
          topics: ['a', 'b'],
          fork: false,
          archived: false,
          size: 42,
          default_branch: 'main',
          languages_url: 'https://api.github.com/repos/octocat/alpha/languages',
        },
        {
          id: 12,
          name: 'beta',
          full_name: 'octocat/beta',
          html_url: 'https://github.com/octocat/beta',
          clone_url: '',
          description: null,
          private: true,
          language: null,
          updated_at: '2026-08-01T00:00:00Z',
          stargazers_count: 0,
          forks_count: 0,
          watchers_count: 0,
          topics: [],
          fork: false,
          archived: false,
          size: 0,
          default_branch: 'main',
          languages_url: '',
        },
      ],
      organizations: [],
      recentActivity: [],
      languages: {},
      totalGists: 3,
      publicRepos: 1,
      privateRepos: 1,
      stars: 4,
      forks: 1,
      totalStars: 4,
      totalForks: 1,
      followers: 8,
      publicGists: 3,
      privateGists: 0,
    });
    expect(body.repos[0]).not.toHaveProperty('branches_count');

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));

    expect(urls).toEqual([
      'https://api.github.com/user',
      REPO_PAGE(1),
      'https://api.github.com/repos/octocat/alpha/branches?per_page=1',
      'https://api.github.com/repos/octocat/beta/branches?per_page=1',
    ]);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer stats-server-token',
    });
    expect(urls.some((url) => url.includes('page=2'))).toBe(false);
  });

  it('stops after 10 full pages and keeps at most 5 branch requests in flight', async () => {
    let repoPages = 0;
    let branchCalls = 0;
    let inFlight = 0;
    let maxInFlight = 0;

    fetchMock.mockImplementation((url: string) => {
      const href = String(url);

      if (href === 'https://api.github.com/user') {
        return Promise.resolve(jsonResponse({ ...USER, followers: 9, public_gists: 7 }));
      }

      if (href.startsWith('https://api.github.com/user/repos?')) {
        repoPages += 1;

        if (repoPages > 12) {
          return Promise.reject(new Error(`repo pagination unbounded (${repoPages})`));
        }

        const page = Number(new URL(href).searchParams.get('page'));

        return Promise.resolve(
          jsonResponse(Array.from({ length: 100 }, (_, offset) => makeRepo((page - 1) * 100 + offset))),
        );
      }

      if (href.includes('/branches?per_page=1')) {
        branchCalls += 1;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);

        return new Promise((resolve) => {
          setTimeout(() => {
            inFlight -= 1;
            resolve(jsonResponse([]));
          }, 0);
        });
      }

      return Promise.reject(new Error(`unexpected fetch ${href}`));
    });

    const response = await getStats('203.0.113.92');
    const body = (await response.json()) as StatsBody;

    expect(response.status).toBe(200);
    expect(repoPages).toBe(10);
    expect(branchCalls).toBe(50);
    expect(maxInFlight).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(1 + 10 + 50);
    expect(body.repos).toHaveLength(1000);
    expect(body.publicRepos).toBe(1000);
    expect(body.privateRepos).toBe(0);
    expect(body.totalStars).toBe(1000);
    expect(body.totalForks).toBe(2000);
    expect(body.stars).toBe(1000);
    expect(body.forks).toBe(2000);
    expect(body.followers).toBe(9);
    expect(body.totalGists).toBe(7);
    expect(body.publicGists).toBe(7);
    expect(body.organizations).toEqual([]);
    expect(body.recentActivity).toEqual([]);
    expect(body.languages).toEqual({});
    expect(body.privateGists).toBe(0);

    const repoPagesRequested = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.startsWith('https://api.github.com/user/repos?'));

    expect(repoPagesRequested).toEqual(Array.from({ length: 10 }, (_, index) => REPO_PAGE(index + 1)));
    expect(String(fetchMock.mock.calls[11][0])).toBe('https://api.github.com/repos/octocat/repo-0/branches?per_page=1');
  });

  it('stops repo pagination when a page has fewer than 100 items', async () => {
    fetchMock.mockImplementation((url: string) => {
      const href = String(url);

      if (href === 'https://api.github.com/user') {
        return Promise.resolve(jsonResponse(USER));
      }

      if (href === REPO_PAGE(1)) {
        return Promise.resolve(jsonResponse(Array.from({ length: 100 }, (_, offset) => makeRepo(offset))));
      }

      if (href === REPO_PAGE(2)) {
        return Promise.resolve(
          jsonResponse(Array.from({ length: 17 }, (_, offset) => makeRepo(100 + offset, { private: true }))),
        );
      }

      if (href.startsWith('https://api.github.com/user/repos?')) {
        return Promise.reject(new Error(`fetched past a short page: ${href}`));
      }

      if (href.includes('/branches?per_page=1')) {
        return Promise.resolve(jsonResponse([]));
      }

      return Promise.reject(new Error(`unexpected fetch ${href}`));
    });

    const response = await getStats('203.0.113.93');
    const body = (await response.json()) as StatsBody;
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));

    expect(response.status).toBe(200);
    expect(body.repos).toHaveLength(117);
    expect(body.publicRepos).toBe(100);
    expect(body.privateRepos).toBe(17);
    expect(urls.filter((url) => url.startsWith('https://api.github.com/user/repos?'))).toEqual([
      REPO_PAGE(1),
      REPO_PAGE(2),
    ]);
    expect(urls.filter((url) => url.includes('/branches?per_page=1'))).toHaveLength(50);
    expect(fetchMock).toHaveBeenCalledTimes(1 + 2 + 50);
  });
});
