import { describe, expect, it } from 'vitest';
import { isPrivateOrLocalHost, withSecurity } from './security';

const hostOf = (url: string) => new URL(url).hostname;

describe('isPrivateOrLocalHost', () => {
  it.each([
    'https://localhost/x',
    'https://app.localhost/x',
    'https://printer.local/x',
    'https://db.internal/x',
    'https://127.0.0.1/x',
    'https://127.1/x',
    'https://2130706433/x',
    'https://0x7f000001/x',
    'https://10.0.0.5/x',
    'https://172.16.4.1/x',
    'https://192.168.1.10/x',
    'https://169.254.169.254/latest/meta-data',
    'https://100.64.0.1/x',
    'https://[::1]/x',
    'https://[fd00::1]/x',
    'https://[fe80::1]/x',
    'https://[::ffff:127.0.0.1]/x',
  ])('blocks %s', (url) => {
    expect(isPrivateOrLocalHost(hostOf(url))).toBe(true);
  });

  it.each([
    'https://github.com/a/b.git',
    'https://gitlab.com/a/b.git',
    'https://gitlab.example.org/a/b.git',
    'https://8.8.8.8/x',
    'https://172.32.0.1/x',
    'https://[2606:4700::1111]/x',
  ])('allows %s', (url) => {
    expect(isPrivateOrLocalHost(hostOf(url))).toBe(false);
  });
});

describe('withSecurity', () => {
  const ok = async () => new Response('ok');
  const call = (handler: ReturnType<typeof withSecurity>) =>
    handler({ request: new Request('http://example.test/api/thing'), params: {}, context: {} } as any);

  it('serves routes that do not ask for authentication', async () => {
    expect((await call(withSecurity(ok, { rateLimit: false }))).status).toBe(200);
  });

  it('rejects routes that require authentication because no auth backend exists', async () => {
    expect((await call(withSecurity(ok, { requireAuth: true, rateLimit: false }))).status).toBe(401);
  });
});
