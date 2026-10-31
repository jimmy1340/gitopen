import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { isGitHubRepoCoordinate, isGitHubRepoSegment } from '~/lib/api/github-coordinates';
import { action as branchesAction, loader as branchesLoader } from '~/routes/api.github-branches';
import { loader as templateLoader } from '~/routes/api.github-template';
import { resetRateLimitState } from '~/lib/security';

const fetchMock = vi.fn();

const serverContext = {
  cloudflare: {
    env: {
      GITHUB_TOKEN: 'server-secret-token',
    },
  },
};

const templateContext = {
  cloudflare: {
    env: {
      GITHUB_TOKEN: 'template-server-token',
    },
  },
};

function postBranches(body: unknown) {
  return branchesAction({
    request: new Request('http://example.test/api/github-branches', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cf-connecting-ip': '203.0.113.81',
      },
      body: JSON.stringify(body),
    }),
    params: {},
    context: {},
  } as any) as Promise<Response>;
}

function getBranches(query: string) {
  return branchesLoader({
    request: new Request(`http://example.test/api/github-branches?${query}`, {
      headers: { 'cf-connecting-ip': '203.0.113.82' },
    }),
    params: {},
    context: serverContext,
  } as any) as Promise<Response>;
}

function getTemplate(repo: string, context: unknown = templateContext) {
  return templateLoader({
    request: new Request(`http://example.test/api/github-template?repo=${encodeURIComponent(repo)}`),
    params: {},
    context,
  } as any) as Promise<Response>;
}

function mockBranchList() {
  fetchMock
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ default_branch: 'main' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            name: 'main',
            commit: { sha: 'abc123', url: 'https://api.github.com/repos/owner/repo/commits/abc123' },
            protected: false,
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
}

async function mockTemplateZip() {
  const zip = new JSZip();
  zip.file('owner-repo-1/README.md', 'hello from template');

  const buffer = await zip.generateAsync({ type: 'arraybuffer' });

  fetchMock
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ zipball_url: 'https://codeload.github.com/owner/repo/zipball/v1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    .mockResolvedValueOnce(new Response(buffer, { status: 200 }));
}

describe('GitHub repo coordinates', () => {
  it.each([
    'owner/repo',
    'xKevIsDev/bolt-expo-template',
    'xKevIsDev/bolt-nextjs-shadcn-template',
    'xKevIsDev/vite-shadcn',
    'xKevIsDev/solidjs-ts-tw',
    'acme/repo.js',
    'org_name/my-repo',
  ])('accepts %s', (repo) => {
    expect(isGitHubRepoCoordinate(repo)).toBe(true);
  });

  it.each(['../x', 'foo/bar?x', 'foo/bar#x', 'foo bar/baz', 'owner/..', './x', 'foo/bar/baz', '%2e%2e/x'])(
    'rejects coordinate %s',
    (repo) => {
      expect(isGitHubRepoCoordinate(repo)).toBe(false);
    },
  );

  it('rejects a dot segment that the URL parser would drop', () => {
    expect(isGitHubRepoSegment('.')).toBe(false);
    expect(isGitHubRepoSegment('..')).toBe(false);
    expect(isGitHubRepoSegment('owner')).toBe(true);
  });
});

describe('GitHub branch and template routes', () => {
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

  it('lists branches for owner/repo', async () => {
    mockBranchList();

    const response = await postBranches({ owner: 'owner', repo: 'repo', token: 'user-github-token' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      branches: [{ name: 'main', sha: 'abc123', protected: false, isDefault: true }],
      defaultBranch: 'main',
      total: 1,
    });

    const [repoUrl, repoInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [branchUrl, branchInit] = fetchMock.mock.calls[1] as [string, RequestInit];

    expect(repoUrl).toBe('https://api.github.com/repos/owner/repo');
    expect(branchUrl).toBe('https://api.github.com/repos/owner/repo/branches?per_page=100');
    expect((repoInit.headers as Record<string, string>).Authorization).toBe('Bearer user-github-token');
    expect((branchInit.headers as Record<string, string>).Authorization).toBe('Bearer user-github-token');
  });

  it('lists branches from GET owner and repo query params', async () => {
    mockBranchList();

    const response = await getBranches('owner=xKevIsDev&repo=bolt-expo-template');

    expect(response.status).toBe(200);

    const [repoUrl, repoInit] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(repoUrl).toBe('https://api.github.com/repos/xKevIsDev/bolt-expo-template');
    expect((repoInit.headers as Record<string, string>).Authorization).toBe('Bearer server-secret-token');
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      'https://api.github.com/repos/xKevIsDev/bolt-expo-template/branches?per_page=100',
    );
  });

  it.each([
    { owner: '..', repo: 'x' },
    { owner: 'foo', repo: 'bar?x' },
    { owner: '../x', repo: 'name' },
    { owner: 'owner', repo: 'foo/bar?x' },
    { owner: 'foo', repo: 'bar#x' },
    { owner: 'foo bar', repo: 'baz' },
    { owner: '.', repo: 'x' },
    { owner: 'owner', repo: '..' },
  ])('rejects POST %j without calling GitHub', async ({ owner, repo }) => {
    const response = await postBranches({ owner, repo, token: 'user-github-token' });
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(text).toContain('not allowed');
    expect(text).not.toContain('user-github-token');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['owner=..&repo=x', 'owner=foo&repo=bar%3Fx'])('rejects GET %s without calling GitHub', async (query) => {
    const response = await getBranches(query);
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(text).not.toContain('server-secret-token');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns template files for owner/repo', async () => {
    await mockTemplateZip();

    const response = await getTemplate('owner/repo');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ name: 'README.md', path: 'README.md', content: 'hello from template' }]);

    const [releaseUrl, releaseInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [zipUrl, zipInit] = fetchMock.mock.calls[1] as [string, RequestInit];

    expect(releaseUrl).toBe('https://api.github.com/repos/owner/repo/releases/latest');
    expect(zipUrl).toBe('https://codeload.github.com/owner/repo/zipball/v1');
    expect((releaseInit.headers as Record<string, string>).Authorization).toBe('Bearer template-server-token');
    expect((zipInit.headers as Record<string, string>).Authorization).toBe('Bearer template-server-token');
  });

  it.each(['../x', 'foo/bar?x', 'foo/bar#x', 'foo bar/baz', './secret', 'owner/..'])(
    'rejects template repo %s without calling GitHub',
    async (repo) => {
      const previous = process.env.GITHUB_TOKEN;
      process.env.GITHUB_TOKEN = 'template-server-token';

      try {
        const response = await getTemplate(repo);
        const text = await response.text();

        expect(response.status).toBe(400);
        expect(JSON.parse(text)).toEqual({ error: 'Repository name is not allowed' });
        expect(text).not.toContain('template-server-token');
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        if (previous === undefined) {
          delete process.env.GITHUB_TOKEN;
        } else {
          process.env.GITHUB_TOKEN = previous;
        }
      }
    },
  );
});
