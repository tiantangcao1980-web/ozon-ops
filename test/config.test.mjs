import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig, ConfigError } from '../src/config.mjs';

function makeRoot(envText) {
  const root = mkdtempSync(join(tmpdir(), 'ozon-config-'));
  mkdirSync(join(root, '.secrets'), { recursive: true });
  writeFileSync(join(root, '.secrets', 'ozon.env'), envText, 'utf8');
  return root;
}

const VALID = 'OZON_CLIENT_ID=1234567\nOZON_API_KEY=0123456789abcdef\nOZON_PREMIUM_PRO=0\n';

test('loadConfig reads credentials and derives masked client id', () => {
  const root = makeRoot(VALID);
  try {
    const config = loadConfig({ root });
    assert.equal(config.clientId, '1234567');
    assert.equal(config.apiKey, '0123456789abcdef');
    assert.equal(config.maskedClientId, '1234***');
    assert.equal(config.premiumPro, false);
    assert.equal(config.dbPath, join(root, 'db', 'ozon.db'));
    assert.equal(config.reportsDir, join(root, 'reports'));
    assert.equal(config.outboxDir, join(root, 'outbox'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadConfig treats OZON_PREMIUM_PRO=1 as premium', () => {
  const root = makeRoot(VALID.replace('OZON_PREMIUM_PRO=0', 'OZON_PREMIUM_PRO=1'));
  try {
    assert.equal(loadConfig({ root }).premiumPro, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadConfig tolerates angle-bracket wrapped values (as found in the real env file)', () => {
  const root = makeRoot('OZON_CLIENT_ID=<1234567>\nOZON_API_KEY=<0123456789abcdef>\n');
  try {
    const config = loadConfig({ root });
    assert.equal(config.clientId, '1234567');
    assert.equal(config.apiKey, '0123456789abcdef');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('missing api key throws MISSING_CREDENTIALS without echoing the key', () => {
  const root = makeRoot('OZON_CLIENT_ID=1234567\n');
  try {
    assert.throws(
      () => loadConfig({ root }),
      (error) => {
        assert.ok(error instanceof ConfigError);
        assert.equal(error.code, 'MISSING_CREDENTIALS');
        assert.ok(!String(error.message).includes('0123456789abcdef'));
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('non-numeric client id throws MALFORMED_CLIENT_ID', () => {
  const root = makeRoot(VALID.replace('OZON_CLIENT_ID=1234567', 'OZON_CLIENT_ID=abc'));
  try {
    assert.throws(() => loadConfig({ root }), (error) => error.code === 'MALFORMED_CLIENT_ID');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadConfig exposes performance credentials when present', () => {
  const root = makeRoot(VALID + 'OZON_PERF_CLIENT_ID=pid\nOZON_PERF_CLIENT_SECRET=psecret\n');
  try {
    const config = loadConfig({ root });
    assert.equal(config.perfClientId, 'pid');
    assert.equal(config.perfClientSecret, 'psecret');
    assert.equal(config.maskedClientId, '1234***');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
