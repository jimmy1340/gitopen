import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { action, loader } from '~/routes/api.git-proxy.$';

const fetchMock = vi.fn(async (..._args: unknown[]) => new Response('ok'));

const proxy = (path: string, headers: Record<string, string> = {}) =>
  loader({
    request: new Request(`http://example.test/api/git-proxy/${path}`, { headers }),
    params: { '*': path.split('?')[0] },
    context: {},
  } as any);

describe('GET /api/git-proxy/*', () => {
  const logSpy = vi.spyOn(console, 'log');

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response('ok'));
    logSpy.mockImplementation(() => undefined);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    logSpy.mockReset();
  });

  it.each([
    'localhost:8080/admin',
    '127.0.0.1/admin',
    '169.254.169.254/latest/meta-data',
    '10.1.2.3/secret',
    'user:pass@github.com/a/b.git',
  ])('refuses to proxy %s', async (target) => {
    const response = await proxy(target);

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards git requests to public hosts', async () => {
    const response = await proxy('github.com/a/b.git/info/refs', { Authorization: 'Basic secret-token' });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe('https://github.com/a/b.git/info/refs');
    expect((init.headers as Headers).get('Host')).toBe('github.com');
  });

  it('does not write credentials to the logs', async () => {
    await proxy('github.com/a/b.git/info/refs', { Authorization: 'Basic secret-token' });

    expect(JSON.stringify(logSpy.mock.calls)).not.toContain('secret-token');
  });

  it.each([
    'https://127.0.0.1/admin',
    'https://10.0.0.1/admin',
    'https://[::1]/admin',
    'https://metadata.google.internal/admin',
    'https://user:secret@github.com/private.git',
    'http://github.com/insecure.git',
    'file:///etc/passwd',
  ])('rejects an unsafe redirect to %s before fetching it', async (location) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: location } }));

    const response = await proxy('github.com/old.git');

    expect(response.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows relative public redirects and reports the final clone URL', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 301, headers: { Location: '/new.git/info/refs' } }));

    const response = await proxy('github.com/old.git/info/refs', { Authorization: 'Basic secret-token' });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(response.headers.get('x-redirected-url')).toBe('https://github.com/new.git/info/refs');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];

    expect(url).toBe('https://github.com/new.git/info/refs');
    expect((init.headers as Headers).get('Authorization')).toBe('Basic secret-token');
    expect(init.redirect).toBe('manual');
  });

  it('does not forward credentials when a public redirect changes origin', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { Location: 'https://git.example.com/new.git' } }),
    );

    const response = await proxy('github.com/old.git', {
      Authorization: 'Basic secret-token',
      'X-Authorization': 'other-secret',
    });

    expect(response.status).toBe(200);

    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const headers = init.headers as Headers;

    expect(headers.get('Host')).toBe('git.example.com');
    expect(headers.has('Authorization')).toBe(false);
    expect(headers.has('X-Authorization')).toBe(false);
  });

  it('stops redirect loops instead of fetching indefinitely', async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 302, headers: { Location: '/loop.git' } }));

    const response = await proxy('github.com/loop.git');

    expect(response.status).toBe(502);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(21);
  });

  it.each([301, 302, 303])('converts a POST to GET after a %s redirect', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status, headers: { Location: '/new.git' } }));

    const response = await action({
      request: new Request('http://example.test/api/git-proxy/github.com/old.git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-git-upload-pack-request', 'Content-Length': '4' },
        body: 'pack',
      }),
      params: { '*': 'github.com/old.git' },
      context: {},
    } as any);

    expect(response.status).toBe(200);

    const [, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [, redirectedInit] = fetchMock.mock.calls[1] as [string, RequestInit];

    expect(firstInit.body).toBeInstanceOf(ReadableStream);
    expect(redirectedInit.method).toBe('GET');
    expect(redirectedInit.body).toBeUndefined();
    expect((redirectedInit.headers as Headers).has('content-type')).toBe(false);
    expect((redirectedInit.headers as Headers).has('content-length')).toBe(false);
  });

  it.each([307, 308])('does not replay a streaming POST after a %s redirect', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status, headers: { Location: '/new.git' } }));

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const response = await action({
        request: new Request('http://example.test/api/git-proxy/github.com/old.git', { method: 'POST', body: 'pack' }),
        params: { '*': 'github.com/old.git' },
        context: {},
      } as any);

      expect(response.status).toBe(500);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it.each([307, 308])('preserves GET after a %s redirect', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status, headers: { Location: '/new.git' } }));

    const response = await proxy('github.com/old.git');

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe('GET');
  });
});
