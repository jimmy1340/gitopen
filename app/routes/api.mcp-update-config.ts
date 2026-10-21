import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { MCPService, type MCPConfig } from '~/lib/services/mcpService';
import { findStdioServers, isStdioMcpAllowed } from '~/lib/services/mcpPolicy';

const logger = createScopedLogger('api.mcp-update-config');

export async function action({ request, context }: ActionFunctionArgs) {
  try {
    const mcpConfig = (await request.json()) as MCPConfig;

    if (!mcpConfig || typeof mcpConfig !== 'object') {
      return Response.json({ error: 'Invalid MCP servers configuration' }, { status: 400 });
    }

    const stdioServers = findStdioServers(mcpConfig.mcpServers);
    const env = context?.cloudflare?.env as unknown as Record<string, unknown> | undefined;

    if (stdioServers.length > 0 && !isStdioMcpAllowed({ env })) {
      logger.warn(`Rejected STDIO MCP servers: ${stdioServers.join(', ')}`);

      return Response.json(
        {
          error:
            `STDIO MCP servers are disabled on this deployment (${stdioServers.join(', ')}). ` +
            'Use an SSE or streamable-http server, or set MCP_ALLOW_STDIO=true on a trusted, private instance.',
        },
        { status: 403 },
      );
    }

    const mcpService = MCPService.getInstance();
    const serverTools = await mcpService.updateConfig(mcpConfig);

    return Response.json(serverTools);
  } catch (error) {
    logger.error('Error updating MCP config:', error);
    return Response.json({ error: 'Failed to update MCP config' }, { status: 500 });
  }
}
