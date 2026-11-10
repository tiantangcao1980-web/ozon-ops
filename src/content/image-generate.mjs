import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { imageEnvStatus } from './image-env.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = process.env.OZON_OPS_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const GEN_SCRIPT = join(PROJECT_ROOT, 'imgwork', 'gen.py');

export function buildImageCommand({ python, genScript = GEN_SCRIPT, model, prompt, negative = undefined, output, width = 768, height = 768, steps = 4, seed = 42, guidance = 0 }) {
  const payload = { model, prompt, output, width, height, steps, seed, guidance };
  if (negative) payload.negative = negative;
  return { executable: python, args: [genScript, JSON.stringify(payload)] };
}

/**
 * 文生图：环境不齐时返回可执行提示，不崩栈。
 */
export async function generateImage({ prompt, output, width = 768, height = 768, steps = 4, seed = 42, status = imageEnvStatus() } = {}) {
  if (!status.ok) {
    return { ok: false, code: 'IMAGE_ENV_NOT_READY', hints: status.hints };
  }
  mkdirSync(dirname(output), { recursive: true });
  const command = buildImageCommand({
    python: status.python,
    model: status.model,
    prompt,
    output,
    width,
    height,
    steps,
    seed,
  });
  return new Promise((resolve) => {
    execFile(command.executable, command.args, { cwd: PROJECT_ROOT, timeout: 300000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
      const trimmed = String(stdout ?? '').trim();
      let parsed = null;
      try {
        parsed = JSON.parse(trimmed.split('\n').pop());
      } catch {
        parsed = null;
      }
      if (error || !parsed?.ok) {
        resolve({
          ok: false,
          code: parsed?.code ?? 'GENERATION_FAILED',
          message: parsed?.message ?? String(stderr ?? error?.message ?? '').slice(0, 800),
        });
        return;
      }
      resolve({ ok: true, ...parsed, exists: existsSync(output) });
    });
  });
}
