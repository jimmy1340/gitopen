import { describe, expect, it } from 'vitest';
import { getApiKeysFromCookie, getProviderSettingsFromCookie, parseCookies } from './cookies';

describe('parseCookies', () => {
  it('keeps values that contain equals signs and decodes percent-encoding', () => {
    expect(parseCookies('apiKeys=%7B%22OpenAI%22%3A%22sk-test%22%7D; theme=dark')).toEqual({
      apiKeys: '{"OpenAI":"sk-test"}',
      theme: 'dark',
    });
    expect(parseCookies('token=abc=def')).toEqual({ token: 'abc=def' });
  });

  it('skips a malformed pair without dropping the rest of the header', () => {
    expect(parseCookies('bad=%E0%; good=ok')).toEqual({ good: 'ok' });
  });

  it('does not assign prototype-related cookie names', () => {
    const parsed = parseCookies('__proto__=polluted; constructor=nope; apiKeys=1');

    expect(parsed.apiKeys).toBe('1');
    expect(parsed).not.toHaveProperty('polluted');
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
});

describe('json cookies', () => {
  it('returns the stored object for a valid apiKeys cookie', () => {
    const header = `apiKeys=${encodeURIComponent(JSON.stringify({ OpenAI: 'cookie-key' }))}`;

    expect(getApiKeysFromCookie(header)).toEqual({ OpenAI: 'cookie-key' });
  });

  it('treats missing, invalid, and non-object json as an empty object', () => {
    expect(getApiKeysFromCookie(null)).toEqual({});
    expect(getApiKeysFromCookie('apiKeys=not-json')).toEqual({});
    expect(getApiKeysFromCookie('apiKeys=%5B1%5D')).toEqual({});
    expect(getProviderSettingsFromCookie('providers=')).toEqual({});
    expect(getProviderSettingsFromCookie('providers=%7B%22openai%22%3A%7B%22enabled%22%3Atrue%7D%7D')).toEqual({
      openai: { enabled: true },
    });
  });
});
