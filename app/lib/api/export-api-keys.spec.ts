import { describe, expect, it } from 'vitest';
import { loader } from '~/routes/api.export-api-keys';

describe('GET /api/export-api-keys', () => {
  it('returns only the keys stored in the caller cookie and never server environment keys', async () => {
    const cookie = `apiKeys=${encodeURIComponent(JSON.stringify({ OpenAI: 'cookie-key' }))}`;
    const response = (await loader({
      request: new Request('http://example.test/api/export-api-keys', { headers: { Cookie: cookie } }),
      params: {},
      context: { cloudflare: { env: { ANTHROPIC_API_KEY: 'server-secret', OPENAI_API_KEY: 'server-secret' } } },
    } as any)) as Response;

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ OpenAI: 'cookie-key' });
  });

  it('returns an empty object when the caller has no stored keys', async () => {
    const response = (await loader({
      request: new Request('http://example.test/api/export-api-keys'),
      params: {},
      context: { cloudflare: { env: { OPENAI_API_KEY: 'server-secret' } } },
    } as any)) as Response;

    expect(await response.json()).toEqual({});
  });
});
