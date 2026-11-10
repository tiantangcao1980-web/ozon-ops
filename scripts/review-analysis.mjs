import fs from 'node:fs';
const d=JSON.parse(fs.readFileSync('raw/reviews/reviews.json','utf8'));
const byNiche={};
for(const p of d){ for(const r of (p.reviews||[])){ (byNiche[p.niche]=byNiche[p.niche]||[]).push({...r,sku:p.sku}); } }
const stop=new Set(['для','и','с','в','на','из','по','под','от','к','у','не','а','но','или','что','это','всё','все','как','так','очень','было','была','были','есть','нет','ещё','уже','только','мне','мы','я','он','она','они','его','её','их','же','ли','бы','при','до','после','через','когда','если','то','там','тут','этот','эта','эти','тот','весь','свой','свою','свои','один','одна','два','три','шт','см','мм','г','мл','л','руб','цена','деньги','ozon','озон']);
function terms(list){const uni={},bi={},tri={};
  for(const t of list){const w=String(t).toLowerCase().replace(/[^а-яёa-z0-9\s-]/g,' ').split(/\s+/).filter(x=>x.length>2&&!stop.has(x));
    for(const x of w)uni[x]=(uni[x]||0)+1;
    for(let i=0;i<w.length-1;i++){bi[w[i]+' '+w[i+1]]=(bi[w[i]+' '+w[i+1]]||0)+1;}
    for(let i=0;i<w.length-2;i++){const k=w[i]+' '+w[i+1]+' '+w[i+2];tri[k]=(tri[k]||0)+1;}}
  const top=(o,n,f)=>Object.entries(o).filter(([k,v])=>v>=f).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([k,v])=>k+'('+v+')').join(' · ');
  return {bi:top(bi,18,2),tri:top(tri,12,2),uni:top(uni,20,3)};}
for(const [niche,list] of Object.entries(byNiche)){
  const dist={5:0,4:0,3:0,2:0,1:0};let sum=0,photos=0;
  const neg=[],pos=[],bad=[],good=[];
  for(const r of list){const s=r.score||0;if(dist[s]!=null)dist[s]++;sum+=s;if(r.photos)photos++;
    if(r.negative)neg.push(r.negative); if(r.positive)pos.push(r.positive);
    if(s>0&&s<=3&&r.comment)bad.push(r.comment); if(s>=4&&r.comment)good.push(r.comment);}
  const n=list.length;
  console.log('\n########## '+niche+'  n='+n+'  avg='+(sum/n).toFixed(2)+'  5★'+(dist[5]*100/n).toFixed(0)+'% 4★'+(dist[4]*100/n).toFixed(0)+'% 3★'+(dist[3]*100/n).toFixed(0)+'% 2★'+(dist[2]*100/n).toFixed(0)+'% 1★'+(dist[1]*100/n).toFixed(0)+'%  带图'+(photos*100/n).toFixed(0)+'%');
  console.log('  【缺点高频】'+terms(neg).tri);
  console.log('  【缺点词】'+terms(neg).uni);
  console.log('  【优点高频】'+terms(pos).tri);
  console.log('  【差评片段】');
  bad.slice(0,6).forEach(t=>console.log('    - '+String(t).replace(/\s+/g,' ').slice(0,170)));
}