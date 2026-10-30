import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';

// Rate limiting store (in-memory for serverless environments)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

// Rate limit configuration. More specific patterns must win over `/api/*`.
const RATE_LIMITS = {
  // General API endpoints
  '/api/*': { windowMs: 15 * 60 * 1000, maxRequests: 100 }, // 100 requests per 15 minutes

  // LLM API (more restrictive)
  '/api/llmcall': { windowMs: 60 * 1000, maxRequests: 10 }, // 10 requests per minute

  // GitHub API endpoints
  '/api/github-*': { windowMs: 60 * 1000, maxRequests: 30 }, // 30 requests per minute

  // Netlify API endpoints
  '/api/netlify-*': { windowMs: 60 * 1000, maxRequests: 20 }, // 20 requests per minute
};

export const MAX_RATE_LIMIT_KEYS = 4096;

type RateLimitConfig = { windowMs: number; maxRequests: number };

/**
 * The first matching pattern used to win, and `/api/*` is declared first, so the
 * llmcall / github / netlify limits never ran. Longer (and exact) patterns win.
 */
export function resolveRateLimit(endpoint: string): RateLimitConfig | undefined {
  let best: { specificity: number; config: RateLimitConfig } | undefined;

  for (const [pattern, config] of Object.entries(RATE_LIMITS)) {
    if (!rateLimitPatternMatches(pattern, endpoint)) {
      continue;
    }

    const specificity = pattern.endsWith('*') ? pattern.length - 1 : pattern.length + 1000;

    if (!best || specificity > best.specificity) {
      best = { specificity, config };
    }
  }

  return best?.config;
}

function rateLimitPatternMatches(pattern: string, endpoint: string): boolean {
  if (pattern.endsWith('*')) {
    return endpoint.startsWith(pattern.slice(0, -1));
  }

  return endpoint === pattern;
}

/**
 * Rate limiting middleware.
 * `now` is injectable so tests can move the window without mocking the clock.
 */
export function checkRateLimit(
  request: Request,
  endpoint: string,
  now = Date.now(),
): { allowed: boolean; resetTime?: number } {
  const config = resolveRateLimit(endpoint);

  if (!config) {
    return { allowed: true };
  }

  const key = `${getClientIP(request)}:${endpoint}`;

  pruneRateLimitStore(now);

  let entry = rateLimitStore.get(key);

  if (!entry || now >= entry.resetTime) {
    entry = { count: 0, resetTime: now + config.windowMs };
  }

  if (entry.count >= config.maxRequests) {
    return { allowed: false, resetTime: entry.resetTime };
  }

  entry.count += 1;
  rateLimitStore.set(key, entry);

  if (rateLimitStore.size > MAX_RATE_LIMIT_KEYS) {
    pruneRateLimitStore(now);
  }

  return { allowed: true };
}

export function resetRateLimitState(): void {
  rateLimitStore.clear();
}

export function getRateLimitStoreSize(): number {
  return rateLimitStore.size;
}

function pruneRateLimitStore(now: number): void {
  if (rateLimitStore.size <= 256) {
    return;
  }

  for (const [storedKey, data] of rateLimitStore) {
    if (data.resetTime <= now) {
      rateLimitStore.delete(storedKey);
    }
  }

  if (rateLimitStore.size <= MAX_RATE_LIMIT_KEYS) {
    return;
  }

  const overflow = rateLimitStore.size - MAX_RATE_LIMIT_KEYS;
  const oldest = [...rateLimitStore.entries()]
    .sort((left, right) => left[1].resetTime - right[1].resetTime)
    .slice(0, overflow);

  for (const [storedKey] of oldest) {
    rateLimitStore.delete(storedKey);
  }
}

/**
 * Get client IP address from request
 */
function getClientIP(request: Request): string {
  // Try various headers that might contain the real IP
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIP = request.headers.get('x-real-ip');
  const cfConnectingIP = request.headers.get('cf-connecting-ip');

  // Return the first available IP or a fallback
  return cfConnectingIP || realIP || forwardedFor?.split(',')[0]?.trim() || 'unknown';
}

