import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export class ConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ConfigError';
    this.code = code;
  }
}

function parseEnv(text) {
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].trim().replace(/^["'<\s]+|["'>\s]+$/g, '');
  }
  return env;
}

/**
 * @param {{root?: string, env?: Record<string, string|undefined>}} [options]
 */
export function loadConfig({ root = process.cwd(), env = process.env } = {}) {
  const projectRoot = resolve(root);
  const secretsPath = join(projectRoot, '.secrets', 'ozon.env');

  if (!existsSync(secretsPath) && !env.OZON_CLIENT_ID) {
    throw new ConfigError(
      'MISSING_CREDENTIALS',
      `缺少凭据文件：${secretsPath}。请写入 OZON_CLIENT_ID 与 OZON_API_KEY。`,
    );
  }

  const fileEnv = existsSync(secretsPath) ? parseEnv(readFileSync(secretsPath, 'utf8')) : {};
  const merged = { ...fileEnv };
  if (env.OZON_CLIENT_ID) merged.OZON_CLIENT_ID = env.OZON_CLIENT_ID;
  if (env.OZON_API_KEY) merged.OZON_API_KEY = env.OZON_API_KEY;
  if (env.OZON_PREMIUM_PRO) merged.OZON_PREMIUM_PRO = env.OZON_PREMIUM_PRO;

  const clientId = String(merged.OZON_CLIENT_ID ?? '').trim();
  const apiKey = String(merged.OZON_API_KEY ?? '').trim();

  if (!/^\d+$/.test(clientId)) {
    throw new ConfigError(
      'MALFORMED_CLIENT_ID',
      'OZON_CLIENT_ID 必须是纯数字（在卖家后台 设置 → Seller API 查看）。',
    );
  }
  if (apiKey.length < 10) {
    throw new ConfigError(
      'MISSING_CREDENTIALS',
      '缺少有效的 OZON_API_KEY（在卖家后台 设置 → Seller API 生成，创建后只显示一次）。',
    );
  }

  return {
    root: projectRoot,
    secretsPath,
    dbPath: join(projectRoot, 'db', 'ozon.db'),
    reportsDir: join(projectRoot, 'reports'),
    outboxDir: join(projectRoot, 'outbox'),
    dataDir: join(projectRoot, 'data'),
    clientId,
    apiKey,
    maskedClientId: `${clientId.slice(0, 4)}***`,
    premiumPro: String(merged.OZON_PREMIUM_PRO ?? '0') === '1',
    perfClientId: merged.OZON_PERF_CLIENT_ID ? String(merged.OZON_PERF_CLIENT_ID).trim() : null,
    perfClientSecret: merged.OZON_PERF_CLIENT_SECRET ? String(merged.OZON_PERF_CLIENT_SECRET).trim() : null,
  };
}

export { dirname };
