#!/usr/bin/env node
/**
 * Ozon Seller API 只读取数器（选品用）
 * 官方 OpenAPI 快照：references/ozon-seller-openapi.json（MissiaL/ozon-api，checked 2026-10-18）
 * 只发 POST 读接口；不调用任何写接口。
 *
 * 用法：
 *   1) 填 .secrets/ozon.env（OZON_CLIENT_ID / OZON_API_KEY）
 *   2) node scripts/ozon-api-pull.mjs            # 全量
 *      node scripts/ozon-api-pull.mjs tree search # 只跑指定步骤
 *   3) 产物：raw\pull-<时间戳>\*.json + *.csv + summary.md + report.json
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const BASE = "https://api-seller.ozon.ru";
const PREMIUM = (process.env.OZON_PREMIUM_PRO || loadEnv().OZON_PREMIUM_PRO || "0") === "1";

function loadEnv() {
  const p = path.join(ROOT, ".secrets", "ozon.env");
  const env = {};
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^[\s"'<]+|[\s"'>]+$/g, "");
    }
  }
  return env;
}
const E = { ...loadEnv(), ...process.env };
const CLIENT_ID = (E.OZON_CLIENT_ID || "").trim();
const API_KEY = (E.OZON_API_KEY || "").trim();
if (!/^\d+$/.test(CLIENT_ID) || API_KEY.length < 10) {
  console.error("[FATAL] 缺少有效凭据。请在 .secrets\\ozon.env 里填 OZON_CLIENT_ID（纯数字）和 OZON_API_KEY。");
  process.exit(2);
}

const TS = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const OUT = path.join(ROOT, "raw", "pull-" + TS);
fs.mkdirSync(OUT, { recursive: true });
const report = { started_at: new Date().toISOString(), premium_declared: PREMIUM, calls: [], outputs: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, body, label) {
  const t0 = Date.now();
  let rec = { label: label || p, path: p, body_preview: JSON.stringify(body || {}).slice(0, 300) };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(BASE + p, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Client-Id": CLIENT_ID, "Api-Key": API_KEY },
        body: JSON.stringify(body || {}),
        signal: AbortSignal.timeout(60000),
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { }
      Object.assign(rec, { status: res.status, ok: res.ok, ms: Date.now() - t0, bytes: text.length });
      if (res.ok) { rec.ok = true; report.calls.push(rec); return { ok: true, json, text, status: res.status }; }
      rec.error = json ? { code: json.code, message: json.message, details: JSON.stringify(json.details || "").slice(0, 300) } : text.slice(0, 300);
      if (res.status === 429 || res.status >= 500) { await sleep(1500 * attempt); continue; }
      report.calls.push(rec);
      return { ok: false, status: res.status, json, text, error: rec.error };
    } catch (e) {
      Object.assign(rec, { status: 0, error: { message: String(e && e.message || e).slice(0, 200) }, ms: Date.now() - t0 });
      if (attempt < 3) { await sleep(1000 * attempt); continue; }
      report.calls.push(rec);
      return { ok: false, status: 0, error: rec.error };
    }
  }
  report.calls.push(rec);
  return { ok: false, status: 0, error: rec.error };
}

const save = (name, data) => {
  const p = path.join(OUT, name);
  fs.writeFileSync(p, typeof data === "string" ? data : JSON.stringify(data, null, 1), "utf8");
  report.outputs[name] = p;
  return p;
};
const csv = (rows, cols, name) => {
  const esc = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const body = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(typeof c === "function" ? "" : r[c])).join(","))].join("\n");
  save(name, "\ufeff" + body);
};

const STEPS = {
  async tree() {
    const r = await api("/v1/description-category/tree", { language: "ZH_HANS" }, "类目树");
    if (!r.ok) return;
    save("tree.json", r.json);
    const leaves = [];
    const walk = (nodes, trail, inheritedId) => {
      for (const n of nodes || []) {
        const cid = n.description_category_id || inheritedId;
        const t = [...trail, n.category_name || n.type_name || String(cid)];
        if (n.type_id) leaves.push({ description_category_id: cid, category_name: n.category_name || trail[trail.length - 1] || "", type_id: n.type_id, type_name: n.type_name || "", path: t.join(" > ") });
        if (n.children) walk(n.children, t, cid);
      }
    };
    walk(r.json.result, [], 0);
    csv(leaves, ["description_category_id", "category_name", "type_id", "type_name", "path"], "categories.csv");
    report.outputs.leaf_count = leaves.length;
    save("tree.json", r.json);
  },

  async search() {
    const seeds = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "seeds.json"), "utf8"));
    const rows = [];
    const top = await api("/v1/search-queries/top", { limit: "1000", offset: "0" }, "热门搜索词");
    if (top.ok) {
      save("search-top.json", top.json);
      for (const q of top.json.search_queries || []) rows.push({ source: "top", ...q });
    }
    fs.mkdirSync(path.join(OUT, "search-text"), { recursive: true });
    for (const kw of seeds.seed_queries || []) {
      const r = await api("/v1/search-queries/text", { text: kw, limit: "200", offset: "0", sort_by: "CLIENT_COUNT", sort_dir: "DESC" }, "搜索词反查: " + kw);
      if (r.ok) {
        save("search-text/" + kw.replace(/[^\w\u0400-\u04FF]+/g, "_") + ".json", r.json);
        for (const q of r.json.search_queries || []) rows.push({ source: "text:" + kw, ...q });
      }
      await sleep(300);
    }
    csv(rows, ["source", "query", "client_count", "items_views", "add_to_cart", "conversion_to_cart", "avg_price", "sellers_count"], "search-queries.csv");
  },

  async category() {
    const seeds = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "seeds.json"), "utf8"));
    const tree = fs.existsSync(path.join(OUT, "tree.json")) ? JSON.parse(fs.readFileSync(path.join(OUT, "tree.json"), "utf8")) : null;
    const leaves = [];
    const walk = (nodes, trail, inheritedId) => { for (const n of nodes || []) { const cid = n.description_category_id || inheritedId; const t = [...trail, n.category_name || ""]; if (n.type_id) leaves.push({ id: cid, name: trail[trail.length - 1] || n.category_name || "", path: t.join(" > ") }); if (n.children) walk(n.children, t, cid); } };
    if (tree) walk(tree.result, [], 0);
    const picked = (seeds.target_categories || []).map((want) => leaves.find((l) => l.name.includes(want)) || leaves.find((l) => l.path.includes(want))).filter(Boolean);
    const targets = picked.length ? picked : leaves.slice(0, 12);
    save("targets.json", targets);
    const combos = [
      { group: "CATEGORY_3", metric: "GMV" },
      { group: "SELLER", metric: "GMV" },
      { group: "PRICE_BOUNDARY", metric: "GMV" },
      { group: "CATEGORY_3", metric: "SELLERS" },
      { group: "CATEGORY_3", metric: "AIV" },
      { group: "CATEGORY_3", metric: "BUYOUT" }
    ];
    fs.mkdirSync(path.join(OUT, "category"), { recursive: true });
    const rows = [];
    for (const t of targets) {
      for (const c of combos) {
        const body = { period: "MONTH", sort: "DESC", limit: 100, offset: 0, group: c.group, metric: c.metric, filter: { category: { category_id: t.id } } };
        const r = await api("/v1/analytics/category/comparison", body, "类目对比 " + t.name + " " + c.group + "/" + c.metric);
        if (!r.ok) { await sleep(300); continue; }
        save("category/" + t.id + "-" + c.group + "-" + c.metric + ".json", r.json);
        for (const it of r.json.items || []) rows.push({ category_id: t.id, category_name: t.name, group: c.group, metric: c.metric, id: it.id, label: it.label, rating: it.rating, gmv: it.metric_gmv, sellers: it.metric_sellers, items: it.metric_items, aiv: it.metric_aiv, buyout: it.metric_buyout, leader_share: it.metric_leader_share, category_share: it.metric_category_share, brands: it.metric_brands });
        await sleep(300);
      }
    }
    csv(rows, ["category_id", "category_name", "group", "metric", "id", "label", "rating", "gmv", "sellers", "items", "aiv", "buyout", "leader_share", "category_share", "brands"], "category-comparison.csv");
  },

  async own() {
    const list = await api("/v3/product/list", { filter: { visibility: "ALL" }, last_id: "", limit: 1000 }, "自有商品清单");
    if (!list.ok) return;
    save("own-products.json", list.json);
    const ids = (list.json.result?.items || []).map((i) => String(i.product_id));
    report.outputs.own_product_count = ids.length;
    if (!ids.length) return;
    const all = [];
    for (let i = 0; i < ids.length; i += 100) {
      const r = await api("/v5/product/info/prices", { filter: { product_id: ids.slice(i, i + 100), visibility: "ALL" }, limit: 1000 }, "自有商品价格/佣金");
      if (r.ok) all.push(...(r.json.items || []));
      await sleep(300);
    }
    save("own-prices.json", { items: all });
    csv(all.map((x) => ({ sku: x.product_id, offer_id: x.offer_id, price: x.price?.price, net_price: x.price?.net_price, commission_rfbs: x.commissions?.sales_percent_rfbs, commission_fbs: x.commissions?.sales_percent_fbs, min_price_ozon: x.price_indexes?.ozon_index_data?.min_price })), ["sku", "offer_id", "price", "net_price", "commission_rfbs", "commission_fbs", "min_price_ozon"], "own-prices.csv");
  }
};

const want = process.argv.slice(2).filter((a) => STEPS[a]);
const order = want.length ? want : ["tree", "search", "category", "own"];
for (const step of order) {
  console.log("\n>>> " + step);
  try { await STEPS[step](); } catch (e) { report.calls.push({ label: step, fatal: String(e && e.stack || e).slice(0, 400) }); console.error("[ERR]", step, e.message); }
  await sleep(300);
}

const okN = report.calls.filter((c) => c.ok).length;
const bad = report.calls.filter((c) => !c.ok);
report.finished_at = new Date().toISOString();
report.summary = { calls: report.calls.length, ok: okN, failed: bad.length };
save("report.json", report);
const lines = [
  "# Ozon API 取数报告 " + TS,
  "",
  "- 调用 " + report.calls.length + " 次，成功 " + okN + "，失败 " + bad.length,
  "- Premium Pro（声明）：" + (PREMIUM ? "是" : "否"),
  "",
  "## 失败明细（含权限判断依据）",
  "",
  "| 端点 | 状态 | 错误 |",
  "|---|---|---|",
  ...bad.map((b) => "| " + b.label + " | " + b.status + " | " + String(b.error?.message || b.error?.error || b.fatal || "").replace(/\|/g, "/").slice(0, 160) + " |"),
  "",
  "## 产物",
  "",
  ...Object.entries(report.outputs).map(([k, v]) => "- " + k + ": " + v)
];
save("summary.md", lines.join("\n"));
console.log("\n[done] " + OUT + "\n" + lines.slice(0, 12).join("\n"));
