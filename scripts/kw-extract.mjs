import fs from 'node:fs';
function parseCsvLine(l){const out=[];let cur='',q=false;for(let i=0;i<l.length;i++){const c=l[i];if(c==='"'){if(q&&l[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(c===','&&!q){out.push(cur);cur='';}else cur+=c;}out.push(cur);return out;}
const all=[];
for(const f of ['raw/market-hpw/products.csv','raw/market-run2/products.csv']){
  const lines=fs.readFileSync(f,'utf8').split(/\r?\n/).slice(1);
  for(const l of lines){if(!l.trim())continue;const c=parseCsvLine(l);all.push({niche:c[0],name:c[3]||''});}
}
const targets=['汽车内饰小件','宠物清洁小件','汽车除冰刮','汽车扫雪刷','猫抓板贴','门缝防风密封条','热水袋','保暖耳罩'];
const stop=new Set(['для','и','с','в','на','из','по','под','от','к','у','не','а','или','шт','см','мм','г','мл','л','the']);
for(const t of targets){
  const names=all.filter(x=>x.niche===t).map(x=>x.name.toLowerCase().replace(/[^а-яёa-z0-9\s-]/g,''));
  const uni={},bi={};
  for(const n of names){const w=n.split(/\s+/).filter(x=>x.length>2&&!stop.has(x));
    for(const x of w)uni[x]=(uni[x]||0)+1;
    for(let i=0;i<w.length-1;i++){const k=w[i]+' '+w[i+1];bi[k]=(bi[k]||0)+1;}}
  const topU=Object.entries(uni).sort((a,b)=>b[1]-a[1]).slice(0,14).map(([k,v])=>k+'('+v+')').join(', ');
  const topB=Object.entries(bi).filter(([k,v])=>v>=2).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>k+'('+v+')').join(', ');
  console.log('\n### '+t+'  n='+names.length);
  console.log('  双词: '+topB);
  console.log('  单词: '+topU);
}