/**
 * Security headers middleware
 */
export function createSecurityHeaders() {
  return {
    // Prevent clickjacking
    'X-Frame-Options': 'DENY',

    // Prevent MIME type sniffing
    'X-Content-Type-Options': 'nosniff',

    // Enable XSS protection
    'X-XSS-Protection': '1; mode=block',

    // Content Security Policy - restrict to same origin and trusted sources
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Allow inline scripts for React
      "style-src 'self' 'unsafe-inline'", // Allow inline styles
      "img-src 'self' data: https: blob:", // Allow images from same origin, data URLs, and HTTPS
      "font-src 'self' data:", // Allow fonts from same origin and data URLs
      "connect-src 'self' https://api.github.com https://api.netlify.com", // Allow connections to GitHub and Netlify APIs
      "frame-src 'none'", // Prevent iframe embedding
      "object-src 'none'", // Prevent object embedding
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),

    // Referrer Policy
    'Referrer-Policy': 'strict-origin-when-cross-origin',

    // Permissions Policy (formerly Feature Policy)
    'Permissions-Policy': ['camera=()', 'microphone=()', 'geolocation=()', 'payment=()'].join(', '),

    // HSTS (HTTP Strict Transport Security) - only in production
    ...(process.env.NODE_ENV === 'production'
      ? {
          'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
        }
      : {}),
  };
}

/**
 * Returns true for hostnames that must never be reached through server-side proxies:
 * localhost, private/loopback/link-local ranges and internal-only name suffixes.
 * Expects a hostname as produced by `new URL(...).hostname` (numeric hosts are already normalised).
 */
export function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');

  if (!host) {
    return true;
  }

  if (
    host === 'localhost' ||
    ['.localhost', '.local', '.internal', '.lan', '.home.arpa'].some((s) => host.endsWith(s))
  ) {
    return true;
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);

  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);

    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }

  if (host.includes(':')) {
    return host === '::' || host === '::1' || /^(fc|fd|fe[89ab])/.test(host) || host.startsWith('::ffff:');
  }

  // Any remaining all-numeric / hex host is an obfuscated IPv4 literal
  return /^(0x[0-9a-f]+|\d+)$/.test(host);
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_PUBLIC_REDIRECTS = 5;

export class DisallowedUrlError extends Error {
  constructor(message = 'Target host is not allowed') {
    super(message);
    this.name = 'DisallowedUrlError';
  }
}

function parsePublicHttpsUrl(input: string): URL {
  if (typeof input !== 'string' || input.length === 0 || input.length > 2048) {
    throw new DisallowedUrlError();
  }

  let target: URL;

  try {
    target = new URL(input);
  } catch {
    throw new DisallowedUrlError();
  }

  if (target.protocol !== 'https:' || target.username || target.password || isPrivateOrLocalHost(target.hostname)) {
    throw new DisallowedUrlError();
  }

  return target;
}

/**
 * Fetch an https URL that is not loopback, private, or link-local.
 * Redirects are checked the same way. `redirect: 'follow'` would skip that check,
 * and credentials are dropped when the origin changes.
 */
export async function fetchPublicHttps(input: string, init: RequestInit = {}): Promise<Response> {
  let current = parsePublicHttpsUrl(input);
  const headers = new Headers(init.headers);
  const method = init.method ?? 'GET';

  for (let redirects = 0; ; redirects++) {
    const response = await fetch(current.toString(), {
      method,
      headers,
      body: init.body,
      redirect: 'manual',
    });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    await response.body?.cancel().catch(() => undefined);

    if (redirects >= MAX_PUBLIC_REDIRECTS) {
      throw new DisallowedUrlError('Too many redirects');
    }

    const location = response.headers.get('location');

    if (!location) {
      throw new DisallowedUrlError('Invalid redirect URL');
    }

    let next: URL;

    try {
      next = parsePublicHttpsUrl(new URL(location, current).toString());
    } catch (error) {
      if (error instanceof DisallowedUrlError) {
        throw error;
      }

      throw new DisallowedUrlError('Invalid redirect URL');
    }

    if (next.origin !== current.origin) {
      headers.delete('authorization');
    }

    current = next;
  }
}

