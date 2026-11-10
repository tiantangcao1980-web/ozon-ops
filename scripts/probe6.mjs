
import fs from "node:fs";
const env = {};
for (const line of fs.readFileSync(".secrets\\ozon.env","utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^[\s"'<]+|[\s"'>]+$/g,"");
}
const H = { "Content-Type":"application/json", "Client-Id": env.OZON_CLIENT_ID, "Api-Key": env.OZON_API_KEY };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(p, body) {
  try { const r = await fetch("https://api-seller.ozon.ru"+p, { method:"POST", headers:H, body: JSON.stringify(body||{}), signal: AbortSignal.timeout(60000) });
    const txt = await r.text(); return { status:r.status, txt }; } catch(e){ return { status:0, txt:String(e.message||e) }; }
}
const tests = [
  ["/v1/analytics/product-queries", { date_from:"2026-09-01", date_to:"2026-11-06", limit:20, offset:0, page:1 }],
  ["/v1/analytics/local-sale/total", { date_from:"2026-10-01", date_to:"2026-10-31", limit:20, offset:0 }],
  ["/v1/analytics/stocks", { limit:20, offset:0 }],
  ["/v2/analytics/stock_on_warehouses", { limit:20, offset:0, warehouse_type:"ALL" }],
  ["/v1/product/info/subscription", { sku: ["1234567890"] }],
];
for (const [p, b] of tests) {
  const r = await api(p, b);
  console.log("\n==", p, "->", r.status, "|", r.txt.slice(0, 320).replace(/\s+/g," "));
  await sleep(1800);
}
