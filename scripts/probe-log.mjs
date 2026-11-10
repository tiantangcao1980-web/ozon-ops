import fs from 'node:fs';
const raw=fs.readFileSync('.secrets/ozon.env','utf8');const env={};
for(const line of raw.split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^[\s"'<]+|[\s"'>]+$/g,'');}
const H={'Client-Id':env.OZON_CLIENT_ID,'Api-Key':env.OZON_API_KEY,'Content-Type':'application/json'};
const tests=[['/v1/seller/ozon-logistics/info',{}],['/v1/analytics/local-sale/total',{period:{date_from:'2026-10-01',date_to:'2026-11-06'}}]];
for(const [p,b] of tests){
  try{const r=await fetch('https://api-seller.ozon.ru'+p,{method:'POST',headers:H,body:JSON.stringify(b)});
  console.log('=== '+p, r.status); console.log((await r.text()).slice(0,1500));}catch(e){console.log('ERR',p,String(e).slice(0,150));}
  await new Promise(x=>setTimeout(x,2200));
}