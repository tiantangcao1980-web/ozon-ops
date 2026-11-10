import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = process.env.OZON_OPS_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const PYTHON = process.env.OZON_PYTHON || 'python';

export function imageEnvStatus({ root = PROJECT_ROOT, fsExists = existsSync } = {}) {
  const venvPython = join(root, 'imgwork', '.venv', 'Scripts', 'python.exe');
  const modelDir = join(root, 'models', 'sd-turbo');
  const sdxlDir = join(root, 'models', 'sdxl-base');
  const markers = {
    python: fsExists(venvPython) ? venvPython : null,
    torch: fsExists(join(root, 'imgwork', '.venv', 'Lib', 'site-packages', 'torch')) || null,
    diffusers: fsExists(join(root, 'imgwork', '.venv', 'Lib', 'site-packages', 'diffusers')) || null,
    sdTurbo: fsExists(join(modelDir, 'model_index.json')) || fsExists(join(modelDir, 'sd_turbo.safetensors')) ? modelDir : null,
    sdxlBase: fsExists(join(sdxlDir, 'model_index.json')) ? sdxlDir : null,
  };
  const ok = Boolean(markers.python && markers.torch && markers.diffusers && (markers.sdTurbo || markers.sdxlBase));
  const hints = [];
  if (!markers.python) {
    hints.push(`安装环境：node scripts/setup-image-env.mjs（uv 建 .venv，torch cu124 + diffusers）`);
  }
  if (markers.python && !markers.torch) hints.push('venv 已建但缺 torch：跑 node scripts/setup-image-env.mjs');
  if (markers.python && !markers.diffusers) hints.push('venv 缺 diffusers：跑 node scripts/setup-image-env.mjs');
  if (markers.python && !markers.sdTurbo && !markers.sdxlBase) {
    hints.push('缺模型：HF_ENDPOINT=https://hf-mirror.com 下载 stabilityai/sd-turbo 到 models/sd-turbo');
  }
  return { ok, root, python: markers.python, torch: Boolean(markers.torch), diffusers: Boolean(markers.diffusers), model: markers.sdTurbo ?? markers.sdxlBase, hints };
}
