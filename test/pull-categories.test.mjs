import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { countLeaves, pullCategories } from '../src/pull/categories.mjs';
import { openDb } from '../src/db.mjs';

const TREE = [
  {
    description_category_id: 1,
    category_name: '根类目',
    children: [
      { description_category_id: 2, category_name: '子类目', children: [] },
      {
        description_category_id: 3,
        category_name: '子类目B',
        children: [
          { type_id: 10, type_name: '类型A', children: [] },
          { type_id: 11, type_name: '类型B', children: [] },
        ],
      },
    ],
  },
];

test('countLeaves counts only nodes without children', () => {
  assert.equal(countLeaves(TREE), 3);
});

test('pullCategories stores the tree in settings and reports leaf count', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    const api = { call: async (path) => ({ ok: true, status: 200, json: { result: TREE } }) };
    const result = await pullCategories({ api, db: handle, now: () => '2026-11-06T00:00:00.000Z' });
    assert.equal(result.leaves, 3);
    assert.equal(result.nodes, 5);
    assert.equal(handle.setting('category_tree_fetched_at'), '2026-11-06T00:00:00.000Z');
    const stored = JSON.parse(handle.setting('category_tree'));
    assert.equal(stored.length, 1);
  } finally {
    handle.close();
  }
});

test('countLeaves reproduces the 7363 leaves of the real snapshot', (t) => {
  const snapshot = join(process.cwd(), 'raw', 'pull-20261106103425', 'tree.json');
  if (!existsSync(snapshot)) {
    t.skip('raw snapshot missing');
    return;
  }
  const payload = JSON.parse(readFileSync(snapshot, 'utf8'));
  assert.equal(countLeaves(payload.result), 7363);
});
