import fs from 'node:fs';
const envPath='.secrets/ozon.env';
const raw=fs.readFileSync(envPath,'utf8');
const env={};
for(const line of raw.split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^[\s"'<]+|[\s"'>]+$/g,'');}
const H={'Client-Id':env.OZON_CLIENT_ID,'Api-Key':env.OZON_API_KEY,'Content-Type':'application/json'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const SKU='1234567890';
const tests=[
 ['/v1/analytics/product-queries',{date_from:'2026-08-01T00:00:00Z',date_to:'2026-11-06T23:59:59Z',page:0,page_size:50,skus:[SKU]}],
 ['/v1/analytics/product-queries/details',{date_from:'2026-08-01T00:00:00Z',date_to:'2026-11-06T23:59:59Z',limit_by_sku:15,page:0,page_size:100,skus:[SKU]}],
 ['/v1/analytics/turnover/stocks',{limit:100,offset:0,sku:[SKU]}],
 ['/v1/analytics/stocks',{skus:[SKU]}],
 ['/v1/search-queries/top',{limit:'100',offset:'0'}],
 ['/v1/search-queries/text',{limit:'100',offset:'0',text:'плоскогубцы'}],
 ['/v1/rating/summary',{}],
 ['/v1/review/count',{}],
 ['/v1/question/count',{}]
];
const out=[];
for(const [p,body] of tests){
  const t0=Date.now();
  try{
    const r=await fetch('https://api-seller.ozon.ru'+p,{method:'POST',headers:H,body:JSON.stringify(body)});
    const txt=await r.text();
    out.push({path:p,status:r.status,ms:Date.now()-t0,body:txt.slice(0,700)});
  }catch(e){out.push({path:p,error:String(e).slice(0,200)});}
  await sleep(2200);
}
console.log(JSON.stringify(out,null,1));