import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkForUpdates, CURRENT_VERSION } from './updates';

describe('checkForUpdates', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('identifies current version accurately', () => {
    expect(CURRENT_VERSION).toBe('1.0.2');
  });

  it('detects when an update is available on remote gitopen repo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: '1.0.3', name: 'gitopen' }),
      }),
    );

    const result = await checkForUpdates();
    expect(result.available).toBe(true);
    expect(result.version).toBe('1.0.3');
  });

  it('detects when current version is up to date', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: '1.0.2', name: 'gitopen' }),
      }),
    );

    const result = await checkForUpdates();
    expect(result.available).toBe(false);
    expect(result.version).toBe('1.0.2');
  });

  it('gracefully handles network failures without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const result = await checkForUpdates();
    expect(result.available).toBe(false);
    expect(result.error?.type).toBe('network');
  });
});
