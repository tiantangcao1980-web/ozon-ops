/**
 * ComfyUI 客户端：把文生图需求拼成 API workflow，提交 /prompt，轮询 /history，再取 /view。
 * 只走本机 127.0.0.1:8188；不依赖 ComfyUI 前端。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = process.env.OZON_OPS_ROOT || fileURLToPath(new URL('../../', import.meta.url));

export function buildComfyWorkflow({
  checkpoint,
  positive,
  negative = 'текст, водяной знак, логотип, размытие, низкое качество',
  width = 512,
  height = 512,
  steps = 1,
  cfg = 1,
  seed = 42,
  filenamePrefix = 'ozon',
}) {
  return {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: positive, clip: ['1', 1] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['1', 1] } },
    4: { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    5: {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps,
        cfg,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
      },
    },
    6: { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: filenamePrefix } },
  };
}

export function createComfyClient({ fetchImpl = fetch, baseUrl = 'http://127.0.0.1:8188', sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  async function queuePrompt(workflow) {
    const response = await fetchImpl(`${baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
    });
    const json = await response.json();
    if (!response.ok || !json.prompt_id) throw new Error(`ComfyUI 提交失败：HTTP ${response.status}`);
    return json.prompt_id;
  }

  async function waitForImage(promptId, { timeoutMs = 300_000, pollMs = 1000 } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const response = await fetchImpl(`${baseUrl}/history/${promptId}`);
      const json = await response.json();
      const entry = json[promptId];
      if (entry?.outputs) {
        for (const output of Object.values(entry.outputs)) {
          const image = output?.images?.[0];
          if (image) return image;
        }
      }
      await sleep(pollMs);
    }
    throw new Error(`ComfyUI 生成超时（${timeoutMs} ms）`);
  }

  async function fetchImage({ filename, subfolder = '', type = 'output' }) {
    const query = new URLSearchParams({ filename, subfolder, type });
    const response = await fetchImpl(`${baseUrl}/view?${query.toString()}`);
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  async function ready() {
    try {
      const response = await fetchImpl(`${baseUrl}/system_stats`);
      return response.ok;
    } catch {
      return false;
    }
  }

  return { queuePrompt, waitForImage, fetchImage, ready };
}

export function comfyEnvStatus({ root = PROJECT_ROOT, fsExists = existsSync, fetchStatus = () => null } = {}) {
  const comfyDir = join(root, 'comfyui');
  const checkpointDir = join(comfyDir, 'models', 'checkpoints');
  const checkpoint = fsExists(join(checkpointDir, 'sd_turbo.safetensors')) ? 'sd_turbo.safetensors' : null;
  const installed = fsExists(join(comfyDir, 'main.py'));
  const status = fetchStatus();
  const running = status === 200 || status === true;
  const hints = [];
  if (!installed) hints.push('未发现 ComfyUI：git -c http.proxy=http://127.0.0.1:7897 clone --depth 1 https://github.com/comfyanonymous/ComfyUI comfyui');
  if (installed && !checkpoint) hints.push('缺 checkpoint：把 sd_turbo.safetensors 放到 comfyui/models/checkpoints');
  if (installed && !running) hints.push('启动服务：imgwork/.venv/Scripts/python.exe comfyui/main.py --cpu --port 8188');
  return { ok: installed && Boolean(checkpoint) && running, installed, checkpoint, running, hints, comfyDir };
}
