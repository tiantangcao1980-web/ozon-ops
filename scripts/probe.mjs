
import fs from "node:fs";
const env = {};
for (const line of fs.readFileSync(".secrets\\ozon.env","utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^[\s"'<]+|[\s"'>]+$/g,"");
}
const H = { "Content-Type":"application/json", "Client-Id": env.OZON_CLIENT_ID, "Api-Key": env.OZON_API_KEY };
async function call(p, body) {
  const t0 = Date.now();
  try {
    const r = await fetch("https://api-seller.ozon.ru" + p, { method:"POST", headers:H, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch {}
    return { p, status: r.status, ms: Date.now()-t0, json: j, txt: txt.slice(0, 400) };
  } catch (e) { return { p, status: 0, err: String(e.message||e).slice(0,150) }; }
}
const probes = [
  ["/v1/analytics/category/comparison", { period:"MONTH", sort:"DESC", limit:100, offset:0, group:"CATEGORY_3", metric:"GMV", filter:{} }],
  ["/v1/analytics/category/comparison", { period:"MONTH", sort:"DESC", limit:20, offset:0, group:"SELLER", metric:"GMV", filter:{ category:{ category_id: 17027492 } } }],
  ["/v1/search-queries/top", { limit:"10", offset:"0" }],
  ["/v1/search-queries/text", { text:"органайзер", limit:"10", offset:"0", sort_by:"CLIENT_COUNT", sort_dir:"DESC" }],
  ["/v3/product/list", { filter:{ visibility:"ALL" }, last_id:"", limit:10 }],
];
for (const [p, b] of probes) {
  const r = await call(p, b);
  const items = r.json?.items || r.json?.search_queries || r.json?.result?.items;
  console.log("\n==", p, JSON.stringify(b).slice(0,120));
  console.log("status", r.status, "ms", r.ms, "keys", r.json ? Object.keys(r.json).join(",") : "-", "n", Array.isArray(items) ? items.length : "n/a");
  if (r.status !== 200) console.log("body:", r.txt);
  else console.log("sample:", JSON.stringify(items?.[0]).slice(0, 500));
}
