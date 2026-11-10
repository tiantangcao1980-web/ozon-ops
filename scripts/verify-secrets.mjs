/**
 * 凭据泄漏自检：扫描工作区与 git 历史，确认 .secrets 里的值没被提交/写进文件。
 *
 * 用法：node scripts/verify-secrets.mjs [--root .]
 * 退出码：0 = 干净；1 = 发现泄漏。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] : join(import.meta.dirname, '..');
const ENV_FILE = join(ROOT, '.secrets', 'ozon.env');

const SKIP_DIRS = new Set(['.git', '.secrets', 'node_modules', 'data', 'models', 'imgwork', 'comfyui', 'outbox', 'reports', 'db', 'raw', 'tmp', '.venv']);
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bin', '.db', '.sqlite', '.log', '.safetensors', '.ckpt']);

function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["'<\s]+|["'>\s]+$/g, '');
    if (value.length >= 8) values[key] = value;
  }
  return values;
}

function walk(dir, output = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), output);
      continue;
    }
    const full = join(dir, entry.name);
    const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
    if (SKIP_EXT.has(ext)) continue;
    try {
      if (statSync(full).size > 2 * 1024 * 1024) continue;
    } catch {
      continue;
    }
    output.push(full);
  }
  return output;
}

if (!existsSync(ENV_FILE)) {
  console.log(`跳过：没有 ${ENV_FILE}`);
  process.exit(0);
}

const secrets = parseEnv(readFileSync(ENV_FILE, 'utf8'));
const entries = Object.entries(secrets);
if (entries.length === 0) {
  console.log('跳过：.secrets 里没有可检查的值');
  process.exit(0);
}

const leaks = [];
for (const file of walk(ROOT)) {
  const text = readFileSync(file, 'utf8');
  for (const [key, value] of entries) {
    if (text.includes(value)) leaks.push({ where: file, key });
  }
}

const history = spawnSync('git', ['log', '-p', '--all'], { cwd: ROOT, maxBuffer: 512 * 1024 * 1024, encoding: 'utf8' });
if (history.status === 0 && history.stdout) {
  for (const [key, value] of entries) {
    if (history.stdout.includes(value)) leaks.push({ where: 'git history', key });
  }
}

const dataTracked = (() => {
  const result = spawnSync('git', ['rev-list', '--all', '--objects'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });
  return (result.stdout ?? '').split('\n').some((line) => /\sdata\//.test(line));
})();

if (dataTracked) leaks.push({ where: 'git history', key: 'data/（浏览器 profile）' });

if (leaks.length > 0) {
  console.error('发现泄漏：');
  for (const leak of leaks.slice(0, 20)) console.error(`  - ${leak.key} → ${leak.where}`);
  process.exit(1);
}

console.log(`干净：${entries.length} 个凭据值均未出现在工作区与 git 历史；data/ 不在历史中。`);
