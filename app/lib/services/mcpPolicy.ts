type EnvLike = Record<string, unknown> | undefined;

/**
 * STDIO MCP servers make the server spawn arbitrary local processes, so they are
 * only allowed when running the dev server, or when an operator explicitly opts in
 * with MCP_ALLOW_STDIO=true on a trusted, private deployment.
 */
export function isStdioMcpAllowed(options: { env?: EnvLike; isDev?: boolean } = {}): boolean {
  const { env, isDev = import.meta.env.DEV === true } = options;

  if (isDev) {
    return true;
  }

  const flag = env?.MCP_ALLOW_STDIO ?? (typeof process !== 'undefined' ? process.env?.MCP_ALLOW_STDIO : undefined);

  return typeof flag === 'string' && flag.trim().toLowerCase() === 'true';
}

/**
 * Returns the names of servers in an MCP config that would be launched as a local process.
 */
export function findStdioServers(mcpServers: unknown): string[] {
  if (!mcpServers || typeof mcpServers !== 'object') {
    return [];
  }

  return Object.entries(mcpServers as Record<string, unknown>)
    .filter(([, config]) => {
      if (!config || typeof config !== 'object') {
        return false;
      }

      const { type, command } = config as { type?: unknown; command?: unknown };

      return type === 'stdio' || command !== undefined;
    })
    .map(([name]) => name);
}
