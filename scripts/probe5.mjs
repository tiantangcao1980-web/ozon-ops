
import fs from "node:fs";
const env = {};
for (const line of fs.readFileSync(".secrets\\ozon.env","utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^[\s"'<]+|[\s"'>]+$/g,"");
}
const H = { "Content-Type":"application/json", "Client-Id": env.OZON_CLIENT_ID, "Api-Key": env.OZON_API_KEY };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(p, body) {
  const r = await fetch("https://api-seller.ozon.ru" + p, { method:"POST", headers:H, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const txt = await r.text(); let j=null; try{j=JSON.parse(txt);}catch{}
  return { status:r.status, json:j, txt };
}
// 全量归档商品
let all = [], last = "";
for (let i=0;i<10;i++) {
  const r = await api("/v3/product/list", { filter:{ visibility:"ARCHIVED" }, last_id:last, limit:100 });
  const items = r.json?.result?.items || [];
  all.push(...items); last = r.json?.result?.last_id || "";
  if (!items.length || !last) break;
  await sleep(1500);
}
console.log("archived total:", all.length, "total_items:", (await api("/v3/product/list",{filter:{visibility:"ARCHIVED"},last_id:"",limit:1})).json?.result?.total_items);
fs.writeFileSync("raw\\archived-products.json", JSON.stringify(all, null, 1), "utf8");
// 详情
const ids = all.map(x=>x.product_id);
const out = [];
for (let i=0;i<ids.length;i+=50) {
  const r = await api("/v3/product/info/list", { product_id: ids.slice(i,i+50).map(String) });
  if (r.status !== 200) { console.log("info err", r.status, r.txt.slice(0,200)); break; }
  out.push(...(r.json?.items || []));
  await sleep(1500);
}
console.log("info rows:", out.length);
for (const it of out.slice(0, 25)) {
  console.log([it.offer_id, it.name?.slice(0,40), "price="+it.price, "old="+it.old_price, "created="+it.created_at, "cat="+it.description_category_id, "type="+it.type_id, "vol="+JSON.stringify(it.volume_weight), "comm="+(it.commission?.percent ?? "-")].join(" | "));
}
fs.writeFileSync("raw\\archived-info.json", JSON.stringify(out, null, 1), "utf8");
// 长期销量
const r2 = await api("/v1/analytics/data", { date_from:"2026-09-01", date_to:"2026-11-06", dimension:["sku","month"], metrics:["ordered_units","revenue","session_view_pdp","conv_tocart_pdp"], limit:100, offset:0 });
console.log("\nlong sku metrics:", r2.status, r2.txt.slice(0, 900));
