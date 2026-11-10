import fs from 'node:fs';
const d=JSON.parse(fs.readFileSync('raw/reviews/reviews.json','utf8'));
const byNiche={};
for(const p of d){ for(const r of (p.reviews||[])){ (byNiche[p.niche]=byNiche[p.niche]||[]).push(r); } }
const stop=new Set(['для','или','это','всё','все','как','так','очень','было','была','были','есть','нет','ещё','уже','только','мне','что','при','его','она','они','чем','без','под','над','через','после','когда','если','там','тут','этот','эта','эти','свой','свою','один','одна','шт','см','мм','руб','ozon','озон','товар','заказ','продавец','доставка','пришло','пришел','пришла','купила','купил','покупала','покупал','брала','брал','советую','рекомендую','спасибо']);
function top(list,n,f){const uni={},bi={};
  for(const t of list){const w=String(t).toLowerCase().replace(/[^а-яёa-z0-9\s-]/g,' ').split(/\s+/).filter(x=>x.length>2&&!stop.has(x));
    for(const x of w)uni[x]=(uni[x]||0)+1;
    for(let i=0;i<w.length-1;i++){const k=w[i]+' '+w[i+1];bi[k]=(bi[k]||0)+1;}}
  const b=Object.entries(bi).filter(([k,v])=>v>=f).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([k,v])=>k+'('+v+')').join(' · ');
  const u=Object.entries(uni).filter(([k,v])=>v>=f+1).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([k,v])=>k+'('+v+')').join(' · ');
  return {b,u};}
for(const [niche,list] of Object.entries(byNiche)){
  const badTxt=[],goodTxt=[];let negFilled=0;
  for(const r of list){const s=r.score||0;
    if(r.negative)negFilled++;
    if(s>0&&s<=3){badTxt.push(r.comment||'');if(r.negative)badTxt.push(r.negative);}
    if(s>=4){if(r.positive)goodTxt.push(r.positive);}}
  const n=list.length;
  console.log('\n#### '+niche+'  n='+n+'  有"缺点"字段的比例='+(negFilled*100/n).toFixed(0)+'%');
  const bt=top(badTxt,14,1);const gt=top(goodTxt,12,2);
  console.log('  痛点phrase: '+bt.b);
  console.log('  痛点word : '+bt.u);
  console.log('  好评phrase: '+gt.b);
}
const skus={};for(const p of d){skus[p.sku]=(skus[p.sku]||[]).concat(p.reviews||[]);}
console.log('\n--- 每 SKU 评分分布 ---');
for(const [sku,rs] of Object.entries(skus)){const n=rs.length;const s=rs.reduce((a,r)=>a+(r.score||0),0);console.log(sku+' n='+n+' avg='+(s/n).toFixed(2));}