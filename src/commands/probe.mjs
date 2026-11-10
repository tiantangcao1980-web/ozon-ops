import { writeFile as writeFileFs } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(HERE, '..', 'endpoints.json');

/**
 * 对目录里每个端点探活，区分：usable（200）、blocked（权限/订阅）、drifted（404/405）。
 * @param {{api: {call: Function}, catalog: Array, writeFile?: Function, now?: () => string, outputPath?: string}} options
 */
export async function runProbe({
  api,
  catalog,
  writeFile = (path, content) => writeFileFs(path, content, 'utf8'),
  now = () => new Date().toISOString(),
  outputPath = OUTPUT_PATH,
}) {
  const rows = [];
  const usable = [];
  const blocked = [];
  const drifted = [];
  const needsParams = [];
  const failed = [];

  for (const entry of catalog) {
    try {
      const response = await api.call(entry.path, entry.body ?? {});
      rows.push({ path: entry.path, status: response.status, ok: true, note: entry.note });
      if (!usable.includes(entry.path)) usable.push(entry.path);
    } catch (error) {
      const status = Number(error?.status ?? 0);
      const row = {
        path: entry.path,
        status,
        ok: false,
        code: error?.code ?? null,
        message: String(error?.message ?? error).slice(0, 200),
        note: entry.note,
      };
      rows.push(row);
      if (status === 404 || status === 405) {
        if (!drifted.includes(entry.path)) drifted.push(entry.path);
      } else if (status === 400 || status === 422) {
        if (!needsParams.includes(entry.path)) needsParams.push(entry.path);
      } else if (status === 401 || status === 403) {
        if (!blocked.includes(entry.path)) blocked.push(entry.path);
      } else {
        failed.push(row);
      }
    }
  }

  const payload = { generatedAt: now(), rows, usable, blocked, drifted, needsParams, failed };
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  return { ...payload, outputPath };
}

export function formatProbeReport(result) {
  const lines = [
    `端点探活 · ${result.generatedAt}`,
    `可用 ${result.usable.length} / 订阅受限 ${result.blocked.length} / 版本漂移 ${result.drifted.length} / 参数待补 ${result.needsParams?.length ?? 0} / 其他失败 ${result.failed.length}`,
  ];
  if (result.drifted.length) lines.push(`漂移（目录有、线上无）：${result.drifted.join('、')}`);
  if (result.blocked.length) lines.push(`订阅受限：${result.blocked.join('、')}`);
  if (result.needsParams?.length) lines.push(`参数待补（端点可达，目录里的探测参数不合法）：${result.needsParams.join('、')}`);
  if (result.failed.length) {
    lines.push('其他失败：');
    for (const row of result.failed) lines.push(`  ${row.path} → ${row.status} ${row.message ?? ''}`);
  }
  lines.push(`结果已写入 ${result.outputPath}`);
  return lines.join('\n');
}
