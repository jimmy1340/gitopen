import { json } from '@remix-run/cloudflare';

function readBuildConstant(kind: string, value: string): string {
  return kind === 'string' ? value : '';
}

/**
 * Build snapshot of this repo. The previous loader shelled out to git on every
 * request, which fails on Cloudflare Pages (no child_process) and was unused
 * by the app. Values come from Vite `define` in vite.config.ts.
 */
export async function loader() {
  const remoteUrl = readBuildConstant(
    typeof __GIT_REMOTE_URL,
    typeof __GIT_REMOTE_URL === 'string' ? __GIT_REMOTE_URL : '',
  );

  return json({
    branch: readBuildConstant(typeof __GIT_BRANCH, typeof __GIT_BRANCH === 'string' ? __GIT_BRANCH : '') || 'unknown',
    commit:
      readBuildConstant(typeof __COMMIT_HASH, typeof __COMMIT_HASH === 'string' ? __COMMIT_HASH : '') || 'unknown',
    isDirty: false,
    remoteUrl: remoteUrl && remoteUrl !== 'local' ? remoteUrl : undefined,
    lastCommit: {
      message:
        readBuildConstant(
          typeof __GIT_COMMIT_MESSAGE,
          typeof __GIT_COMMIT_MESSAGE === 'string' ? __GIT_COMMIT_MESSAGE : '',
        ) || 'unknown',
      date:
        readBuildConstant(typeof __GIT_COMMIT_TIME, typeof __GIT_COMMIT_TIME === 'string' ? __GIT_COMMIT_TIME : '') ||
        'unknown',
      author: readBuildConstant(typeof __GIT_AUTHOR, typeof __GIT_AUTHOR === 'string' ? __GIT_AUTHOR : '') || 'unknown',
    },
  });
}
