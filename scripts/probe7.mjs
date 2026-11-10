
import fs from "node:fs";
const env = {};
for (const line of fs.readFileSync(".secrets\\ozon.env","utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^[\s"'<]+|[\s"'>]+$/g,"");
}
const H = { "Content-Type":"application/json", "Client-Id": env.OZON_CLIENT_ID, "Api-Key": env.OZON_API_KEY };
async function api(p, body) {
  const r = await fetch("https://api-seller.ozon.ru"+p, { method:"POST", headers:H, body: JSON.stringify(body||{}), signal: AbortSignal.timeout(60000) });
  return { status:r.status, txt: await r.text() };
}
const ids = ["1234567895","1234567896","1234567897","1234567898"];
let r = await api("/v5/product/info/prices", { filter:{ product_id: ids, visibility:"ALL" }, limit:100 });
console.log("prices:", r.status);
if (r.status===200) {
  const j = JSON.parse(r.txt);
  for (const it of j.items||[]) console.log(it.product_id, "|", JSON.stringify(it.price), "|", JSON.stringify(it.commissions).slice(0,200), "|", it.currency_code);
} else console.log(r.txt.slice(0,300));
