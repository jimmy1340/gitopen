import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updateConfig = vi.fn(async () => ({}));

vi.mock('~/lib/services/mcpService', () => ({
  MCPService: { getInstance: () => ({ updateConfig }) },
}));

import { action } from '~/routes/api.mcp-update-config';

const env = import.meta.env as Record<string, unknown>;
const originalDev = env.DEV;
const originalFlag = process.env.MCP_ALLOW_STDIO;

const post = (body: unknown, cloudflareEnv: Record<string, unknown> = {}) =>
  action({
    request: new Request('http://example.test/api/mcp-update-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    params: {},
    context: { cloudflare: { env: cloudflareEnv } },
  } as any);

const stdioConfig = { mcpServers: { local: { command: 'node', args: ['server.js'] } } };
const remoteConfig = { mcpServers: { remote: { type: 'sse', url: 'https://example.com/sse' } } };

describe('POST /api/mcp-update-config', () => {
  beforeEach(() => {
    updateConfig.mockClear();
    delete process.env.MCP_ALLOW_STDIO;
  });

  afterEach(() => {
    env.DEV = originalDev;

    if (originalFlag === undefined) {
      delete process.env.MCP_ALLOW_STDIO;
    } else {
      process.env.MCP_ALLOW_STDIO = originalFlag;
    }
  });

  describe('in a production build', () => {
    beforeEach(() => {
      env.DEV = false;
    });

    it('rejects STDIO servers and never reaches the MCP service', async () => {
      const response = await post(stdioConfig);

      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: string }).error).toContain('local');
      expect(updateConfig).not.toHaveBeenCalled();
    });

    it('still accepts remote MCP servers', async () => {
      const response = await post(remoteConfig);

      expect(response.status).toBe(200);
      expect(updateConfig).toHaveBeenCalledWith(remoteConfig);
    });

    it('accepts STDIO servers when the operator opts in', async () => {
      const response = await post(stdioConfig, { MCP_ALLOW_STDIO: 'true' });

      expect(response.status).toBe(200);
      expect(updateConfig).toHaveBeenCalledWith(stdioConfig);
    });
  });

  it('accepts STDIO servers in development', async () => {
    env.DEV = true;

    const response = await post(stdioConfig);

    expect(response.status).toBe(200);
    expect(updateConfig).toHaveBeenCalledWith(stdioConfig);
  });
});
