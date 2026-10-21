import { describe, expect, it } from 'vitest';
import { findStdioServers, isStdioMcpAllowed } from './mcpPolicy';

describe('isStdioMcpAllowed', () => {
  it('allows STDIO servers in development', () => {
    expect(isStdioMcpAllowed({ isDev: true, env: {} })).toBe(true);
  });

  it('blocks STDIO servers in production by default', () => {
    expect(isStdioMcpAllowed({ isDev: false, env: {} })).toBe(false);
    expect(isStdioMcpAllowed({ isDev: false, env: { MCP_ALLOW_STDIO: 'false' } })).toBe(false);
  });

  it('allows STDIO servers in production only when explicitly enabled', () => {
    expect(isStdioMcpAllowed({ isDev: false, env: { MCP_ALLOW_STDIO: 'true' } })).toBe(true);
    expect(isStdioMcpAllowed({ isDev: false, env: { MCP_ALLOW_STDIO: ' TRUE ' } })).toBe(true);
  });
});

describe('findStdioServers', () => {
  it('finds servers declared by type or by command', () => {
    expect(
      findStdioServers({
        a: { type: 'stdio', command: 'npx' },
        b: { command: 'node', args: ['server.js'] },
        c: { type: 'sse', url: 'https://example.com/sse' },
        d: { type: 'streamable-http', url: 'https://example.com/mcp' },
      }),
    ).toEqual(['a', 'b']);
  });

  it('ignores missing or malformed input', () => {
    expect(findStdioServers(undefined)).toEqual([]);
    expect(findStdioServers('nope')).toEqual([]);
    expect(findStdioServers({ a: null, b: 'x' })).toEqual([]);
  });
});
