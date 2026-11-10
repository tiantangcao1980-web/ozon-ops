import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildComfyWorkflow, createComfyClient, comfyEnvStatus } from '../src/content/comfyui.mjs';

test('buildComfyWorkflow wires checkpoint, prompts, sampler and save node', () => {
  const workflow = buildComfyWorkflow({
    checkpoint: 'sd_turbo.safetensors',
    positive: 'Силиконовая лопатка на кухонном столе',
    negative: 'текст, водяной знак',
    width: 512,
    height: 512,
    steps: 1,
    cfg: 1,
    seed: 7,
  });
  const nodes = Object.values(workflow);
  const classes = nodes.map((node) => node.class_type);
  assert.ok(classes.includes('CheckpointLoaderSimple'));
  assert.ok(classes.includes('CLIPTextEncode'));
  assert.ok(classes.includes('KSampler'));
  assert.ok(classes.includes('VAEDecode'));
  assert.ok(classes.includes('SaveImage'));
  const sampler = nodes.find((node) => node.class_type === 'KSampler');
  assert.equal(sampler.inputs.steps, 1);
  assert.equal(sampler.inputs.seed, 7);
  assert.equal(sampler.inputs.cfg, 1);
});

test('createComfyClient queues a prompt and downloads the image', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body });
    if (String(url).endsWith('/prompt')) {
      return { ok: true, status: 200, json: async () => ({ prompt_id: 'p1' }) };
    }
    if (String(url).includes('/history/')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ p1: { outputs: { 9: { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } } } }),
      };
    }
    if (String(url).includes('/view')) {
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const client = createComfyClient({ fetchImpl, baseUrl: 'http://127.0.0.1:8188' });
  const promptId = await client.queuePrompt({ '1': { class_type: 'SaveImage', inputs: {} } });
  assert.equal(promptId, 'p1');
  const image = await client.waitForImage(promptId, { timeoutMs: 5000, pollMs: 1 });
  assert.ok(image.filename === 'out.png');
  const bytes = await client.fetchImage(image);
  assert.equal(bytes.length, 3);
  assert.ok(calls.some((call) => call.url.endsWith('/prompt')));
});

test('comfyEnvStatus reports missing directory and server', () => {
  const status = comfyEnvStatus({ root: 'D:/nope', fsExists: () => false, fetchStatus: () => null });
  assert.equal(status.ok, false);
  assert.ok(status.hints.some((hint) => /ComfyUI/.test(hint)));
});
