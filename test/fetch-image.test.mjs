import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildCurlFetchArgs } from '../src/content/fetch-image.mjs';

test('buildCurlFetchArgs builds a curl invocation with proxy and follow-redirects', () => {
  const args = buildCurlFetchArgs({ url: 'https://a.lovart.ai/x.png', output: 'D:/out/x.png', proxy: 'http://127.0.0.1:7897' });
  assert.ok(args.includes('-L'), 'follow redirects');
  assert.ok(args.includes('--proxy') || args.includes('-x'));
  assert.ok(args.includes('https://a.lovart.ai/x.png'));
  assert.ok(args.includes('D:/out/x.png'));
});

test('buildCurlFetchArgs omits proxy when none is given', () => {
  const args = buildCurlFetchArgs({ url: 'https://example.com/a.png', output: 'a.png', proxy: null });
  assert.ok(!args.includes('-x'));
  assert.ok(!args.includes('--proxy'));
});
