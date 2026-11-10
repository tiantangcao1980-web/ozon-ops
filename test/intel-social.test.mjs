import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseSuggest, parseTelegramChannel } from '../src/intel/social.mjs';
import { saveDemandSignals, saveSocialPosts } from '../src/intel/store.mjs';
import { openDb } from '../src/db.mjs';

test('parseSuggest handles both yandex suggest shapes', () => {
  assert.deepEqual(parseSuggest(['силиконовая лопатка', 'силиконовая лопатка для кухни']), [
    'силиконовая лопатка',
    'силиконовая лопатка для кухни',
  ]);
  assert.deepEqual(parseSuggest([['силиконовая лопатка'], ['силиконовые формы']]), [
    'силиконовая лопатка',
    'силиконовые формы',
  ]);
  assert.deepEqual(parseSuggest('not json'), []);
});

test('parseTelegramChannel extracts posts with text, date and url', () => {
  const html = `
  <div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="ozonru/12345">
    <div class="tgme_widget_message_text">Скидки на кухонные принадлежности: лопатки от 99 рублей</div>
    <time datetime="2026-11-05T10:00:00+00:00"></time>
  </div></div>
  <div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="ozonru/12346">
    <div class="tgme_widget_message_text">Новая подборка товаров для дома</div>
  </div></div>`;
  const posts = parseTelegramChannel(html, { channel: 'ozonru' });
  assert.equal(posts.length, 2);
  assert.equal(posts[0].url, 'https://t.me/ozonru/12345');
  assert.match(posts[0].text, /лопатки/);
  assert.equal(posts[0].publishedAt, '2026-11-05T10:00:00+00:00');
});

test('saveDemandSignals and saveSocialPosts are idempotent', () => {
  const handle = openDb();
  handle.migrate();
  try {
    const signals = [{ keyword: 'силиконовая лопатка', volume: null }];
    saveDemandSignals(handle, signals, { source: 'yandex-suggest', capturedAt: '2026-11-06T00:00:00.000Z' });
    saveDemandSignals(handle, signals, { source: 'yandex-suggest', capturedAt: '2026-11-06T00:00:00.000Z' });
    assert.equal(handle.db.prepare('SELECT count(*) AS n FROM demand_signals').get().n, 1);

    const posts = [{ url: 'https://t.me/ozonru/1', channel: 'ozonru', text: 'x', publishedAt: '2026-11-05' }];
    saveSocialPosts(handle, posts, { source: 'telegram', capturedAt: '2026-11-06T00:00:00.000Z' });
    saveSocialPosts(handle, posts, { source: 'telegram', capturedAt: '2026-11-06T00:00:00.000Z' });
    assert.equal(handle.db.prepare('SELECT count(*) AS n FROM social_posts').get().n, 1);
  } finally {
    handle.close();
  }
});

test('runDemand saves suggestions for each seed', async () => {
  const { runDemand } = await import('../src/intel/commands.mjs');
  const handle = openDb();
  handle.migrate();
  try {
    const get = async (url) =>
      decodeURIComponent(url).includes('силиконовая')
        ? JSON.stringify(['силиконовая лопатка', 'силиконовая лопатка для кухни'])
        : JSON.stringify(['органайзер для кухни']);
    const result = await runDemand({ db: handle, seeds: ['силиконовая', 'органайзер'], get, capturedAt: '2026-11-06T00:00:00.000Z' });
    assert.equal(result.keywords, 3);
    assert.equal(handle.db.prepare('SELECT count(*) AS n FROM demand_signals').get().n, 3);
  } finally {
    handle.close();
  }
});

test('runSocial saves telegram posts from channels', async () => {
  const { runSocial } = await import('../src/intel/commands.mjs');
  const handle = openDb();
  handle.migrate();
  try {
    const html = '<div class="tgme_widget_message " data-post="ozonru/1"><div class="tgme_widget_message_text">Пост про лопатки</div></div>';
    const get = async () => html;
    const result = await runSocial({ db: handle, channels: ['ozonru'], get, capturedAt: '2026-11-06T00:00:00.000Z' });
    assert.equal(result.posts, 1);
    assert.equal(handle.db.prepare('SELECT count(*) AS n FROM social_posts').get().n, 1);
  } finally {
    handle.close();
  }
});
