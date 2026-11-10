
import fs from "node:fs";
const env = {};
for (const line of fs.readFileSync(".secrets\\ozon.env","utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^[\s"'<]+|[\s"'>]+$/g,"");
}
const H = { "Content-Type":"application/json", "Client-Id": env.OZON_CLIENT_ID, "Api-Key": env.OZON_API_KEY };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(p, body) {
  try {
    const r = await fetch("https://api-seller.ozon.ru" + p, { method:"POST", headers:H, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    const txt = await r.text(); let j=null; try{j=JSON.parse(txt);}catch{}
    return { status:r.status, json:j, txt };
  } catch(e){ return { status:0, txt:String(e.message||e) }; }
}
for (const [label, p, b] of [
  ["商品 VISIBLE", "/v3/product/list", { filter:{ visibility:"VISIBLE" }, last_id:"", limit:50 }],
  ["商品 ARCHIVED", "/v3/product/list", { filter:{ visibility:"ARCHIVED" }, last_id:"", limit:50 }],
  ["analytics/data by sku", "/v1/analytics/data", { date_from:"2026-10-01", date_to:"2026-11-06", dimension:["sku"], metrics:["ordered_units","revenue"], limit:50, offset:0 }],
  ["analytics/data by day nov", "/v1/analytics/data", { date_from:"2026-11-01", date_to:"2026-11-06", dimension:["day"], metrics:["ordered_units","revenue","session_view_pdp"], limit:10, offset:0 }],
]) {
  const r = await api(p, b);
  console.log("\n==", label, "->", r.status);
  console.log("   ", r.txt.slice(0, 700));
  await sleep(2000);
}
console.log("\n--- reachability ---");
for (const u of ["https://seller.ozonru.cn/", "https://data.ozon.ru/", "https://mpstats.io/", "https://ozon.ru/", "https://m.ozon.ru/"]) {
  const t0 = Date.now();
  try {
    const r = await fetch(u, { headers:{ "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/159.0.0.0 Safari/537.36" }, signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    console.log("[reach]", u, "->", r.status, "len", t.length, Date.now()-t0+"ms", "|", t.slice(0,100).replace(/\s+/g," "));
  } catch(e){ console.log("[reach]", u, "ERR", String(e.message||e).slice(0,100), Date.now()-t0+"ms"); }
}
