import fs from 'node:fs';
const niches=JSON.parse(fs.readFileSync('raw/market-run2/niches.json','utf8'));
const want=['汽车内饰小件','桌面办公收纳','家居收纳小件','厨房小工具','宠物清洁小件','园艺小工具'];
for(const n of niches){ if(!want.includes(n.key)) continue;
  const band=(n.rows||[]).filter(r=>r.price>=490&&r.price<=1655);
  console.log('\n=== '+n.key+' 带内 '+band.length+' 条');
  for(const r of band.slice(0,12)) console.log('  '+r.price+'₽ | 评价'+(r.reviews==null?'-':r.reviews)+' | ★'+(r.rating==null?'-':r.rating)+' | '+(r.discount||'')+' | '+String(r.name).slice(0,90));
}