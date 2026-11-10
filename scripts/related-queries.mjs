import fs from 'node:fs';
const PORT=9335;const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
static async connect(url){const ws=new WebSocket(url);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('ws'));});const c=new CDP(ws);ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&c.pending.has(m.id)){const{res,rej}=c.pending.get(m.id);c.pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};return c;}
send(m,p={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method:m,params:p}));});}
close(){try{this.ws.close();}catch{}}}
const queries=['когтерезка для кошек','органайзер в машину','скребок для льда','щетка для снега','когтеточка','грелка','уплотнитель для двери'];
const tabs=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
const page=tabs.find(t=>t.type==='page');
const cdp=await CDP.connect(page.webSocketDebuggerUrl);await cdp.send('Runtime.enable');
const EXPR=(q)=>`(async()=>{const u='/api/composer-api.bx/page/json/v2?url='+encodeURIComponent('/search/?text='+encodeURIComponent(${JSON.stringify(q)}));
const r=await fetch(u,{headers:{accept:'application/json'}});if(!r.ok)return {q:${JSON.stringify(q)},status:r.status};
const j=await r.json();const ws=j.widgetStates||{};const out={q:${JSON.stringify(q)},status:200,tags:[],cats:[]};
for(const k of Object.keys(ws)){
 if(/^tapTags/.test(k)){try{const w=JSON.parse(ws[k]);const arr=w.tags||w.items||[];out.tags=arr.map(x=>x.text||x.title||(x.content&&x.content.text)||'').filter(Boolean).slice(0,25);}catch(e){}}
 if(/^catalogMenu/.test(k)){try{const w=JSON.parse(ws[k]);const s=JSON.stringify(w);const m=s.match(/"title":"([^"]{3,40})"/g)||[];out.cats=[...new Set(m.map(x=>x.slice(9,-1)))].slice(0,12);}catch(e){}}
}return out;})()`;
const res=[];
for(const q of queries){const r=await cdp.send('Runtime.evaluate',{expression:EXPR(q),awaitPromise:true,returnByValue:true});const v=r.result&&r.result.value;res.push(v);
 console.log('\n## '+q+' status='+(v&&v.status));
 if(v&&v.tags&&v.tags.length)console.log('  相关搜索: '+v.tags.slice(0,18).join(' | '));
 await sleep(3000+Math.random()*1500);}
fs.writeFileSync('raw/related-queries.json',JSON.stringify(res,null,1),'utf8');
process.exit(0);