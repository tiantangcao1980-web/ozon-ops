import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runListingQa } from '../rules/listing-qa.mjs';
import { composeListing } from '../content/listing-compose.mjs';
import { normalizeFacts } from '../content/listing-facts.mjs';

function latestDraft(db, offerId) {
  const row = db.db.prepare('SELECT * FROM listing_drafts WHERE offer_id = ? ORDER BY version DESC LIMIT 1').get(offerId);
  if (!row) return { row: null, payload: {} };
  return { row, payload: JSON.parse(row.payload_json) };
}

/**
 * 生成上架产物：完整 import 载荷（含自动条码/重量/尺寸/属性/简介/标签）、
 * 库存载荷（商品数量）、后台填写清单、QA。
 * 不调用任何写接口（写库走 action propose 或人工确认）。
 */
export function buildListing({
  db,
  offerId,
  outDir,
  images = [],
  keywords = null,
  facts = null,
  now = () => new Date().toISOString(),
}) {
  const { row, payload } = latestDraft(db, offerId);
  const draft = { offerId, ...payload };
  const normalizedFacts = facts ? normalizeFacts(facts) : null;

  const qa = runListingQa({ draft, images, facts: normalizedFacts });
  if (!normalizedFacts) {
    qa.issues.push({ code: 'FACTS_MISSING', message: '没有 listing facts；先在 data/listing-facts.json 采集重量/尺寸/数量/条码/搜索词' });
    qa.passed = false;
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'qa.json'),
    `${JSON.stringify({ offerId, generatedAt: now(), ...qa }, null, 2)}\n`,
    'utf8',
  );

  let composed = null;
  if (normalizedFacts) {
    try {
      composed = composeListing({ offerId, draft, facts: normalizedFacts, images, keywords });
    } catch (error) {
      qa.issues.push({ code: 'COMPOSE_FAILED', message: String(error?.message ?? error) });
      qa.passed = false;
    }
  }

  if (composed) writeFileSync(join(outDir, 'backend-fields.md'), `${composed.backendMarkdown}\n`, 'utf8');

  if (!qa.passed || !composed) {
    return { ok: false, qa, version: row?.version ?? null, warnings: composed?.warnings ?? [] };
  }

  writeFileSync(join(outDir, 'payload.ru.json'), `${JSON.stringify(composed.payload, null, 2)}\n`, 'utf8');
  writeFileSync(join(outDir, 'import.json'), `${JSON.stringify({ items: [composed.payload] }, null, 2)}\n`, 'utf8');
  writeFileSync(join(outDir, 'stocks.json'), `${JSON.stringify(composed.stockPayload, null, 2)}\n`, 'utf8');
  return { ok: true, qa, version: row?.version ?? null, payload: composed.payload, stockPayload: composed.stockPayload, warnings: composed.warnings };
}