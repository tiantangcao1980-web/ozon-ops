
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, ".secrets", "ozon.env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^[\s"'<]+|[\s"'>]+$/g, "");
}
const H = { "Content-Type": "application/json", "Client-Id": env.OZON_CLIENT_ID, "Api-Key": env.OZON_API_KEY };
const BASE = "https://api-seller.ozon.ru";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const OUT = path.join(ROOT, "raw", "own-" + stamp);
fs.mkdirSync(OUT, { recursive: true });

async function api(p, body, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + p, { method: "POST", headers: H, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(90000) });
      const txt = await r.text();
      let json = null; try { json = JSON.parse(txt); } catch {}
      if (r.status === 200) return { ok: true, json };
      if (r.status === 429 || r.status >= 500) { await sleep(2000 * (i + 1)); continue; }
      return { ok: false, status: r.status, txt: txt.slice(0, 400) };
    } catch (e) { await sleep(1500 * (i + 1)); }
  }
  return { ok: false, status: 0, txt: "retry exhausted" };
}
const csv = (rows, cols) => {
  const esc = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
};
const log = [];
const step = async (label, p, body, fn) => {
  const r = await api(p, body);
  if (!r.ok) { log.push("- " + label + ": FAIL " + (r.status || "") + " " + (r.txt || "").slice(0, 200).replace(/\s+/g, " ")); return null; }
  log.push("- " + label + ": OK");
  await sleep(1200);
  return fn ? fn(r.json) : r.json;
};

// 1. 卖家信息
const seller = await step("seller/info", "/v1/seller/info", {}, (j) => j);
if (seller) fs.writeFileSync(path.join(OUT, "seller.json"), JSON.stringify(seller, null, 1), "utf8");

// 2. 商品清单
const all = [];
for (const vis of ["VISIBLE", "ARCHIVED"]) {
  let last = "";
  for (let i = 0; i < 20; i++) {
    const j = await step("product/list " + vis + " p" + i, "/v3/product/list", { filter: { visibility: vis }, last_id: last, limit: 100 }, (x) => x.result);
    if (!j) break;
    for (const it of j.items || []) all.push({ ...it, visibility: vis });
    last = j.last_id || "";
    if (!(j.items || []).length || !last) break;
  }
}
fs.writeFileSync(path.join(OUT, "products.csv"), csv(all, ["product_id", "offer_id", "sku", "visibility", "archived", "has_fbo_stocks", "has_fbs_stocks"]), "utf8");

// 3. 商品详情
const info = [];
const ids = all.map((x) => x.product_id);
for (let i = 0; i < ids.length; i += 50) {
  const j = await step("product/info/list", "/v3/product/info/list", { product_id: ids.slice(i, i + 50).map(String) }, (x) => x);
  if (j) info.push(...(j.items || []));
}
fs.writeFileSync(path.join(OUT, "product-info.json"), JSON.stringify(info, null, 1), "utf8");
fs.writeFileSync(path.join(OUT, "product-info.csv"), csv(info.map((it) => ({
  offer_id: it.offer_id, product_id: it.id, name: (it.name || "").replace(/\n/g, " "), price: it.price, old_price: it.old_price,
  created_at: it.created_at, category_id: it.description_category_id, type_id: it.type_id, volume_weight: it.volume_weight,
  weight: it.weight, width: it.width, height: it.height, depth: it.depth, status: it.status, archived: it.archived,
})), ["offer_id", "product_id", "name", "price", "old_price", "created_at", "category_id", "type_id", "volume_weight", "weight", "width", "height", "depth", "status", "archived"]), "utf8");

