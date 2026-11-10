import { test } from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../src/db.mjs';

const TABLES = [
  'intel_items',
  'products',
  'prices',
  'stocks',
  'postings',
  'analytics_daily',
  'rating_snapshot',
  'candidates',
  'sku_costs',
  'listing_drafts',
  'actions_log',
  'api_calls',
  'settings',
  'fx_rates',
];

test('migrate creates all tables and records the schema version', () => {
  const handle = openDb();
  try {
    handle.migrate();
    const rows = handle.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
    for (const table of TABLES) assert.ok(rows.includes(table), `missing table ${table}`);
    assert.equal(handle.db.prepare('PRAGMA user_version').get().user_version, 9);
  } finally {
    handle.close();
  }
});

test('migrate is idempotent', () => {
  const handle = openDb();
  try {
    handle.migrate();
    handle.migrate();
    assert.equal(handle.db.prepare('PRAGMA user_version').get().user_version, 9);
  } finally {
    handle.close();
  }
});

test('upsert inserts once then updates on conflict', () => {
  const handle = openDb();
  try {
    handle.migrate();
    handle.upsert('products', { product_id: 1, offer_id: 'A', sku: 2, name: 'old', archived: 0 }, ['product_id']);
    handle.upsert('products', { product_id: 1, offer_id: 'A', sku: 2, name: 'new', archived: 1 }, ['product_id']);
    const rows = handle.db.prepare('SELECT * FROM products').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'new');
    assert.equal(rows[0].archived, 1);
  } finally {
    handle.close();
  }
});
