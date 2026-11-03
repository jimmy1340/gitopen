import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readBearerToken, vercelDeploymentFallbackRequest } from '~/lib/api/vercel-fallback';
import { loader } from '~/routes/api.vercel-deploy';

const fetchMock = vi.fn();

function get(url: string, headers?: HeadersInit) {
  return loader({
    request: new Request(url, { headers }),
    params: {},
    context: {},
  } as any) as Promise<Response>;
}

describe('vercel deployment fallback request', () => {
  it('puts the token in the Authorization header instead of the query string', () => {
    const token = 'vercel_access_token_secret';
    const { url, init } = vercelDeploymentFallbackRequest('prj_abc123', token);

    expect(url).toBe('/api/vercel-deploy?projectId=prj_abc123');
    expect(url).not.toContain('token=');
    expect(url).not.toContain(token);
    expect(init.method).toBe('GET');
    expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${token}`);
  });

  it('does not let a crafted project id append token= to the URL', () => {
    const { url } = vercelDeploymentFallbackRequest('prj_1&token=secret', 'header-token');

    expect(url).not.toContain('token=');
    expect(url).not.toContain('header-token');
    expect(new URL(url, 'http://example.test').searchParams.get('projectId')).toBe('prj_1&token=secret');
  });

  it('reads only a bearer token from the Authorization header', () => {
    expect(
      readBearerToken(new Request('http://example.test/', { headers: { Authorization: 'Bearer header-token' } })),
    ).toBe('header-token');
    expect(readBearerToken(new Request('http://example.test/api/vercel-deploy?token=query-secret'))).toBeNull();
  });
});

describe('GET /api/vercel-deploy', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the same project and deployment URLs when the token is a header', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'prj_1', name: 'my-app' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            deployments: [{ id: 'dpl_1', state: 'READY', url: 'my-app-abc.vercel.app' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    const response = await get('http://example.test/api/vercel-deploy?projectId=prj_1&token=query-secret', {
      Authorization: 'Bearer header-token',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      project: {
        id: 'prj_1',
        name: 'my-app',
        url: 'https://my-app.vercel.app',
      },
      deploy: {
        id: 'dpl_1',
        state: 'READY',
        url: 'https://my-app-abc.vercel.app',
      },
    });

    const [projectUrl, projectInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [deploymentsUrl, deploymentsInit] = fetchMock.mock.calls[1] as [string, RequestInit];

    expect(projectUrl).toBe('https://api.vercel.com/v9/projects/prj_1');
    expect(deploymentsUrl).toBe('https://api.vercel.com/v6/deployments?projectId=prj_1&limit=1');
    expect(deploymentsUrl).not.toContain('token=');
    expect(new Headers(projectInit.headers).get('Authorization')).toBe('Bearer header-token');
    expect(new Headers(deploymentsInit.headers).get('Authorization')).toBe('Bearer header-token');
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('query-secret');
  });

  it('rejects a token that is only present in the query string', async () => {
    const response = await get('http://example.test/api/vercel-deploy?projectId=prj_1&token=query-secret');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Missing projectId or token' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the project URL when there is no deployment', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'prj_1', name: 'my-app' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ deployments: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const response = await get('http://example.test/api/vercel-deploy?projectId=prj_1', {
      Authorization: 'Bearer header-token',
    });

    expect(await response.json()).toEqual({
      project: {
        id: 'prj_1',
        name: 'my-app',
        url: 'https://my-app.vercel.app',
      },
      deploy: null,
    });
  });
});