// 4. 价格与佣金
const prices = [];
const pids = ids.map(String);
for (let i = 0; i < pids.length; i += 100) {
  const j = await step("prices", "/v5/product/info/prices", { filter: { product_id: pids.slice(i, i + 100), visibility: "ALL" }, limit: 100 }, (x) => x);
  if (j) prices.push(...(j.items || []));
}
fs.writeFileSync(path.join(OUT, "prices.json"), JSON.stringify(prices, null, 1), "utf8");
fs.writeFileSync(path.join(OUT, "prices.csv"), csv(prices.map((it) => ({
  offer_id: it.offer_id, product_id: it.product_id, price_cny: it.price?.price, old_price: it.price?.old_price, currency: it.price?.currency_code,
  acquiring_pct: it.acquiring, volume_weight: it.volume_weight,
  sales_pct_fbs: it.commissions?.sales_percent_fbs, sales_pct_rfbs: it.commissions?.sales_percent_rfbs,
  sales_pct_fbo: it.commissions?.sales_percent_fbo, sales_pct_fbp: it.commissions?.sales_percent_fbp,
  fbs_first_mile_cny: it.commissions?.fbs_first_mile_max_amount, fbs_trans_cny: it.commissions?.fbs_direct_flow_trans_max_amount,
  fbs_return_cny: it.commissions?.fbs_return_flow_amount, fbo_deliv_cny: it.commissions?.fbo_deliv_to_customer_amount,
  price_index: it.price_indexes?.color_index,
})), ["offer_id", "product_id", "price_cny", "old_price", "currency", "acquiring_pct", "volume_weight", "sales_pct_fbs", "sales_pct_rfbs", "sales_pct_fbo", "sales_pct_fbp", "fbs_first_mile_cny", "fbs_trans_cny", "fbs_return_cny", "fbo_deliv_cny", "price_index"]), "utf8");

// 5. 销售/流量数据：按 SKU×月、SKU×日
const METRICS = ["ordered_units", "revenue", "delivered_units", "returns", "hits_view", "hits_view_search", "hits_view_pdp", "hits_tocart_search", "hits_tocart_pdp", "session_view_pdp", "conv_tocart_pdp", "position_category"];
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const from180 = new Date(today.getTime() - 180 * 864e5);
const from90 = new Date(today.getTime() - 90 * 864e5);
const fetchAll = async (fromDate, dims) => {
  const rows = [];
  for (let off = 0; off < 2000; off += 1000) {
    const j = await step("analytics/data " + dims.join("+") + " off" + off, "/v1/analytics/data", {
      date_from: iso(fromDate), date_to: iso(today), dimension: dims, metrics: METRICS, limit: 1000, offset: off,
      sort: [{ key: "ordered_units", order: "DESC" }],
    }, (x) => x.result);
    if (!j) break;
    rows.push(...(j.data || []));
    if ((j.data || []).length < 1000) break;
  }
  return rows;
};
const flat = (rows) => rows.map((r) => {
  const o = {};
  for (const d of r.dimensions || []) o[d.name ? "dim_name" : "dim_id"] = d.id;
  const dims = (r.dimensions || []).map((d, i) => i === 0 ? d.id : d.name || d.id);
  o.dims = dims.join(" | ");
  METRICS.forEach((m, i) => { o[m] = r.metrics?.[i]; });
  return o;
});
const monthly = await fetchAll(from180, ["sku", "month"]);
fs.writeFileSync(path.join(OUT, "analytics-sku-month.csv"), csv(flat(monthly), ["dims", ...METRICS]), "utf8");
await sleep(1200);
const daily = await fetchAll(from90, ["sku", "day"]);
fs.writeFileSync(path.join(OUT, "analytics-sku-day.csv"), csv(flat(daily), ["dims", ...METRICS]), "utf8");
await sleep(1200);
const byDay = await fetchAll(from90, ["day"]);
fs.writeFileSync(path.join(OUT, "analytics-day.csv"), csv(flat(byDay), ["dims", ...METRICS]), "utf8");

fs.writeFileSync(path.join(OUT, "summary.md"), "# 自有店铺数据 " + stamp + "\n\n店铺：" + (seller?.company?.name || "?") + " / " + (seller?.company?.legal_name || "?") + "\n\n## 调用\n\n" + log.join("\n") + "\n\n## 规模\n\n- 商品 " + all.length + "（visible " + all.filter((x) => x.visibility === "VISIBLE").length + " / archived " + all.filter((x) => x.visibility === "ARCHIVED").length + "）\n- SKU×月行 " + monthly.length + "\n- SKU×日行 " + daily.length + "\n- 日行 " + byDay.length + "\n", "utf8");
console.log("[done]", OUT);
console.log("products", all.length, "info", info.length, "prices", prices.length, "monthly", monthly.length, "daily", daily.length, "byDay", byDay.length);
console.log("seller:", JSON.stringify(seller?.company || {}).slice(0, 300));
console.log("premium:", JSON.stringify(seller?.subscription));
console.log(log.filter((l) => l.includes("FAIL")).join("\n") || "no failures");
