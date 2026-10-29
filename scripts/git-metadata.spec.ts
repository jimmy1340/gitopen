import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { appVersion, getGitMetadata, gitDefineConstants, repoNameFromRemote, sanitizeRemoteUrl } from './git-metadata';

describe('sanitizeRemoteUrl', () => {
  it('strips credentials from https remotes', () => {
    const sanitized = sanitizeRemoteUrl('https://x-access-token:secret-token@github.com/jimmy1340/gitopen.git');

    expect(sanitized).toBe('https://github.com/jimmy1340/gitopen.git');
    expect(sanitized).not.toContain('secret-token');
    expect(sanitized).not.toContain('x-access-token');
    expect(new URL(sanitized).username).toBe('');
    expect(new URL(sanitized).password).toBe('');
  });

  it('leaves scp-style remotes unchanged', () => {
    expect(sanitizeRemoteUrl('git@github.com:jimmy1340/gitopen.git')).toBe('git@github.com:jimmy1340/gitopen.git');
  });

  it('falls back when the remote is missing', () => {
    expect(sanitizeRemoteUrl('')).toBe('local');
    expect(sanitizeRemoteUrl(undefined)).toBe('local');
  });
});

describe('repoNameFromRemote', () => {
  it.each([
    ['https://github.com/jimmy1340/gitopen.git', 'gitopen'],
    ['https://x-access-token:secret@github.com/jimmy1340/gitopen', 'gitopen'],
    ['git@github.com:jimmy1340/gitopen.git', 'gitopen'],
    ['', 'gitopen'],
  ])('reads %s as %s', (remote, name) => {
    expect(repoNameFromRemote(remote)).toBe(name);
  });
});

describe('getGitMetadata', () => {
  it('matches this checkout and does not embed remote credentials', () => {
    const expectedHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const meta = getGitMetadata();

    expect(meta.commitHash).toBe(expectedHash);
    expect(meta.repoName).toBe('gitopen');
    expect(meta.remoteUrl).not.toContain('x-access-token');
    expect(meta.remoteUrl).not.toMatch(/:\/\/[^/]*@/);
    expect(meta.commitMessage.length).toBeGreaterThan(0);
  });

  it('json-encodes define values, including an explicit app version', () => {
    const defines = gitDefineConstants('1.2.3');

    expect(JSON.parse(defines['__APP_VERSION'])).toBe('1.2.3');
    expect(JSON.parse(defines['__COMMIT_HASH'])).toMatch(/^[0-9a-f]+$/);
    expect(JSON.parse(defines['__GIT_REPO_NAME'])).toBe('gitopen');
    expect(JSON.parse(defines['__GIT_REMOTE_URL'])).not.toContain('x-access-token');
  });

  it('reads the package version when npm does not inject one', () => {
    const previous = process.env.npm_package_version;
    delete process.env.npm_package_version;

    try {
      expect(appVersion()).toBe('1.0.2');
      expect(JSON.parse(gitDefineConstants()['__APP_VERSION'])).toBe('1.0.2');
    } finally {
      if (previous === undefined) {
        delete process.env.npm_package_version;
      } else {
        process.env.npm_package_version = previous;
      }
    }
  });
});
