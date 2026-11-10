
import fs from "node:fs";
const env = {};
for (const line of fs.readFileSync(".secrets\\ozon.env","utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^[\s"'<]+|[\s"'>]+$/g,"");
}
const H = { "Content-Type":"application/json", "Client-Id": env.OZON_CLIENT_ID, "Api-Key": env.OZON_API_KEY };
const r = await fetch("https://api-seller.ozon.ru/v5/product/info/prices", { method:"POST", headers:H, body: JSON.stringify({ filter:{ product_id:["1234567896"], visibility:"ALL" }, limit:10 }) });
const j = await r.json();
fs.writeFileSync("raw\\price-one.json", JSON.stringify(j, null, 1), "utf8");
console.log(JSON.stringify(j, null, 1).slice(0, 3000));
