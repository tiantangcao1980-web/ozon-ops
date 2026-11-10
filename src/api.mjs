import { createHash } from 'node:crypto';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code ?? null;
  }
}

const DEFAULT_BASE_URL = 'https://api-seller.ozon.ru';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Ozon Seller API 客户端：鉴权、重试、限频退避、缓存、审计。
 * 凭据只存于闭包，错误与审计里都不会出现。
 *
 * @param {{
 *   clientId: string,
 *   apiKey: string,
 *   fetchImpl?: typeof fetch,
 *   sleep?: (ms: number) => Promise<void>,
 *   now?: () => number,
 *   audit?: (row: object) => void,
 *   baseUrl?: string,
 *   timeoutMs?: number,
 * }} options
 */
export function createApi({
  clientId,
  apiKey,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  audit = () => {},
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = 60_000,
}) {
  const cache = new Map();

  return {
    /**
     * @param {string} path
     * @param {object} [body]
     * @param {{ttlMs?: number, maxRetries?: number}} [opts]
     */
    async call(path, body = {}, opts = {}) {
      const { ttlMs = 0, maxRetries = 3 } = opts;
      const cacheKey = `${path}:${sha256(JSON.stringify(body ?? {}))}`;

      if (ttlMs > 0) {
        const hit = cache.get(cacheKey);
        if (hit && now() < hit.expires) {
          return { ...hit.value, fromCache: true };
        }
      }

      let attempt = 0;
      for (;;) {
        const started = now();
        const auditBase = { path, calledAt: new Date(started).toISOString() };
        try {
          const res = await fetchImpl(`${baseUrl}${path}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Client-Id': clientId,
              'Api-Key': apiKey,
            },
            body: JSON.stringify(body ?? {}),
            signal: AbortSignal.timeout(timeoutMs),
          });
          const text = await res.text();
          const json = safeParse(text);
          const bytes = Buffer.byteLength(text, 'utf8');
          const ms = now() - started;

          audit({ ...auditBase, status: res.status, ms, bytes });

          if (res.ok) {
            const value = { status: res.status, ok: true, json, text, bytes, ms, fromCache: false };
            if (ttlMs > 0) cache.set(cacheKey, { value, expires: now() + ttlMs });
            return value;
          }

          const code = json && typeof json === 'object' ? (json.code ?? null) : null;
          const message = json && typeof json === 'object' && json.message ? json.message : text.slice(0, 200);

          if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
            attempt += 1;
            const retryAfter = Number(res.headers.get('retry-after'));
            const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * attempt;
            const delay = Math.min(retryAfterMs, 60_000); // 服务端 Retry-After 可能是几小时，必须设上限
            await sleep(delay);
            continue;
          }

          throw new ApiError(res.status, code, message);
        } catch (error) {
          if (error instanceof ApiError) throw error;
          const ms = now() - started;
          const message = String(error && error.message ? error.message : error).slice(0, 200);
          audit({ ...auditBase, status: 0, ms, error: message });
          if (attempt < maxRetries) {
            attempt += 1;
            await sleep(1500 * attempt);
            continue;
          }
          throw new ApiError(0, null, `网络错误：${message}`);
        }
      }
    },
  };
}
