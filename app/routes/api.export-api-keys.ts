import type { LoaderFunction } from '@remix-run/cloudflare';
import { getApiKeysFromCookie } from '~/lib/api/cookies';

/*
 * Exports only the API keys that the caller already stores in their own browser cookie.
 *
 * Keys that come from server environment variables are intentionally NOT merged in:
 * this route has no authentication, so returning them would hand the server's
 * credentials to anyone who can reach the deployment.
 */
export const loader: LoaderFunction = async ({ request }) => {
  const apiKeys = getApiKeysFromCookie(request.headers.get('Cookie'));

  return Response.json(apiKeys, { headers: { 'Cache-Control': 'no-store' } });
};
