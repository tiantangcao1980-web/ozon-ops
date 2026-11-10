import fs from 'node:fs';
const niches=JSON.parse(fs.readFileSync('raw/market-run2/niches.json','utf8'));
const pick=[['汽车内饰小件','auto'],['宠物清洁小件','pet']];
const out=[];
for(const [key,tag] of pick){const n=niches.find(x=>x.key===key);if(!n)continue;
  const band=(n.rows||[]).filter(r=>r.price>=490&&r.price<=1655&&r.sku);
  band.sort((a,b)=>(b.reviews||0)-(a.reviews||0));
  const top=band.slice(0,3), low=band.filter(r=>(r.reviews||0)<100).slice(0,3);
  for(const r of [...top,...low]) out.push({tag,niche:key,sku:String(r.sku),price:r.price,reviews:r.reviews,name:r.name});
}
fs.writeFileSync('raw/sku-targets.json',JSON.stringify(out,null,1),'utf8');
console.log('targets',out.length);for(const o of out)console.log(o.tag,o.sku,o.price+'₽',(o.reviews==null?'-':o.reviews),String(o.name).slice(0,60));