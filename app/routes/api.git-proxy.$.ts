import { json } from '@remix-run/cloudflare';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';
import { isPrivateOrLocalHost } from '~/lib/security';

// Allowed headers to forward to the target server
const ALLOW_HEADERS = [
  'accept-encoding',
  'accept-language',
  'accept',
  'access-control-allow-origin',
  'authorization',
  'cache-control',
  'connection',
  'content-length',
  'content-type',
  'dnt',
  'pragma',
  'range',
  'referer',
  'user-agent',
  'x-authorization',
  'x-http-method-override',
  'x-requested-with',
];

// Headers to expose from the target server's response
const EXPOSE_HEADERS = [
  'accept-ranges',
  'age',
  'cache-control',
  'content-length',
  'content-language',
  'content-type',
  'date',
  'etag',
  'expires',
  'last-modified',
  'pragma',
  'server',
  'transfer-encoding',
  'vary',
  'x-github-request-id',
  'x-redirected-url',
];

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 20;

function isAllowedTarget(target: URL) {
  return target.protocol === 'https:' && !target.username && !target.password && !isPrivateOrLocalHost(target.hostname);
}

// Handle all HTTP methods
export async function action({ request, params }: ActionFunctionArgs) {
  return handleProxyRequest(request, params['*']);
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  return handleProxyRequest(request, params['*']);
}

async function handleProxyRequest(request: Request, path: string | undefined) {
  try {
    if (!path) {
      return json({ error: 'Invalid proxy URL format' }, { status: 400 });
    }

    // Handle CORS preflight request
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': ALLOW_HEADERS.join(', '),
          'Access-Control-Expose-Headers': EXPOSE_HEADERS.join(', '),
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Extract domain and remaining path
    const parts = path.match(/([^\/]+)\/?(.*)/);

    if (!parts) {
      return json({ error: 'Invalid path format' }, { status: 400 });
    }

    const domain = parts[1];
    const remainingPath = parts[2] || '';

    // Reconstruct the target URL with query parameters
    const url = new URL(request.url);
    let target: URL;

    try {
      target = new URL(`https://${domain}/${remainingPath}${url.search}`);
    } catch {
      return json({ error: 'Invalid target URL' }, { status: 400 });
    }

    // Never let the proxy reach loopback/private networks or carry embedded credentials
    if (!isAllowedTarget(target)) {
      return json({ error: 'Target host is not allowed' }, { status: 403 });
    }

    console.log('Target URL:', `${target.origin}${target.pathname}`);

    // Filter and prepare headers
    const headers = new Headers();

    // Only forward allowed headers
    for (const header of ALLOW_HEADERS) {
      if (request.headers.has(header)) {
        headers.set(header, request.headers.get(header)!);
      }
    }

    // Set the host header
    headers.set('Host', target.host);

    // Set Git user agent if not already present
    if (!headers.has('user-agent') || !headers.get('user-agent')?.startsWith('git/')) {
      headers.set('User-Agent', 'git/@isomorphic-git/cors-proxy');
    }

    // Log header names only: values can contain Authorization tokens
    console.log('Request headers:', Array.from(headers.keys()));

    let method = request.method;
    let body = ['GET', 'HEAD'].includes(method) ? null : request.body;
    let redirects = 0;
    let response: Response;

    // Inspect every redirect before fetching it; automatic redirects bypass host validation.
    while (true) {
      const fetchOptions: RequestInit = {
        method,
        headers: new Headers(headers),
        redirect: 'manual',
      };

      if (body) {
        fetchOptions.body = body;
        fetchOptions.duplex = 'half';
      }

      response = await fetch(target.toString(), fetchOptions);

      const location = response.headers.get('location');

      if (!REDIRECT_STATUSES.has(response.status) || location === null) {
        break;
      }

      await response.body?.cancel().catch(() => undefined);

      if (redirects >= MAX_REDIRECTS) {
        return json({ error: 'Too many redirects' }, { status: 502 });
      }

      let nextTarget: URL;

      try {
        nextTarget = new URL(location, target);
      } catch {
        return json({ error: 'Invalid redirect URL' }, { status: 400 });
      }

      if (!isAllowedTarget(nextTarget)) {
        return json({ error: 'Redirect target host is not allowed' }, { status: 403 });
      }

      if (
        ((response.status === 301 || response.status === 302) && method === 'POST') ||
        (response.status === 303 && !['GET', 'HEAD'].includes(method))
      ) {
        method = 'GET';
        body = null;
        headers.delete('content-length');
        headers.delete('content-type');
      } else if (body) {
        // Like Fetch, do not replay a streamed upload; buffering large Git packs is unsafe.
        throw new Error('Cannot follow redirect with a streaming request body');
      }

      if (nextTarget.origin !== target.origin) {
        headers.delete('authorization');
        headers.delete('x-authorization');
      }

      headers.set('Host', nextTarget.host);
      target = nextTarget;
      redirects++;
    }

    console.log('Response status:', response.status);

    // Create response headers
    const responseHeaders = new Headers();

    // Add CORS headers
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', ALLOW_HEADERS.join(', '));
    responseHeaders.set('Access-Control-Expose-Headers', EXPOSE_HEADERS.join(', '));

    // Copy exposed headers from the target response
    for (const header of EXPOSE_HEADERS) {
      // Skip content-length as we'll use the original response's content-length
      if (header === 'content-length') {
        continue;
      }

      if (response.headers.has(header)) {
        responseHeaders.set(header, response.headers.get(header)!);
      }
    }

    // If the response was redirected, add the x-redirected-url header
    if (redirects > 0) {
      responseHeaders.set('x-redirected-url', target.toString());
    }

    console.log('Response headers:', Array.from(responseHeaders.keys()));

    // Return the response with the target's body stream piped directly
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return json(
      {
        error: 'Proxy error',
        message: error instanceof Error ? error.message : 'Unknown error',
        url: path ? `https://${path}` : 'Invalid URL',
      },
      { status: 500 },
    );
  }
}
