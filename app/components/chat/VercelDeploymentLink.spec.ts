import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { vercelDeploymentFallbackRequest } from '~/lib/api/vercel-fallback';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'VercelDeploymentLink.client.tsx'), 'utf8');

describe('VercelDeploymentLink fallback', () => {
  it('builds the fallback request without a token query param', () => {
    const token = 'vercel_access_token_secret';
    const { url, init } = vercelDeploymentFallbackRequest('prj_Day5', token);

    expect(url).toBe('/api/vercel-deploy?projectId=prj_Day5');
    expect(url).not.toContain('token=');
    expect(url).not.toContain(token);
    expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${token}`);
  });

  it('uses that request from the client and still prefers deploy.url over project.url', () => {
    expect(source).toContain('vercelDeploymentFallbackRequest(projectId, connection.token)');
    expect(source).toContain('fetch(fallback.url, fallback.init)');
    expect(source).not.toContain('token=${');
    expect(source).not.toMatch(/vercel-deploy\?[^`'"]*token=/);
    expect(source).toContain('deploy?.url');
    expect(source).toContain('project?.url');
  });
});
