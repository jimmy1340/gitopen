import { json, type LoaderFunction, type LoaderFunctionArgs } from '@remix-run/cloudflare';

/**
 * Diagnostic API for troubleshooting connection issues
 */

interface AppContext {
  env?: {
    GITHUB_ACCESS_TOKEN?: string;
    NETLIFY_TOKEN?: string;
  };
}

export const EXTERNAL_API_PROBE_TTL_MS = 60_000;

const GITHUB_ZEN_URL = 'https://api.github.com/zen';
const NETLIFY_API_URL = 'https://api.netlify.com/api/v1/';

type ExternalApiProbe =
  | { isReachable: boolean; status: number; statusText: string }
  | { isReachable: false; error: string };

const externalApiProbeCache = new Map<string, { expiresAt: number; probe: ExternalApiProbe }>();
const externalApiProbeInflight = new Map<string, Promise<ExternalApiProbe>>();

export function resetExternalApiProbeCache(): void {
  externalApiProbeCache.clear();
  externalApiProbeInflight.clear();
}

/**
 * Short in-process cache so repeat diagnostics calls do not probe GitHub and Netlify every time.
 * In-flight probes are shared. The cached value is reachability only, never a token.
 */
async function probeExternalApi(url: string, init: RequestInit): Promise<ExternalApiProbe> {
  const cached = externalApiProbeCache.get(url);

  if (cached && Date.now() < cached.expiresAt) {
    return cached.probe;
  }

  const pending = externalApiProbeInflight.get(url);

  if (pending) {
    return pending;
  }

  const request = fetchExternalApiProbe(url, init).finally(() => {
    externalApiProbeInflight.delete(url);
  });

  externalApiProbeInflight.set(url, request);

  return request;
}

async function fetchExternalApiProbe(url: string, init: RequestInit): Promise<ExternalApiProbe> {
  let probe: ExternalApiProbe;

  try {
    const response = await fetch(url, init);
    await response.body?.cancel().catch(() => undefined);

    probe = {
      isReachable: response.ok,
      status: response.status,
      statusText: response.statusText,
    };
  } catch (error) {
    probe = {
      isReachable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  externalApiProbeCache.set(url, { expiresAt: Date.now() + EXTERNAL_API_PROBE_TTL_MS, probe });

  return probe;
}

export const loader: LoaderFunction = async ({ request, context }: LoaderFunctionArgs & { context: AppContext }) => {
  // Get environment variables
  const envVars = {
    hasGithubToken: Boolean(process.env.GITHUB_ACCESS_TOKEN || context.env?.GITHUB_ACCESS_TOKEN),
    hasNetlifyToken: Boolean(process.env.NETLIFY_TOKEN || context.env?.NETLIFY_TOKEN),
    nodeEnv: process.env.NODE_ENV,
  };

  // Check cookies
  const cookieHeader = request.headers.get('Cookie') || '';
  const cookies = cookieHeader.split(';').reduce(
    (acc, cookie) => {
      const [key, value] = cookie.trim().split('=');

      if (key) {
        acc[key] = value;
      }

      return acc;
    },
    {} as Record<string, string>,
  );

  const hasGithubTokenCookie = Boolean(cookies.githubToken);
  const hasGithubUsernameCookie = Boolean(cookies.githubUsername);
  const hasNetlifyCookie = Boolean(cookies.netlifyToken);

  // Get local storage status (this can only be checked client-side)
  const localStorageStatus = {
    explanation: 'Local storage can only be checked on the client side. Use browser devtools to check.',
    githubKeysToCheck: ['github_connection'],
    netlifyKeysToCheck: ['netlify_connection'],
  };

  // Check if CORS might be an issue
  const corsStatus = {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  };

  // Check if API endpoints are reachable
  const apiEndpoints = {
    githubUser: '/api/system/git-info?action=getUser',
    githubRepos: '/api/system/git-info?action=getRepos',
    githubOrgs: '/api/system/git-info?action=getOrgs',
    githubActivity: '/api/system/git-info?action=getActivity',
    gitInfo: '/api/system/git-info',
  };

  const githubApiStatus = await probeExternalApi(GITHUB_ZEN_URL, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github.v3+json',
    },
  });

  const netlifyApiStatus = await probeExternalApi(NETLIFY_API_URL, {
    method: 'GET',
  });

  // Provide technical details about the environment
  const technicalDetails = {
    serverTimestamp: new Date().toISOString(),
    userAgent: request.headers.get('User-Agent'),
    referrer: request.headers.get('Referer'),
    host: request.headers.get('Host'),
    method: request.method,
    url: request.url,
  };

  // Return diagnostics
  return json(
    {
      status: 'success',
      environment: envVars,
      cookies: {
        hasGithubTokenCookie,
        hasGithubUsernameCookie,
        hasNetlifyCookie,
      },
      localStorage: localStorageStatus,
      apiEndpoints,
      externalApis: {
        github: githubApiStatus,
        netlify: netlifyApiStatus,
      },
      corsStatus,
      technicalDetails,
    },
    {
      headers: corsStatus.headers,
    },
  );
};
