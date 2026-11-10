/**
 * 从 ModelScope 下载 sd-turbo 的 diffusers 组件权重到 models/sd-turbo，
 * 使其同时具备 model_index.json（diffusers 目录布局）与单文件 checkpoint。
 * 用法：node scripts/fetch-sd-turbo-diffusers.mjs
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const BASE = 'https://modelscope.cn/models/AI-ModelScope/sd-turbo/resolve/master';
const TARGET = join(ROOT, 'models', 'sd-turbo');
const CONFIG_DIR = join(ROOT, 'models', 'sd-turbo-config');

const FILES = [
  'model_index.json',
  'scheduler/scheduler_config.json',
  'text_encoder/config.json',
  'text_encoder/model.safetensors',
  'tokenizer/tokenizer_config.json',
  'tokenizer/vocab.json',
  'tokenizer/merges.txt',
  'tokenizer/special_tokens_map.json',
  'unet/config.json',
  'unet/diffusion_pytorch_model.safetensors',
  'vae/config.json',
  'vae/diffusion_pytorch_model.safetensors',
];

for (const file of FILES) {
  const target = join(TARGET, file);
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target) && file !== 'model_index.json') {
    console.log(`skip ${file}`);
    continue;
  }
  if (!file.startsWith('unet/') && !file.startsWith('vae/') && !file.startsWith('text_encoder/model')) {
    const fromConfig = join(CONFIG_DIR, file);
    if (existsSync(fromConfig)) {
      copyFileSync(fromConfig, target);
      console.log(`copy ${file}`);
      continue;
    }
  }
  console.log(`download ${file}`);
  execFileSync('curl.exe', ['-s', '-L', '--max-time', '1800', '-o', target, `${BASE}/${file}`], { stdio: 'inherit' });
}
console.log('done');
