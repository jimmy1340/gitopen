import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface GitBuildMetadata {
  commitHash: string;
  branch: string;
  commitTime: string;
  commitMessage: string;
  author: string;
  email: string;
  remoteUrl: string;
  repoName: string;
}

/**
 * Drop userinfo from https remotes. Cloud and CI checkouts often embed a token
 * in `remote.origin.url`, and these values are compiled into the client.
 */
export function sanitizeRemoteUrl(remoteUrl: string | undefined | null): string {
  if (!remoteUrl) {
    return 'local';
  }

  const trimmed = remoteUrl.trim();

  if (!trimmed) {
    return 'local';
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      url.username = '';
      url.password = '';
      url.hash = '';
      url.search = '';

      return url.toString();
    } catch {
      return trimmed.replace(/\/\/(?:[^/@\s]+)(?::[^/@\s]*)?@/, '//');
    }
  }

  return trimmed;
}

export function repoNameFromRemote(remoteUrl: string | undefined | null, fallback = 'gitopen'): string {
  const sanitized = sanitizeRemoteUrl(remoteUrl);

  if (sanitized === 'local') {
    return fallback;
  }

  const withoutGit = sanitized.replace(/\.git\/?$/, '').replace(/\/$/, '');
  const tail = withoutGit.split(/[:/]/).filter(Boolean).pop();

  return tail || fallback;
}

export function appVersion(): string {
  if (process.env.npm_package_version) {
    return process.env.npm_package_version;
  }

  try {
    const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: string };

    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function readGitValue(command: string, fallback: string): string {
  try {
    const value = execSync(command, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    return value || fallback;
  } catch {
    return fallback;
  }
}

export function getGitMetadata(): GitBuildMetadata {
  const remoteUrl = sanitizeRemoteUrl(readGitValue('git config --get remote.origin.url', ''));

  return {
    commitHash: readGitValue('git rev-parse --short HEAD', 'no-git-info'),
    branch: readGitValue('git rev-parse --abbrev-ref HEAD', 'unknown'),
    commitTime: readGitValue('git log -1 --format=%cI', new Date().toISOString()),
    commitMessage: readGitValue('git log -1 --format=%s', 'unknown'),
    author: readGitValue('git log -1 --format=%an', 'unknown'),
    email: readGitValue('git log -1 --format=%ae', 'unknown@local'),
    remoteUrl,
    repoName: repoNameFromRemote(remoteUrl),
  };
}

export function gitDefineConstants(version = appVersion()): Record<string, string> {
  const meta = getGitMetadata();
  const defines: Record<string, string> = {};

  /*
   * String keys, not bare identifiers. Vite's `define` rewrites identifiers
   * with these names, which would corrupt this object if the file is transformed.
   */
  defines['__COMMIT_HASH'] = JSON.stringify(meta.commitHash);
  defines['__GIT_BRANCH'] = JSON.stringify(meta.branch);
  defines['__GIT_COMMIT_TIME'] = JSON.stringify(meta.commitTime);
  defines['__GIT_COMMIT_MESSAGE'] = JSON.stringify(meta.commitMessage);
  defines['__GIT_AUTHOR'] = JSON.stringify(meta.author);
  defines['__GIT_EMAIL'] = JSON.stringify(meta.email);
  defines['__GIT_REMOTE_URL'] = JSON.stringify(meta.remoteUrl);
  defines['__GIT_REPO_NAME'] = JSON.stringify(meta.repoName);
  defines['__APP_VERSION'] = JSON.stringify(version);

  return defines;
}
