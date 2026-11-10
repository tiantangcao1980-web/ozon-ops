import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pullPostings } from '../src/pull/postings.mjs';
import { openDb } from '../src/db.mjs';

function fakeApi({ emptyCursor = false } = {}) {
  const pages = [
    {
      has_next: true,
      cursor: emptyCursor ? '' : 'c1',
      postings: [
        { posting_number: 'A-1', status: 'delivered', in_process_at: '2026-09-01T00:00:00Z', shipment_date: '2026-09-02T00:00:00Z', products: [{ offer_id: 'A', quantity: 1, price: { amount: '103.38', currency: 'CNY' } }] },
        { posting_number: 'B-1', status: 'awaiting_deliver', in_process_at: '2026-09-02T00:00:00Z', shipment_date: '2026-09-03T00:00:00Z', products: [{ offer_id: 'B', quantity: 2, price: { amount: '207.38', currency: 'CNY' } }] },
      ],
    },
    { has_next: false, cursor: 'c2', postings: [{ posting_number: 'B-1', status: 'awaiting_deliver' }] },
  ];
  let index = 0;
  return {
    call: async (path) => {
      if (path === '/v4/posting/fbs/list') {
        const page = pages[Math.min(index, pages.length - 1)];
        index += 1;
        return { ok: true, status: 200, json: page };
      }
      if (path === '/v4/posting/fbs/unfulfilled/list') {
        return { ok: true, status: 200, json: { has_next: false, postings: [{ posting_number: 'B-1' }] } };
      }
      throw new Error(`unexpected path ${path}`);
    },
  };
}

test('pullPostings follows the cursor, dedupes and marks pending shipments', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    const result = await pullPostings({ api: fakeApi(), db: handle, since: '2026-09-01T00:00:00Z', to: '2026-11-06T23:59:59Z' });
    assert.equal(result.pages, 2);
    const rows = handle.db.prepare('SELECT * FROM postings ORDER BY posting_number').all();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].posting_number, 'A-1');
    assert.equal(rows[0].amount_total, 103.38);
    assert.equal(rows[1].pending_shipment, 1);
  } finally {
    handle.close();
  }
});

test('pullPostings throws when has_next is true but cursor is empty', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    await assert.rejects(
      () => pullPostings({ api: fakeApi({ emptyCursor: true }), db: handle, since: '2026-09-01T00:00:00Z', to: '2026-11-06T23:59:59Z' }),
      /cursor/i,
    );
  } finally {
    handle.close();
  }
});

test('reads amounts from products[].price and keeps the CNY currency', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    const api = {
      call: async (path) => {
        if (path === '/v4/posting/fbs/list') {
          return {
            ok: true,
            json: {
              has_next: false,
              cursor: '',
              postings: [
                {
                  posting_number: 'P-1',
                  status: 'delivered',
                  in_process_at: '2026-09-01T00:00:00Z',
                  shipment_date: '2026-09-02T00:00:00Z',
                  products: [
                    { offer_id: 'A', quantity: 2, price: { amount: '7', currency: 'CNY' } },
                    { offer_id: 'B', quantity: 1, price: { amount: '3.5', currency: 'CNY' } },
                  ],
                },
                { posting_number: 'P-2', status: 'delivered', products: [{ offer_id: 'C', quantity: 1 }] },
              ],
            },
          };
        }
        return { ok: true, json: { has_next: false, postings: [] } };
      },
    };
    const result = await pullPostings({ api, db: handle, since: '2026-09-01T00:00:00Z', to: '2026-11-06T23:59:59Z' });
    const row = handle.db.prepare('SELECT * FROM postings WHERE posting_number = ?').get('P-1');
    assert.equal(row.amount_total, 17.5);
    assert.equal(row.amount_currency, 'CNY');
    assert.equal(row.price_rub, null);
    assert.equal(result.missingAmounts, 1);
  } finally {
    handle.close();
  }
});

test('only marks pending shipments for postings whose status is awaiting', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    const api = {
      call: async (path, body) => {
        if (path === '/v4/posting/fbs/list') {
          return {
            ok: true,
            json: {
              has_next: false,
              postings: [
                { posting_number: 'X', status: 'delivering' },
                { posting_number: 'Y', status: 'awaiting_deliver' },
              ],
            },
          };
        }
        if (path === '/v4/posting/fbs/unfulfilled/list') {
          if (!body.cursor) return { ok: true, json: { has_next: true, cursor: 'u1', postings: [{ posting_number: 'X' }, { posting_number: 'Y' }] } };
          return { ok: true, json: { has_next: false, postings: [{ posting_number: 'Z' }] } };
        }
        throw new Error(`unexpected ${path}`);
      },
    };
    const result = await pullPostings({ api, db: handle, since: '2026-09-01T00:00:00Z', to: '2026-11-06T23:59:59Z' });
    assert.equal(result.pending, 1);
    assert.equal(result.pendingListed, 3);
    const pending = handle.db.prepare('SELECT posting_number FROM postings WHERE pending_shipment = 1 ORDER BY posting_number').all().map((row) => row.posting_number);
    assert.deepEqual(pending, ['Y']);
    assert.equal(handle.db.prepare("SELECT count(*) AS n FROM postings WHERE posting_number = 'Z'").get().n, 0);
  } finally {
    handle.close();
  }
});

test('pullPostings converts CNY amounts to RUB using the latest fx rate', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    handle.db.prepare("INSERT INTO fx_rates (date, rub_per_cny, source, captured_at) VALUES ('2026-11-06', 12.5, 'CBR', '2026-11-06T00:00:00Z')").run();
    const result = await pullPostings({ api: fakeApi(), db: handle, since: '2026-09-01T00:00:00Z', to: '2026-11-06T23:59:59Z' });
    assert.equal(result.rubPerCny, 12.5);
    const row = handle.db.prepare("SELECT price_rub, currency FROM postings WHERE posting_number = 'A-1'").get();
    assert.equal(row.currency, 'CNY');
    assert.equal(row.price_rub, 1292.25);
  } finally {
    handle.close();
  }
});

test('pullPostings clears pending flag when a posting is no longer unfulfilled', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    handle.db.prepare("INSERT INTO postings (posting_number, status, pending_shipment, updated_at) VALUES ('OLD-1', 'awaiting_deliver', 1, '2026-09-01T00:00:00Z')").run();
    const api = {
      call: async (path) => {
        if (path === '/v4/posting/fbs/list') return { ok: true, status: 200, json: { has_next: false, cursor: '', postings: [] } };
        if (path === '/v4/posting/fbs/unfulfilled/list') return { ok: true, status: 200, json: { has_next: false, postings: [] } };
        throw new Error(`unexpected path ${path}`);
      },
    };
    const result = await pullPostings({ api, db: handle, since: '2026-09-01T00:00:00Z', to: '2026-11-06T23:59:59Z' });
    assert.equal(result.pending, 0);
    assert.equal(handle.db.prepare("SELECT pending_shipment FROM postings WHERE posting_number = 'OLD-1'").get().pending_shipment, 0);
  } finally {
    handle.close();
  }
});
