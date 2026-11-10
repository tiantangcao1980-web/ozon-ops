
import fs from "node:fs";
const env = {};
for (const line of fs.readFileSync(".secrets\\ozon.env","utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^[\s"'<]+|[\s"'>]+$/g,"");
}
const H = { "Content-Type":"application/json", "Client-Id": env.OZON_CLIENT_ID, "Api-Key": env.OZON_API_KEY };
async function call(p, body) {
  try {
    const r = await fetch("https://api-seller.ozon.ru" + p, { method:"POST", headers:H, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch {}
    return { status: r.status, json: j, txt };
  } catch (e) { return { status: 0, txt: String(e.message||e) }; }
}
const bodies = [
  ["A 全市场 CATEGORY_1 无 category_id", { period:"MONTH", sort:"DESC", group:"CATEGORY_3", metric:"GMV", filter:{ category:{ category_type:"CATEGORY_1" } } }],
  ["B 全市场 空 filter", { period:"MONTH", sort:"DESC", group:"CATEGORY_3", metric:"GMV", filter:{} }],
  ["C 文具下 CATEGORY_1", { period:"MONTH", sort:"DESC", group:"CATEGORY_3", metric:"GMV", filter:{ category:{ category_id:17027492, category_type:"CATEGORY_1" } } }],
  ["D 文具 SELLER 前20", { period:"MONTH", sort:"DESC", group:"SELLER", metric:"GMV", limit:20, offset:0, filter:{ category:{ category_id:17027492, category_type:"CATEGORY_1" } } }],
  ["E 全市场 SELLER 前10", { period:"MONTH", sort:"DESC", group:"SELLER", metric:"GMV", limit:10, offset:0, filter:{ category:{ category_type:"CATEGORY_1" } } }],
];
for (const [label, b] of bodies) {
  const r = await call("/v1/analytics/category/comparison", b);
  const items = r.json?.items;
  console.log("\n==", label, "->", r.status, "n=", Array.isArray(items) ? items.length : "n/a", "keys=", r.json ? Object.keys(r.json).join(",") : "-");
  if (r.status !== 200) { console.log("body:", r.txt.slice(0,300)); continue; }
  for (const it of (items||[]).slice(0,6)) console.log("   ", JSON.stringify(it).slice(0,320));
}