/**
 * Validate API key format (basic validation)
 */
export function validateApiKeyFormat(apiKey: string, provider: string): boolean {
  if (!apiKey || typeof apiKey !== 'string') {
    return false;
  }

  // Basic length checks for different providers
  const minLengths: Record<string, number> = {
    anthropic: 50,
    openai: 50,
    groq: 50,
    google: 30,
    github: 30,
    netlify: 30,
  };

  const minLength = minLengths[provider.toLowerCase()] || 20;

  return apiKey.length >= minLength && !apiKey.includes('your_') && !apiKey.includes('here');
}

/**
 * Sanitize error messages to prevent information leakage
 */
export function sanitizeErrorMessage(error: unknown, isDevelopment = false): string {
  if (isDevelopment) {
    // In development, show full error details
    return error instanceof Error ? error.message : String(error);
  }

  // In production, show generic messages to prevent information leakage
  if (error instanceof Error) {
    // Check for sensitive information in error messages
    if (error.message.includes('API key') || error.message.includes('token') || error.message.includes('secret')) {
      return 'Authentication failed';
    }

    if (error.message.includes('rate limit') || error.message.includes('429')) {
      return 'Rate limit exceeded. Please try again later.';
    }
  }

  return 'An unexpected error occurred';
}

/**
 * Security wrapper for API routes
 */
export function withSecurity<T extends (args: ActionFunctionArgs | LoaderFunctionArgs) => Promise<Response>>(
  handler: T,
  options: {
    requireAuth?: boolean;
    rateLimit?: boolean;
    allowedMethods?: string[];
  } = {},
) {
  return async (args: ActionFunctionArgs | LoaderFunctionArgs): Promise<Response> => {
    const { request } = args;
    const url = new URL(request.url);
    const endpoint = url.pathname;

    // Check allowed methods
    if (options.allowedMethods && !options.allowedMethods.includes(request.method)) {
      return new Response('Method not allowed', {
        status: 405,
        headers: createSecurityHeaders(),
      });
    }

    /*
     * The app has no authentication backend, so a route that asks for auth can never be satisfied.
     * Fail closed instead of silently serving it to unauthenticated callers.
     */
    if (options.requireAuth) {
      return new Response('Authentication required', {
        status: 401,
        headers: createSecurityHeaders(),
      });
    }

    // Apply rate limiting
    if (options.rateLimit !== false) {
      const rateLimitResult = checkRateLimit(request, endpoint);

      if (!rateLimitResult.allowed) {
        return new Response('Rate limit exceeded', {
          status: 429,
          headers: {
            ...createSecurityHeaders(),
            'Retry-After': Math.ceil((rateLimitResult.resetTime! - Date.now()) / 1000).toString(),
            'X-RateLimit-Reset': rateLimitResult.resetTime!.toString(),
          },
        });
      }
    }

    try {
      // Execute the handler
      const response = await handler(args);

      // Add security headers to response
      const responseHeaders = new Headers(response.headers);
      Object.entries(createSecurityHeaders()).forEach(([key, value]) => {
        responseHeaders.set(key, value);
      });

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      console.error('Security-wrapped handler error:', error);

      const errorMessage = sanitizeErrorMessage(error, process.env.NODE_ENV === 'development');

      return new Response(
        JSON.stringify({
          error: true,
          message: errorMessage,
        }),
        {
          status: 500,
          headers: {
            ...createSecurityHeaders(),
            'Content-Type': 'application/json',
          },
        },
      );
    }
  };
}
