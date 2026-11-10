/**
 * 一次性安装本地生图环境（uv + torch cu124 + diffusers + sd-turbo）。
 * 幂等：已存在的 venv/模型会跳过；网络访问 hf-mirror.com（本机 huggingface.co 不可达）。
 *
 * 用法：node scripts/setup-image-env.mjs [--skip-model]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const VENV = join(ROOT, 'imgwork', '.venv');
const PY = join(VENV, 'Scripts', 'python.exe');
const MODEL_DIR = join(ROOT, 'models', 'sd-turbo');
const skipModel = process.argv.includes('--skip-model');

function run(executable, args, env = {}) {
  console.log(`\n$ ${executable} ${args.join(' ')}`);
  execFileSync(executable, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
}

const BUNDLED_PYTHON = (process.env.OZON_PYTHON || 'python');

function tryRun(executable, args, env = {}) {
  try {
    execFileSync(executable, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
    return true;
  } catch (error) {
    console.log(`失败（${executable} ${args[0]}）：${String(error.message ?? error).slice(0, 200)}`);
    return false;
  }
}

mkdirSync(join(ROOT, 'models'), { recursive: true });

if (!existsSync(PY)) {
  // uv 在这台机器上会因 PE 资源改写被拒；失败时退回内置 Python 的 venv。
  const viaUv = tryRun('uv', ['venv', VENV, '--python', '3.12']);
  if (!viaUv) {
    console.log('改用内置 Python 创建 venv…');
    run(BUNDLED_PYTHON, ['-m', 'venv', VENV]);
  }
} else {
  console.log(`venv 已存在：${VENV}`);
}

run(PY, ['-m', 'pip', 'install', '--upgrade', 'pip', '--quiet']);
run(PY, ['-m', 'pip', 'install', '--index-url', 'https://download.pytorch.org/whl/cu124', 'torch']);
run(PY, ['-m', 'pip', 'install', 'diffusers', 'transformers', 'accelerate', 'safetensors', 'pillow', 'huggingface_hub']);

if (!skipModel) {
  if (existsSync(join(MODEL_DIR, 'model_index.json'))) {
    console.log(`模型已存在：${MODEL_DIR}`);
  } else {
    run(PY, [
      '-c',
      [
        'import os',
        'from huggingface_hub import snapshot_download',
        `snapshot_download(repo_id="stabilityai/sd-turbo", local_dir=r"${MODEL_DIR}", allow_patterns=["*.json","*.txt","*.safetensors","*.yaml","tokenizer/*","text_encoder/*","unet/*","vae/*","scheduler/*"])`,
      ].join('\n'),
    ], { HF_ENDPOINT: 'https://hf-mirror.com' });
  }
}

console.log('\n环境自检：');
run(PY, ['-c', 'import torch, diffusers; print("torch", torch.__version__, "cuda", torch.cuda.is_available()); print("diffusers", diffusers.__version__)']);
console.log('\n完成。试试：node bin/ozon.mjs image status');
