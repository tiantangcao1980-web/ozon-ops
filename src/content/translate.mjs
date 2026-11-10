import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GLOSSARY_PATH = join(HERE, 'glossary.ru.json');

export class DraftError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DraftError';
    this.code = code;
  }
}

export function loadGlossary(path = GLOSSARY_PATH) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  return { terms: parsed.terms ?? [], forbidden: parsed.forbidden ?? [] };
}

const CYRILLIC = /[\u0400-\u04FF]/;
const CHINESE = /[\u4E00-\u9FFF]/;

/**
 * 两段式翻译的第一段：把中文卖点组装成待译草稿（俄语槽位留空）。
 */
export function prepareDraft({ offerId, zh, categorySchema = {} }) {
  const glossary = loadGlossary();
  const zhText = [zh?.name ?? '', ...(zh?.bullets ?? []), ...Object.values(zh?.attributes ?? {})].join(' ');
  const glossaryHints = glossary.terms
    .filter((term) => zhText.includes(term.zh))
    .map((term) => ({ zh: term.zh, ru: term.ru }));
  const requiredAttrs = (categorySchema.attributes ?? []).filter((attr) => attr.required).map((attr) => attr.id);

  return {
    offerId,
    zh,
    slots: { nameRu: '', descriptionRu: '', attributesRu: {} },
    backTranslation: { nameZh: '', descriptionZh: '', attributesZh: {} },
    glossaryHints,
    constraints: {
      nameMaxBytes: categorySchema.nameMaxBytes ?? 200,
      descMaxBytes: categorySchema.descMaxBytes ?? 6000,
      requiredAttrs,
      attributes: categorySchema.attributes ?? [],
      forbidden: glossary.forbidden,
    },
  };
}

function ruTermPresent(ruText, term) {
  const words = String(term).toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const textWords = ruText.split(/[^a-zа-яё0-9]+/i).filter(Boolean);
  return words.every((word) => {
    const needle = word.slice(0, Math.min(4, word.length));
    return textWords.some((candidate) => candidate.slice(0, needle.length) === needle);
  });
}

export function draftCoverage(draft) {
  const glossary = loadGlossary();
  const ruText = [
    draft?.slots?.nameRu ?? '',
    draft?.slots?.descriptionRu ?? '',
    ...Object.values(draft?.slots?.attributesRu ?? {}),
  ]
    .join(' ')
    .toLowerCase();
  const zhText = [draft?.zh?.name ?? '', ...(draft?.zh?.bullets ?? []), ...Object.values(draft?.zh?.attributes ?? {})].join(' ');
  const hints = glossary.terms.filter((term) => zhText.includes(term.zh));
  const hits = hints.filter((term) => ruTermPresent(ruText, term.ru));
  return {
    covered: hits.length,
    total: hints.length,
    // 没有术语提示（例如非目标类目）时视为通过：没有可检查项，不应无限期挡住上架
    ratio: hints.length === 0 ? 1 : Math.round((hits.length / hints.length) * 100) / 100,
    hints: hints.map((term) => term.zh),
    hits: hits.map((term) => term.zh),
  };
}

function validateDraft(draft, glossary = loadGlossary()) {
  const errors = [];
  const name = String(draft?.slots?.nameRu ?? '').trim();
  const description = String(draft?.slots?.descriptionRu ?? '').trim();
  const attributes = draft?.slots?.attributesRu ?? {};
  const back = draft?.backTranslation ?? {};

  if (!name || !description) errors.push({ code: 'MISSING_TRANSLATION', message: '俄语标题或描述为空' });
  if (!CYRILLIC.test(name)) errors.push({ code: 'MISSING_TRANSLATION', message: '俄语标题没有西里尔字母' });

  const nameBytes = Buffer.byteLength(name, 'utf8');
  if (nameBytes > (draft?.constraints?.nameMaxBytes ?? 200)) {
    errors.push({ code: 'NAME_TOO_LONG', message: `标题 ${nameBytes} 字节超过上限` });
  }
  const descBytes = Buffer.byteLength(description, 'utf8');
  if (descBytes > (draft?.constraints?.descMaxBytes ?? 6000)) {
    errors.push({ code: 'DESC_TOO_LONG', message: `描述 ${descBytes} 字节超过上限` });
  }

  for (const attrId of draft?.constraints?.requiredAttrs ?? []) {
    if (!attributes[attrId] && !attributes[String(attrId)]) {
      errors.push({ code: 'MISSING_ATTRIBUTE', message: `必填属性 ${attrId} 未翻译` });
    }
  }

  const forbiddenWords = new Set([...(draft?.constraints?.forbidden ?? []), ...(glossary?.forbidden ?? [])]);
  for (const word of forbiddenWords) {
    if (word && [name, description].some((text) => text.toLowerCase().includes(String(word).toLowerCase()))) {
      errors.push({ code: 'FORBIDDEN_WORD', message: `出现禁用词「${word}」` });
    }
  }

  for (const [field, value] of Object.entries({ name, description, ...attributes })) {
    if (CHINESE.test(String(value ?? ''))) {
      errors.push({ code: 'CHINESE_RESIDUE', message: `字段 ${field} 仍含中文` });
    }
  }

  const backName = String(back.nameZh ?? '').trim();
  const backDescription = String(back.descriptionZh ?? '').trim();
  if (!backName || !backDescription) {
    errors.push({ code: 'BACKTRANSLATION_MISSING', message: '缺少回译对照（RU→ZH 必填）' });
  }

  const coverage = draftCoverage(draft);
  if (coverage.total > 0 && coverage.ratio < 0.6) {
    errors.push({ code: 'LOW_GLOSSARY_COVERAGE', message: `术语覆盖率 ${coverage.ratio} < 0.6` });
  }

  return { errors, coverage };
}

/**
 * 第二段：模型填完俄语与回译后，校验并落 listing_drafts。
 */
export function commitDraft({ db, draft, glossary = loadGlossary(), now = () => new Date().toISOString() }) {
  const { errors, coverage } = validateDraft(draft, glossary);
  if (errors.length > 0) {
    const primary = errors[0];
    const error = new DraftError(primary.code, errors.map((item) => `${item.code}: ${item.message}`).join('；'));
    error.errors = errors;
    throw error;
  }

  const existed = db.db.prepare('SELECT version FROM listing_drafts WHERE offer_id = ? ORDER BY version DESC LIMIT 1').get(draft.offerId);
  const version = existed ? Number(existed.version) + 1 : 1;
  const qa = { coverage, backTranslation: draft.backTranslation, checkedAt: now() };

  db.db
    .prepare('INSERT INTO listing_drafts (offer_id, version, payload_json, qa_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(draft.offerId, version, JSON.stringify({ slots: draft.slots, zh: draft.zh, constraints: draft.constraints }), JSON.stringify(qa), 'DRAFT_READY', now());

  return { ok: true, errors: [], version, coverage, qa };
}
