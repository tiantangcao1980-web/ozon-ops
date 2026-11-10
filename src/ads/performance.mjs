/**
 * Ozon Performance API 客户端（广告）。
 * 认证：OAuth2 client_credentials → Bearer token；token 缓存到 expires_in。
 * 凭据只从环境/`.secrets/ozon.env` 读取，永不打印。
 */
const BASE = 'https://api-performance.ozon.ru';

export function hasPerformanceCredentials(env = process.env) {
  return Boolean(env.OZON_PERF_CLIENT_ID && env.OZON_PERF_CLIENT_SECRET);
}

export function createPerformanceClient({ clientId, clientSecret, fetchImpl = fetch, now = () => Date.now() }) {
  let token = null;
  let expiresAt = 0;

  async function ensureToken() {
    if (token && now() < expiresAt - 30_000) return token;
    const response = await fetchImpl(`${BASE}/api/client/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
    });
    const text = await response.text();
    const json = JSON.parse(text || '{}');
    if (!response.ok || !json.access_token) {
      throw new Error(`Performance 认证失败：HTTP ${response.status} ${json.message ?? ''}`.trim());
    }
    token = json.access_token;
    expiresAt = now() + Number(json.expires_in ?? 1800) * 1000;
    return token;
  }

  async function get(path, body = null) {
    const bearer = await ensureToken();
    const response = await fetchImpl(`${BASE}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, ok: response.ok, json, text };
  }

  return { get, ensureToken };
}
