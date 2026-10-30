import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { action as branchesAction } from '~/routes/api.gitlab-branches';
import { action as projectsAction } from '~/routes/api.gitlab-projects';
import { resetRateLimitState } from '~/lib/security';

const fetchMock = vi.fn();

function post(url: string, body: unknown) {
  const action = url.endsWith('gitlab-branches') ? branchesAction : projectsAction;

  return action({
    request: new Request(`http://example.test${url}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cf-connecting-ip': '203.0.113.70',
      },
      body: JSON.stringify(body),
    }),
    params: {},
    context: {},
  } as any) as Promise<Response>;
}

describe('GitLab routes', () => {
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

  it.each([
    'http://127.0.0.1:8929',
    'https://169.254.169.254',
    'https://10.0.0.5',
    'https://user:secret@gitlab.com',
    'http://gitlab.example.org',
  ])('refuses to fetch projects from %s', async (gitlabUrl) => {
    const response = await post('/api/gitlab-projects', { token: 'glpat-user', gitlabUrl });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'GitLab URL is not allowed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still lists projects from a public https GitLab', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 7,
            name: 'demo',
            path_with_namespace: 'group/demo',
            description: '',
            web_url: 'https://gitlab.com/group/demo',
            http_url_to_repo: 'https://gitlab.com/group/demo.git',
            star_count: 1,
            forks_count: 0,
            updated_at: '2026-10-30T00:00:00Z',
            default_branch: 'main',
            visibility: 'public',
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const response = await post('/api/gitlab-projects', {
      token: 'glpat-user',
      gitlabUrl: 'https://gitlab.example.org',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      total: 1,
      projects: [{ id: 7, name: 'demo', path_with_namespace: 'group/demo' }],
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toContain('https://gitlab.example.org/api/v4/projects');
    expect(init.redirect).toBe('manual');
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer glpat-user');
  });

  it('does not follow a project-list redirect onto a private host', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { Location: 'https://169.254.169.254/latest/meta-data' } }),
    );

    const response = await post('/api/gitlab-projects', { token: 'glpat-user', gitlabUrl: 'https://gitlab.com' });

    expect(response.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a project id that would change the request path', async () => {
    const response = await post('/api/gitlab-branches', {
      token: 'glpat-user',
      gitlabUrl: 'https://gitlab.com',
      projectId: '../admin',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Project ID is not allowed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads branches for a numeric project id', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              name: 'main',
              commit: { id: 'abc123', short_id: 'abc' },
              protected: false,
              default: true,
              can_push: true,
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ default_branch: 'main' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const response = await post('/api/gitlab-branches', {
      token: 'glpat-user',
      gitlabUrl: 'https://gitlab.com',
      projectId: 42,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      defaultBranch: 'main',
      total: 1,
      branches: [{ name: 'main', sha: 'abc123', isDefault: true }],
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/projects/42/repository/branches');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/projects/42');
  });
});
