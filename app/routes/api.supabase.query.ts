import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.supabase.query');

/*
 * Hosted Supabase project refs match the CLI pattern `^[a-z]{20}$`
 * (example: abcdefghijklmnopqrst). Anything else is interpolated into the
 * Management API path and can rewrite it.
 */
export const SUPABASE_PROJECT_ID_PATTERN = /^[a-z]{20}$/;

export function isSupabaseProjectId(value: unknown): value is string {
  return typeof value === 'string' && SUPABASE_PROJECT_ID_PATTERN.test(value);
}

function omitStack(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => omitStack(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const result: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'stack') {
      continue;
    }

    result[key] = omitStack(nested);
  }

  return result;
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const authHeader = request.headers.get('Authorization');

  if (!authHeader) {
    return new Response('No authorization token provided', { status: 401 });
  }

  try {
    const { projectId, query } = (await request.json()) as { projectId?: unknown; query?: unknown };

    if (!isSupabaseProjectId(projectId)) {
      return new Response(JSON.stringify({ error: { message: 'Project ID is not allowed' } }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    logger.debug('Executing query:', {
      projectId,
      queryLength: typeof query === 'string' ? query.length : undefined,
    });

    const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorData: any;

      try {
        errorData = JSON.parse(errorText);
      } catch (e) {
        console.log(e);
        errorData = { message: errorText };
      }

      if (errorData && typeof errorData === 'object') {
        errorData = omitStack(errorData);
      }

      logger.error(
        'Supabase API error:',
        JSON.stringify({
          status: response.status,
          statusText: response.statusText,
        }),
      );

      return new Response(
        JSON.stringify({
          error: {
            status: response.status,
            statusText: response.statusText,
            message: errorData.message || errorData.error || errorText,
            details: errorData,
          },
        }),
        {
          status: response.status,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    }

    const result = await response.json();

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    logger.error('Query execution error:', error instanceof Error ? error.message : 'Query execution failed');

    return new Response(
      JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : 'Query execution failed',
        },
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  }
}
