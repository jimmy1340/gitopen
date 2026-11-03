import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logSpies = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
}));

vi.mock('~/utils/logger', () => ({
  createScopedLogger: () => ({
    debug: logSpies.debug,
    error: logSpies.error,
    trace: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    setLevel: vi.fn(),
  }),
}));

const { action } = await import('~/routes/api.supabase.query');

const fetchMock = vi.fn();
const PROJECT_ID = 'abcdefghijklmnopqrst';
const SQL = 'select private_key_from_vault as leak_marker from secrets';

function post(body: unknown, init?: { authorization?: string | null; rawBody?: string }) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (init?.authorization !== null) {
    headers.Authorization = init?.authorization ?? 'Bearer supabase-user-token';
  }

  return action({
    request: new Request('http://example.test/api/supabase/query', {
      method: 'POST',
      headers,
      body: init?.rawBody ?? JSON.stringify(body),
    }),
    params: {},
    context: {},
  } as any) as Promise<Response>;
}

function loggedText() {
  return JSON.stringify([...logSpies.debug.mock.calls, ...logSpies.error.mock.calls]);
}

describe('POST /api/supabase/query', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    logSpies.debug.mockReset();
    logSpies.error.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the upstream query result unchanged for a valid project id', async () => {
    const result = [{ id: 1, name: 'widgets', stack: 'column-value' }, { nested: { ok: true } }];

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const response = await post({ projectId: PROJECT_ID, query: SQL });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(await response.json()).toEqual(result);

    const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(`https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`);
    expect(requestInit.method).toBe('POST');
    expect(JSON.parse(String(requestInit.body))).toEqual({ query: SQL });
    expect((requestInit.headers as Record<string, string>).Authorization).toBe('Bearer supabase-user-token');
    expect(loggedText()).not.toContain(SQL);
    expect(loggedText()).not.toContain('leak_marker');
    expect(loggedText()).not.toContain('private_key_from_vault');
  });

  it.each([
    '../admin',
    'abcdefghijklmnopqrst/../x',
    'ABCDEFGHIJKLMNOPQRST',
    'abc123def456ghi789jk',
    'short',
    '',
    'abcdefghijklmnopqrstu',
    'abcd efghijklmnopqr',
    '%2e%2e%2fabcdefghijklmn',
    'abcdefghijklmnopqrst?',
  ])('rejects project id %s with 400 and does not call supabase', async (projectId) => {
    const response = await post({ projectId, query: SQL });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { message: 'Project ID is not allowed' } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(loggedText()).not.toContain(SQL);
  });

  it('rejects a non-string project id', async () => {
    const response = await post({ projectId: 12345, query: 'select 1' });

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('omits stack from an intentionally failing query', async () => {
    const failure = new Error('database exploded');
    failure.stack = 'Error: database exploded\n    at secret/stack.ts:1:1';
    fetchMock.mockRejectedValue(failure);

    const response = await post({ projectId: PROJECT_ID, query: SQL });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: { message: 'database exploded' } });
    expect(JSON.stringify(body)).not.toContain('"stack":');
    expect(JSON.stringify(body)).not.toContain('secret/stack.ts');
    expect(loggedText()).not.toContain(SQL);
    expect(loggedText()).not.toContain('secret/stack.ts');
  });

  it('strips stack from an upstream error body and does not log the SQL', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          message: `syntax error in ${SQL}`,
          stack: 'at /opt/supabase/query.ts:10:2',
          details: { stack: 'nested stack', hint: 'check the query' },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const response = await post({ projectId: PROJECT_ID, query: SQL });
    const body = (await response.json()) as {
      error: {
        message: string;
        details: { message: string; details: { hint: string } };
      };
    };

    expect(response.status).toBe(400);
    expect(JSON.stringify(body)).not.toContain('"stack":');
    expect(body.error.message).toBe(`syntax error in ${SQL}`);
    expect(body.error.details).toEqual({
      message: `syntax error in ${SQL}`,
      details: { hint: 'check the query' },
    });
    expect(loggedText()).not.toContain(SQL);
    expect(loggedText()).not.toContain('leak_marker');
  });

  it('still returns 401 when the authorization header is missing', async () => {
    const response = await post({ projectId: PROJECT_ID, query: 'select 1' }, { authorization: null });

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('No authorization token provided');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
