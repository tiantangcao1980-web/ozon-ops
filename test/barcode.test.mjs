import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateEan13, ean13CheckDigit, isValidEan13 } from '../src/content/barcode.mjs';

test('ean13CheckDigit computes the GS1 check digit', () => {
  assert.equal(ean13CheckDigit('200000000001'), '5');
  assert.equal(ean13CheckDigit('400638133393'), '1');
});

test('isValidEan13 accepts a real EAN-13 and rejects a wrong check digit', () => {
  assert.equal(isValidEan13('4006381333931'), true);
  assert.equal(isValidEan13('4006381333930'), false);
  assert.equal(isValidEan13('12345'), false);
  assert.equal(isValidEan13('400638133393a'), false);
});

test('generateEan13 is deterministic, internal-prefixed and valid', () => {
  const a = generateEan13('DEMO-W2-1199');
  const b = generateEan13('DEMO-W2-1199');
  const other = generateEan13('DEMO-P1-0699');
  assert.match(a, /^\d{13}$/);
  assert.equal(a, b);
  assert.notEqual(a, other);
  assert.ok(a.startsWith('20'), `internal barcode should start with 20, got ${a}`);
  assert.equal(isValidEan13(a), true);
  assert.equal(isValidEan13(other), true);
});