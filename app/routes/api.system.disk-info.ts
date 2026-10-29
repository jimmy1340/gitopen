import { json, type ActionFunctionArgs, type LoaderFunction } from '@remix-run/cloudflare';

interface DiskInfo {
  filesystem: string;
  size: number;
  used: number;
  available: number;
  percentage: number;
  mountpoint: string;
  timestamp: string;
  error?: string;
}

/*
 * Host disk metrics are not available on Cloudflare Pages, which is the deploy
 * target. The previous loader set `execSync` to null and left the `df` /
 * PowerShell branches unreachable, so callers only ever saw random mock disks
 * or an error. Return one stable record instead of shelling out.
 */
function unavailableDiskInfo(): DiskInfo[] {
  return [
    {
      filesystem: 'unavailable',
      size: 0,
      used: 0,
      available: 0,
      percentage: 0,
      mountpoint: 'n/a',
      timestamp: new Date().toISOString(),
      error: 'Host disk metrics are not collected in this runtime.',
    },
  ];
}

export const loader: LoaderFunction = async () => {
  return json(unavailableDiskInfo());
};

export const action = async (_args: ActionFunctionArgs) => {
  return json(unavailableDiskInfo());
};
