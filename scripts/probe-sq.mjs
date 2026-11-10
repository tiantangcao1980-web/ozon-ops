import fs from 'node:fs';
const raw=fs.readFileSync('.secrets/ozon.env','utf8');const env={};
for(const line of raw.split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^[\s"'<]+|[\s"'>]+$/g,'');}
const H={'Client-Id':env.OZON_CLIENT_ID,'Api-Key':env.OZON_API_KEY,'Content-Type':'application/json'};
for(const [p,b] of [['/v1/search-queries/top',{limit:'50',offset:'0'}],['/v1/search-queries/text',{limit:'50',offset:'0',text:'лопатка'}]]){
  const r=await fetch('https://api-seller.ozon.ru'+p,{method:'POST',headers:H,body:JSON.stringify(b)});
  console.log(p, r.status, (await r.text()).slice(0,300));
  await new Promise(x=>setTimeout(x,2200));
}