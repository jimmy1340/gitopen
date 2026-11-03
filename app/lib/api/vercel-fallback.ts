/*
 * The deployment lookup is a GET so it does not collide with the deploy POST.
 * The Vercel token belongs in the Authorization header: a query param would be
 * stored in access logs.
 */
export function vercelDeploymentFallbackRequest(
  projectId: string,
  token: string,
): {
  url: string;
  init: RequestInit;
} {
  const params = new URLSearchParams({ projectId });

  return {
    url: `/api/vercel-deploy?${params.toString()}`,
    init: {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    },
  };
}

export function readBearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization');

  if (!header) {
    return null;
  }

  const match = /^Bearer\s+(\S.*)$/i.exec(header.trim());
  const token = match?.[1]?.trim();

  return token ? token : null;
}
