/**
 * 评论痛点归因：按俄语关键词把评论归到主题，统计频次并留样本。
 * 纯规则版（不依赖模型），模型总结在 `ozon intel pains --summarize` 时由会话侧完成。
 */
const THEMES = [
  { theme: 'quality', patterns: [/качеств/i, /сломал/i, /отвалил/i, /плохо/i, /брак/i, /дефект/i] },
  { theme: 'edge', patterns: [/край/i, /толст/i, /тонк/i, /острый/i] },
  { theme: 'handle', patterns: [/ручк/i, /держа/i] },
  { theme: 'packaging', patterns: [/упаковк/i, /плёнк/i, /пленк/i, /порван/i, /коробк/i] },
  { theme: 'delivery', patterns: [/доставк/i, /курьер/i, /срок/i, /опозда/i] },
  { theme: 'size', patterns: [/размер/i, /длин/i, /ширин/i, /см\b/i, /габарит/i] },
  { theme: 'cleaning', patterns: [/моет/i, /мыть/i, /гряз/i, /чист/i, /прилип/i] },
  { theme: 'material', patterns: [/силикон/i, /материал/i, /металл/i, /пластик/i] },
  { theme: 'price', patterns: [/цена/i, /дорог/i, /дешев/i, /стои/i] },
  { theme: 'heat', patterns: [/термо/i, /пригора/i, /жар/i, /сковород/i] },
  { theme: 'smell', patterns: [/запах/i, /воня/i] },
  { theme: 'flexibility', patterns: [/гнёт/i, /гнет/i, /упруг/i, /жестк/i, /мягк/i] },
];

/**
 * @param {Array<{text: string, rating?: number|null}>} reviews
 * @param {{minSamples?: number, samplesPerTheme?: number}} [options]
 */
export function analyzePainPoints(reviews, { samplesPerTheme = 3 } = {}) {
  const buckets = new Map();
  for (const review of reviews ?? []) {
    const text = String(review?.text ?? '');
    if (!text) continue;
    const negative = review?.rating != null && Number(review.rating) <= 3;
    for (const { theme, patterns } of THEMES) {
      if (!patterns.some((pattern) => pattern.test(text))) continue;
      const bucket = buckets.get(theme) ?? { theme, count: 0, negative: 0, samples: [] };
      bucket.count += 1;
      if (negative) bucket.negative += 1;
      if (bucket.samples.length < samplesPerTheme) bucket.samples.push(text.slice(0, 200));
      buckets.set(theme, bucket);
    }
  }
  return [...buckets.values()].sort((a, b) => b.count - a.count || b.negative - a.negative);
}
