import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * 把远端图片（Lovart 产物、竞品图等）下载到本地。
 * a.lovart.ai 直连不通，走本机代理 127.0.0.1:7897。
 */
export function buildCurlFetchArgs({ url, output, proxy, timeoutSec = 120 }) {
  const args = ['-s', '-L', '--max-time', String(timeoutSec), '-o', output];
  if (proxy) args.push('-x', proxy);
  args.push(url);
  return args;
}

export function fetchImageToFile({ url, output, proxy = process.env.OZON_HTTP_PROXY ?? 'http://127.0.0.1:7897', curl = 'curl.exe' }) {
  mkdirSync(dirname(output), { recursive: true });
  execFileSync(curl, buildCurlFetchArgs({ url, output, proxy }), { stdio: ['ignore', 'pipe', 'pipe'] });
  return { output };
}
