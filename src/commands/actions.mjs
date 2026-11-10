/**
 * 写操作：提案 → 人工确认 → 执行（默认 dry-run）。
 * 白名单 + 按条目限额 + 确认码 TTL + 审计；approve 不在模型工具面，只由 CLI 调用。
 *
 * 安全要点（来自代码评审）：
 * - 限额按「受影响条目数」而不是「请求次数」：一次 import/prices 可带几百个 offer。
 * - 写接口不重试（maxRetries=0）：超时后服务端可能已生效，重试会造成重复回复/重复改价。
 * - 无法确认是否生效时记 `unknown` 而不是 `failed`，避免人工误判后重复执行。
 */
import { randomInt } from 'node:crypto';

export class ActionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
  }
}

const WHITELIST = {
  price_update: { path: '/v1/product/import/prices', limitPerDay: 20 },
  stock_update: { path: '/v2/products/stocks', limitPerDay: 50 },
  review_reply: { path: '/v1/review/comment/create', limitPerDay: 30 },
  question_answer: { path: '/v1/question/answer/create', limitPerDay: 30 },
};

const CODE_TTL_MS = 15 * 60 * 1000;

export function countPayloadItems(action, payload = {}) {
  if (action === 'price_update') return Array.isArray(payload.prices) ? payload.prices.length : 1;
  if (action === 'stock_update') return Array.isArray(payload.stocks) ? payload.stocks.length : 1;
  return 1;
}

function randomCode() {
  return String(randomInt(100000, 1000000));
}

export function proposeAction({ db, action, target = null, payload = {}, risk = 'mid', now = () => new Date().toISOString() }) {
  const spec = WHITELIST[action];
  if (!spec) throw new ActionError('UNKNOWN_ACTION', `不支持的写操作：${action}`);
  const items = countPayloadItems(action, payload);
  if (items <= 0) throw new ActionError('EMPTY_PAYLOAD', '提案没有可执行条目');
  if (items > spec.limitPerDay) {
    throw new ActionError('PAYLOAD_TOO_LARGE', `单次 ${action} 含 ${items} 条，超过单日上限 ${spec.limitPerDay}，请拆成多个提案`);
  }
  const code = randomCode();
  const info = db.db
    .prepare('INSERT INTO actions_log (action, target, payload_json, risk, status, code, created_at, items) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(action, target, JSON.stringify(payload), risk, 'proposed', code, now(), items);
  return { id: Number(info.lastInsertRowid), code, action, target, payload, items, path: spec.path };
}

export function listActions({ db, status = null } = {}) {
  const sql = status
    ? 'SELECT * FROM actions_log WHERE status = ? ORDER BY id DESC'
    : 'SELECT * FROM actions_log ORDER BY id DESC';
  return db.db.prepare(sql).all(...(status ? [status] : []));
}

export async function approveAction({
  db,
  id,
  code,
  api,
  execute = false,
  today = new Date().toISOString().slice(0, 10),
  executedBy = 'cli',
  now = () => new Date().toISOString(),
}) {
  const row = db.db.prepare('SELECT * FROM actions_log WHERE id = ?').get(id);
  if (!row) throw new ActionError('ACTION_NOT_FOUND', `没有编号为 ${id} 的提案`);
  if (row.status !== 'proposed' && row.status !== 'approved') {
    throw new ActionError('ACTION_STATUS', `提案 ${id} 当前状态 ${row.status}，不能批准`);
  }
  if (String(code) !== String(row.code)) throw new ActionError('CODE_MISMATCH', '确认码不匹配');

  const createdAt = new Date(row.created_at).getTime();
  if (Number.isFinite(createdAt) && Date.now() - createdAt > CODE_TTL_MS * 1e3) {
    throw new ActionError('CODE_EXPIRED', '确认码已过期（超过 15 分钟），请重新提案');
  }

  const spec = WHITELIST[row.action];
  if (!spec) throw new ActionError('UNKNOWN_ACTION', `不支持的写操作：${row.action}`);
  const items = Number(row.items ?? countPayloadItems(row.action, JSON.parse(row.payload_json ?? '{}'))) || 1;

  const executedItems = Number(
    db.db
      .prepare("SELECT COALESCE(SUM(items), 0) AS n FROM actions_log WHERE action = ? AND status = 'executed' AND executed_at LIKE ?")
      .get(row.action, `${today}%`).n,
  );
  if (executedItems + items > spec.limitPerDay) {
    throw new ActionError(
      'DAILY_LIMIT',
      `${row.action} 今日已执行 ${executedItems} 条，本次 ${items} 条，超过上限 ${spec.limitPerDay}`,
    );
  }

  const payload = JSON.parse(row.payload_json ?? '{}');
  if (!execute) {
    db.db.prepare('UPDATE actions_log SET status = ?, executed_by = ? WHERE id = ?').run('approved', executedBy, id);
    return { executed: false, path: spec.path, payload, items };
  }

  try {
    const response = await api.call(spec.path, payload, { maxRetries: 0 });
    db.db
      .prepare('UPDATE actions_log SET status = ?, executed_at = ?, executed_by = ?, result_json = ? WHERE id = ?')
      .run('executed', now(), executedBy, JSON.stringify(response.json ?? {}), id);
    return { executed: true, path: spec.path, response: response.json, items };
  } catch (error) {
    const status = error?.status >= 400 && error.status < 500 && error.status !== 429 ? 'failed' : 'unknown';
    db.db
      .prepare('UPDATE actions_log SET status = ?, result_json = ? WHERE id = ?')
      .run(status, JSON.stringify({ message: String(error?.message ?? error), code: error?.code ?? null }), id);
    throw error;
  }
}

export { WHITELIST, CODE_TTL_MS };
