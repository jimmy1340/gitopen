import { execSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { loader } from '~/routes/api.git-info';

describe('GET /api/git-info', () => {
  it('returns the build snapshot and omits remote credentials', async () => {
    const expectedHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const response = await loader();
    const body = (await response.json()) as {
      commit: string;
      branch: string;
      isDirty: boolean;
      remoteUrl?: string;
      lastCommit: { message: string; author: string; date: string };
    };

    expect(response.status).toBe(200);
    expect(body.commit).toBe(expectedHash);
    expect(body.branch.length).toBeGreaterThan(0);
    expect(body.isDirty).toBe(false);
    expect(body.lastCommit.message.length).toBeGreaterThan(0);
    expect(body.lastCommit.author.length).toBeGreaterThan(0);
    expect(body.lastCommit.date.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain('x-access-token');

    if (body.remoteUrl) {
      expect(new URL(body.remoteUrl).password).toBe('');
    }
  });
});
