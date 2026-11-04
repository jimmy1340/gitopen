import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { resolveAssetPath } from './asset-path';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/app',
  },
}));

const { serveAsset } = await import('./serve');

describe('resolveAssetPath', () => {
  const root = path.resolve('/app/assets');

  it('resolves a file inside the root', () => {
    expect(resolveAssetPath(root, 'index.html')).toBe(path.join(root, 'index.html'));
    expect(resolveAssetPath(root, 'nested/app.js')).toBe(path.join(root, 'nested', 'app.js'));
    expect(resolveAssetPath(root, 'nested/../index.html')).toBe(path.join(root, 'index.html'));
    expect(resolveAssetPath(`${root}${path.sep}`, 'index.html')).toBe(path.join(root, 'index.html'));
  });

  it('rejects .. that leaves the root', () => {
    expect(resolveAssetPath(root, '../secret')).toBeUndefined();
    expect(resolveAssetPath(root, '/../secret')).toBeUndefined();
    expect(resolveAssetPath(root, '../../etc/passwd')).toBeUndefined();
    expect(resolveAssetPath(root, 'nested/../../secret')).toBeUndefined();
  });

  it('rejects a prefix sibling that startsWith(root) would allow', () => {
    const sibling = path.join(root, '/../assets-evil/secret');

    expect(sibling).toBe(path.resolve('/app/assets-evil/secret'));
    expect(sibling.startsWith(root)).toBe(true);
    expect(sibling.startsWith(`${root}${path.sep}`)).toBe(false);
    expect(resolveAssetPath(root, '../assets-evil/secret')).toBeUndefined();
    expect(resolveAssetPath(root, '/../assets-evil/secret')).toBeUndefined();
  });

  it('rejects an absolute path outside the root', () => {
    expect(resolveAssetPath(root, '/etc/passwd')).toBeUndefined();
    expect(resolveAssetPath(root, path.resolve('/etc/passwd'))).toBeUndefined();
    expect(resolveAssetPath(root, path.resolve('/app/assets-evil/secret'))).toBeUndefined();
  });
});

describe('serveAsset', () => {
  let parent: string;
  let root: string;

  beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    parent = await mkdtemp(path.join(os.tmpdir(), 'gitopen-assets-'));
    root = path.join(parent, 'assets');
    await mkdir(path.join(root, 'nested'), { recursive: true });
    await mkdir(path.join(parent, 'assets-evil'));
    await writeFile(path.join(root, 'ok.txt'), 'hello-asset');
    await writeFile(path.join(root, 'nested', 'app.js'), 'console.log(1)');
    await writeFile(path.join(parent, 'assets-evil', 'secret'), 'sibling-secret');
    await writeFile(path.join(parent, 'secret.txt'), 'parent-secret');
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await rm(parent, { recursive: true, force: true });
  });

  it('returns a readable stream for a file inside the root', async () => {
    const response = await serveAsset(new Request('http://127.0.0.1/ok.txt'), root);

    expect(response).toBeInstanceOf(Response);
    expect(response?.body).toBeInstanceOf(ReadableStream);
    expect(response?.headers.get('Content-Type')).toMatch(/^text\/plain/);
    expect(await response?.text()).toBe('hello-asset');
  });

  it('serves a nested file inside the root', async () => {
    const response = await serveAsset(new Request('http://127.0.0.1/nested/app.js'), root);

    expect(await response?.text()).toBe('console.log(1)');
  });

  it('does not serve a prefix sibling reached with an encoded ..', async () => {
    const response = await serveAsset(new Request('http://127.0.0.1/%2e%2e%2fassets-evil/secret'), root);

    expect(response).toBeUndefined();
  });

  it('does not serve a parent file reached with ..', async () => {
    const response = await serveAsset(new Request('http://127.0.0.1/%2e%2e%2fsecret.txt'), root);

    expect(response).toBeUndefined();
  });

  it('does not serve an absolute path', async () => {
    const response = await serveAsset(new Request('http://127.0.0.1/%2fetc%2fpasswd'), root);

    expect(response).toBeUndefined();
  });
});
