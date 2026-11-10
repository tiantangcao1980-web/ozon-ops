
import fs from "node:fs";
const env = {};
for (const line of fs.readFileSync(".secrets\\ozon.env","utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^[\s"'<]+|[\s"'>]+$/g,"");
}
const H = { "Content-Type":"application/json", "Client-Id": env.OZON_CLIENT_ID, "Api-Key": env.OZON_API_KEY };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(p, body, hdrs = H) {
  try {
    const r = await fetch("https://api-seller.ozon.ru" + p, { method:"POST", headers:hdrs, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch {}
    return { status: r.status, json: j, txt };
  } catch (e) { return { status: 0, txt: String(e.message||e) }; }
}
const tests = [
  ["SELLER 全市场前10", "/v1/analytics/category/comparison", { period:"MONTH", sort:"DESC", group:"SELLER", metric:"GMV", limit:10, offset:0, filter:{ category:{ category_type:"CATEGORY_1" } } }],
  ["analytics/data 30天", "/v1/analytics/data", { date_from:"2026-10-01", date_to:"2026-10-31", dimension:["day"], metrics:["ordered_units","revenue"], limit:31, offset:0 }],
  ["卖家信息", "/v1/seller/info", {}],
];
for (const [label, p, b] of tests) {
  const r = await call(p, b);
  console.log("\n==", label, p, "->", r.status, r.json ? Object.keys(r.json).join(",") : "-");
  console.log("   ", r.txt.slice(0, 350));
  await sleep(2500);
}
// 公开站点探测
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/159.0.0.0 Safari/537.36";
for (const u of [
  "https://www.ozon.ru/",
  "https://www.ozon.ru/api/composer-api.bx/page/json/v2?url=%2Fcategory%2Fdom-i-sad-17027494%2F",
  "https://api.ozon.ru/composer-api.bx/page/json/v2?url=%2Fsearch%2F%3Ftext%3D%D0%BE%D1%80%D0%B3%D0%B0%D0%BD%D0%B0%D0%B9%D0%B7%D0%B5%D1%80",
]) {
  try {
    const r = await fetch(u, { headers: { "User-Agent": UA, "Accept": "application/json,text/html", "Accept-Language":"ru-RU,ru;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(25000) });
    const t = await r.text();
    console.log("\n[public]", u.slice(0,80), "->", r.status, "len", t.length, "ct", r.headers.get("content-type"), "|", t.slice(0, 160).replace(/\s+/g," "));
  } catch (e) { console.log("\n[public]", u.slice(0,80), "ERR", String(e.message||e).slice(0,120)); }
}
