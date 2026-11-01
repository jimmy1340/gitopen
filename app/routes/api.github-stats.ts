import { json } from '@remix-run/cloudflare';
import { getApiKeysFromCookie } from '~/lib/api/cookies';
import { withSecurity } from '~/lib/security';
import type { GitHubUserResponse, GitHubStats } from '~/types/GitHub';

const MAX_REPO_PAGES = 10;
const REPOS_PER_PAGE = 100;
const BRANCH_LOOKUP_LIMIT = 50;
const BRANCH_LOOKUP_CONCURRENCY = 5;

async function mapSettledWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;

      try {
        results[index] = { status: 'fulfilled', value: await mapper(items[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

async function githubStatsLoader({ request, context }: { request: Request; context: any }) {
  try {
    // Get API keys from cookies (server-side only)
    const cookieHeader = request.headers.get('Cookie');
    const apiKeys = getApiKeysFromCookie(cookieHeader);

    // Try to get GitHub token from various sources
    const githubToken =
      apiKeys.GITHUB_API_KEY ||
      apiKeys.VITE_GITHUB_ACCESS_TOKEN ||
      context?.cloudflare?.env?.GITHUB_TOKEN ||
      context?.cloudflare?.env?.VITE_GITHUB_ACCESS_TOKEN ||
      process.env.GITHUB_TOKEN ||
      process.env.VITE_GITHUB_ACCESS_TOKEN;

    if (!githubToken) {
      return json({ error: 'GitHub token not found' }, { status: 401 });
    }

    // Get user info first
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        Authorization: `Bearer ${githubToken}`,
        'User-Agent': 'bolt.diy-app',
      },
    });

    if (!userResponse.ok) {
      if (userResponse.status === 401) {
        return json({ error: 'Invalid GitHub token' }, { status: 401 });
      }

      throw new Error(`GitHub API error: ${userResponse.status}`);
    }

    const user = (await userResponse.json()) as GitHubUserResponse;

    // At most 10 repo pages (1000 items). A page shorter than 100 items still ends the loop.
    let allRepos: any[] = [];
    let page = 1;

    while (page <= MAX_REPO_PAGES) {
      const repoResponse = await fetch(
        `https://api.github.com/user/repos?sort=updated&per_page=${REPOS_PER_PAGE}&page=${page}&affiliation=owner,organization_member`,
        {
          headers: {
            Accept: 'application/vnd.github.v3+json',
            Authorization: `Bearer ${githubToken}`,
            'User-Agent': 'bolt.diy-app',
          },
        },
      );

      if (!repoResponse.ok) {
        throw new Error(`GitHub API error: ${repoResponse.status}`);
      }

      const repos: any[] = await repoResponse.json();
      allRepos = allRepos.concat(repos);

      if (repos.length < REPOS_PER_PAGE) {
        break;
      }

      page += 1;
    }

    // Fetch branch counts for the first 50 repos, with at most 5 requests in flight.
    const reposWithBranches = await mapSettledWithConcurrency(
      allRepos.slice(0, BRANCH_LOOKUP_LIMIT),
      BRANCH_LOOKUP_CONCURRENCY,
      async (repo) => {
        try {
          const branchesResponse = await fetch(`https://api.github.com/repos/${repo.full_name}/branches?per_page=1`, {
            headers: {
              Accept: 'application/vnd.github.v3+json',
              Authorization: `Bearer ${githubToken}`,
              'User-Agent': 'bolt.diy-app',
            },
          });

          if (branchesResponse.ok) {
            const linkHeader = branchesResponse.headers.get('Link');
            let branchesCount = 1; // At least 1 branch (default)

            if (linkHeader) {
              const match = linkHeader.match(/page=(\d+)>; rel="last"/);

              if (match) {
                branchesCount = parseInt(match[1], 10);
              }
            }

            return {
              ...repo,
              branches_count: branchesCount,
            };
          }

          return repo;
        } catch (error) {
          console.warn(`Failed to fetch branches for ${repo.full_name}:`, error);
          return repo;
        }
      },
    );

    // Update repositories with branch information where available
    allRepos = allRepos.map((repo, index) => {
      if (index < reposWithBranches.length && reposWithBranches[index].status === 'fulfilled') {
        return reposWithBranches[index].value;
      }

      return repo;
    });

    // Calculate comprehensive stats
    const now = new Date();
    const publicRepos = allRepos.filter((repo) => !repo.private).length;
    const privateRepos = allRepos.filter((repo) => repo.private).length;

    // Language statistics
    const languageStats = new Map<string, number>();
    allRepos.forEach((repo) => {
      if (repo.language) {
        languageStats.set(repo.language, (languageStats.get(repo.language) || 0) + 1);
      }
    });

    // Activity stats
    const totalStars = allRepos.reduce((sum, repo) => sum + (repo.stargazers_count || 0), 0);
    const totalForks = allRepos.reduce((sum, repo) => sum + (repo.forks_count || 0), 0);

    // Recent activity (repos updated in last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Popular repositories (top 10 by stars)

    const stats: GitHubStats = {
      repos: allRepos.map((repo) => ({
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        html_url: repo.html_url,
        clone_url: repo.clone_url || '',
        description: repo.description,
        private: repo.private,
        language: repo.language,
        updated_at: repo.updated_at,
        stargazers_count: repo.stargazers_count || 0,
        forks_count: repo.forks_count || 0,
        watchers_count: repo.watchers_count || 0,
        topics: repo.topics || [],
        fork: repo.fork || false,
        archived: repo.archived || false,
        size: repo.size || 0,
        default_branch: repo.default_branch || 'main',
        languages_url: repo.languages_url || '',
      })),
      organizations: [],
      recentActivity: [],
      languages: {},
      totalGists: user.public_gists || 0,
      publicRepos,
      privateRepos,
      stars: totalStars,
      forks: totalForks,
      totalStars,
      totalForks,
      followers: user.followers || 0,
      publicGists: user.public_gists || 0,
      privateGists: 0, // GitHub API doesn't provide private gists count directly
      lastUpdated: now.toISOString(),
    };

    return json(stats);
  } catch (error) {
    console.error('Error fetching GitHub stats:', error);
    return json(
      {
        error: 'Failed to fetch GitHub statistics',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

export const loader = withSecurity(githubStatsLoader, {
  rateLimit: true,
  allowedMethods: ['GET'],
});
