import { test } from 'node:test';
import assert from 'node:assert/strict';

import { proposeAction, approveAction, listActions, ActionError } from '../src/commands/actions.mjs';
import { openDb } from '../src/db.mjs';

function fakeApi(calls = []) {
  return {
    call: async (path, body) => {
      calls.push({ path, body });
      return { ok: true, status: 200, json: { result: 'ok' } };
    },
  };
}

test('proposeAction stores a proposal with a confirmation code', () => {
  const handle = openDb();
  handle.migrate();
  try {
    const proposal = proposeAction({
      db: handle,
      action: 'stock_update',
      target: 'A',
      payload: { offer_id: 'A', stock: 10 },
      now: () => '2026-11-06T00:00:00.000Z',
    });
    assert.ok(proposal.id > 0);
    assert.match(proposal.code, /^\d{6}$/);
    const rows = listActions({ db: handle });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'proposed');
  } finally {
    handle.close();
  }
});

test('approveAction rejects a wrong code', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    const proposal = proposeAction({ db: handle, action: 'stock_update', target: 'A', payload: { offer_id: 'A', stock: 5 } });
    await assert.rejects(
      () => approveAction({ db: handle, id: proposal.id, code: '000000', api: fakeApi() }),
      (error) => error instanceof ActionError && error.code === 'CODE_MISMATCH',
    );
  } finally {
    handle.close();
  }
});

test('approveAction without execute only approves (dry-run)', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    const calls = [];
    const proposal = proposeAction({ db: handle, action: 'stock_update', target: 'A', payload: { offer_id: 'A', stock: 7 } });
    const result = await approveAction({ db: handle, id: proposal.id, code: proposal.code, api: fakeApi(calls) });
    assert.equal(result.executed, false);
    assert.equal(calls.length, 0);
    assert.equal(listActions({ db: handle })[0].status, 'approved');
  } finally {
    handle.close();
  }
});

test('approveAction with execute calls the whitelisted endpoint', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    const calls = [];
    const proposal = proposeAction({ db: handle, action: 'stock_update', target: 'A', payload: { stocks: [{ offer_id: 'A', stock: 7 }] } });
    const result = await approveAction({ db: handle, id: proposal.id, code: proposal.code, api: fakeApi(calls), execute: true });
    assert.equal(result.executed, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/v2/products/stocks');
    assert.equal(listActions({ db: handle })[0].status, 'executed');
  } finally {
    handle.close();
  }
});

test('unknown action types are refused at propose time', () => {
  const handle = openDb();
  handle.migrate();
  try {
    assert.throws(
      () => proposeAction({ db: handle, action: 'delete_store', target: 'A', payload: {} }),
      (error) => error.code === 'UNKNOWN_ACTION',
    );
  } finally {
    handle.close();
  }
});

test('daily price limit blocks the 21st price change', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    for (let index = 0; index < 20; index += 1) {
      handle.db
        .prepare("INSERT INTO actions_log (action, target, payload_json, status, executed_at, created_at) VALUES ('price_update', ?, '{}', 'executed', ?, ?)")
        .run(`S${index}`, '2026-11-06T01:00:00.000Z', '2026-11-06T00:00:00.000Z');
    }
    const proposal = proposeAction({ db: handle, action: 'price_update', target: 'NEW', payload: { prices: [{ offer_id: 'NEW', price: 200 }] } });
    await assert.rejects(
      () => approveAction({ db: handle, id: proposal.id, code: proposal.code, api: fakeApi(), execute: true, today: '2026-11-06' }),
      (error) => error.code === 'DAILY_LIMIT',
    );
  } finally {
    handle.close();
  }
});

test('limit is enforced on payload item count, not request count', () => {
  const handle = openDb();
  handle.migrate();
  try {
    assert.throws(
      () => proposeAction({ db: handle, action: 'price_update', payload: { prices: Array.from({ length: 500 }, (_, i) => ({ offer_id: `X${i}`, price: 100 })) } }),
      (error) => error.code === 'PAYLOAD_TOO_LARGE',
    );
    const ok = proposeAction({ db: handle, action: 'price_update', payload: { prices: [{ offer_id: 'A', price: 100 }] } });
    assert.equal(ok.items, 1);
    const rows = listActions({ db: handle });
    assert.equal(rows[0].items, 1);
  } finally {
    handle.close();
  }
});

test('write execution does not retry and marks unknown on network failure', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    const calls = [];
    const api = {
      call: async (_path, _body, opts) => {
        calls.push(opts);
        const error = new Error('socket hang up');
        error.code = 'NETWORK_ERROR';
        throw error;
      },
    };
    const proposal = proposeAction({ db: handle, action: 'review_reply', payload: { review_id: 'r1', text: 'ok' } });
    await assert.rejects(() => approveAction({ db: handle, id: proposal.id, code: proposal.code, api, execute: true }));
    assert.equal(calls[0].maxRetries, 0, 'write must not retry');
    assert.equal(listActions({ db: handle })[0].status, 'unknown');
  } finally {
    handle.close();
  }
});

test('explicit 4xx marks failed', async () => {
  const handle = openDb();
  handle.migrate();
  try {
    const api = {
      call: async () => {
        const error = new Error('bad request');
        error.status = 400;
        error.code = 'REQUEST_FAILED';
        throw error;
      },
    };
    const proposal = proposeAction({ db: handle, action: 'question_answer', payload: { question_id: 'q1', text: 'ok' } });
    await assert.rejects(() => approveAction({ db: handle, id: proposal.id, code: proposal.code, api, execute: true }));
    assert.equal(listActions({ db: handle })[0].status, 'failed');
  } finally {
    handle.close();
  }
});
