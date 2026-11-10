import { test } from 'node:test';
import assert from 'node:assert/strict';

import { imageEnvStatus } from '../src/content/image-env.mjs';
import { buildImageCommand } from '../src/content/image-generate.mjs';

test('imageEnvStatus reports missing environment with hints', () => {
  const status = imageEnvStatus({ root: 'C:/fake/ozon', fsExists: () => false });
  assert.equal(status.ok, false);
  assert.ok(status.hints.length > 0);
  assert.match(status.hints.join('\n'), /setup-image-env/);
});

test('imageEnvStatus reports ready when venv and model exist', () => {
  const root = 'C:/fake/ozon';
  const status = imageEnvStatus({
    root,
    fsExists: (path) => true,
  });
  assert.equal(status.ok, true);
  assert.equal(status.torch, true);
  assert.ok(status.model.includes('models'));
});

test('buildImageCommand builds the python invocation', () => {
  const command = buildImageCommand({
    python: 'C:/py/python.exe',
    genScript: 'D:/p/imgwork/gen.py',
    model: 'D:/p/models/sd-turbo',
    prompt: 'Силиконовая лопатка на кухонном столе',
    output: 'D:/p/outbox/x.png',
    width: 768,
    height: 768,
    steps: 4,
    seed: 7,
  });
  assert.equal(command.executable, 'C:/py/python.exe');
  assert.equal(command.args[0], 'D:/p/imgwork/gen.py');
  const payload = JSON.parse(command.args[1]);
  assert.equal(payload.model, 'D:/p/models/sd-turbo');
  assert.equal(payload.size ?? payload.width, 768);
  assert.equal(payload.seed, 7);
});
