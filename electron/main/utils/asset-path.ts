import path from 'node:path';

/**
 * Resolve `pathname` against `root` and return the absolute path only when it
 * stays strictly inside `root`.
 *
 * `path.resolve` normalizes `..` and, when `pathname` is absolute, discards
 * `root`. The result must still begin with `root + sep`, so a prefix sibling
 * such as `/app/assets-evil` is not treated as inside `/app/assets`.
 * Does not touch the filesystem and does not use Electron.
 */
export function resolveAssetPath(root: string, pathname: string): string | undefined {
  const base = path.resolve(root);
  const resolved = path.resolve(base, pathname);
  const prefix = base.endsWith(path.sep) ? base : `${base}${path.sep}`;

  if (!resolved.startsWith(prefix)) {
    return undefined;
  }

  return resolved;
}
