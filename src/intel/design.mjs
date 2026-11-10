/**
 * 竞品视觉拆解：主图/附图/详情图角色、配色、详情页区块结构。
 * 纯函数；数据来源是 MCP 浏览器抽取的 DOM 摘要（见 intel design ingest）。
 */

export function classifyImageRole({ inDescription = false, index = 0 } = {}) {
  if (inDescription) return 'detail';
  return index === 0 ? 'main' : 'gallery';
}

export function parseImageUrls(raw = []) {
  const seen = new Set();
  const images = [];
  for (const item of raw) {
    const url = String(item?.url ?? '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    images.push({
      url,
      role: classifyImageRole({ inDescription: Boolean(item.inDescription), index: images.length }),
      index: images.length,
      width: item.width ?? null,
      height: item.height ?? null,
    });
  }
  return images;
}

export function extractPalette(samples = [], { k = 5, bucket = 32 } = {}) {
  const counts = new Map();
  for (const rgb of samples) {
    if (!Array.isArray(rgb) || rgb.length < 3) continue;
    const key = rgb
      .slice(0, 3)
      .map((value) => Math.round(Number(value) / bucket) * bucket)
      .map((value) => Math.min(255, Math.max(0, value)))
      .join(',');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0) || 1;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([key, count]) => {
      const [r, g, b] = key.split(',').map(Number);
      const hex = `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
      return { hex, rgb: [r, g, b], share: Math.round((count / total) * 100) / 100 };
    });
}

export function summarizeBlocks(blocks = []) {
  const order = blocks
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((block) => block.type ?? 'unknown');
  const counts = {};
  for (const type of order) counts[type] = (counts[type] ?? 0) + 1;
  return { total: order.length, order, counts };
}

export function designBrief({ sku, palette = [], blocks, images = [] }) {
  const roles = images.reduce((acc, image) => {
    acc[image.role] = (acc[image.role] ?? 0) + 1;
    return acc;
  }, {});
  const lines = [
    `# 竞品视觉 brief · SKU ${sku}`,
    '',
    `- 图片：主图 ${roles.main ?? 0}、附图 ${roles.gallery ?? 0}、详情图 ${roles.detail ?? 0}`,
    `- 配色（占比降序）：${palette.map((item) => `${item.hex}(${Math.round((item.share ?? 0) * 100)}%)`).join('、') || '未取到'}`,
    `- 详情页区块顺序：${blocks?.order?.join(' → ') || '未取到'}`,
    `- 区块统计：${blocks ? Object.entries(blocks.counts).map(([type, count]) => `${type}×${count}`).join('、') : '—'}`,
    '',
    '## 复用建议',
    '',
    '1. 主图：沿用对方主色做背景带 + 产品居中，标题放顶部 1/5。',
    '2. 附图：按「场景 → 尺寸/规格 → 使用步骤 → 对比」顺序补 3–5 张。',
    '3. 详情页：按抽取到的区块顺序排（图 → 文 → 图 → 参数表），配色不超过 3 种。',
  ];
  return lines.join('\n');
}
