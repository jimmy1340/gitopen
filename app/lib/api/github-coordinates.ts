const GITHUB_REPO_SEGMENT = /^[A-Za-z0-9_.-]+$/;

/*
 * Owner and repository names are concatenated into GitHub API paths.
 * Allow only [A-Za-z0-9_.-]. Reject ".." anywhere in a segment, and reject
 * a segment of ".": the URL parser drops "." and ".." segments and rewrites
 * the path. Spaces, "?", and "#" are outside the character set, so they
 * cannot start a query string or fragment either.
 */
export function isGitHubRepoSegment(value: unknown): value is string {
  return typeof value === 'string' && value !== '.' && GITHUB_REPO_SEGMENT.test(value) && !value.includes('..');
}

/** `owner/name` with exactly one slash and two safe segments. */
export function isGitHubRepoCoordinate(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const slash = value.indexOf('/');

  if (slash <= 0 || value.indexOf('/', slash + 1) !== -1) {
    return false;
  }

  return isGitHubRepoSegment(value.slice(0, slash)) && isGitHubRepoSegment(value.slice(slash + 1));
}
