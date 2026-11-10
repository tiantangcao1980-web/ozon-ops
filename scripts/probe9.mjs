
import fs from "node:fs";
const env = {};
for (const line of fs.readFileSync(".secrets\\ozon.env","utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^[\s"'<]+|[\s"'>]+$/g,"");
}
const H = { "Content-Type":"application/json", "Client-Id": env.OZON_CLIENT_ID, "Api-Key": env.OZON_API_KEY };
const call = async (b) => { const r = await fetch("https://api-seller.ozon.ru/v1/analytics/data",{method:"POST",headers:H,body:JSON.stringify(b)}); return {s:r.status, t: await r.text()}; };
const cands = ["ordered_units","revenue","session_view_pdp","conv_tocart_pdp","hits_view_search","hits_view_pdp","hits_view","hits_tocart_search","hits_tocart_pdp","returns","cancel","delivered_units","position_category","adv_sum_all"];
let accepted = [];
for (const m of cands) {
  const r = await call({ date_from:"2026-10-01", date_to:"2026-10-31", metrics:[m], dimension:["day"], limit:3, offset:0 });
  console.log(m, "->", r.s, r.s===200 ? "OK" : r.t.slice(0,120));
  if (r.s===200) accepted.push(m);
  await new Promise(x=>setTimeout(x,1200));
}
console.log("\naccepted:", accepted.join(","));
