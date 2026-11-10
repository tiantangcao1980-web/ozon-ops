const PORT=9335;const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
static async connect(url){const ws=new WebSocket(url);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('ws'));});const c=new CDP(ws);ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&c.pending.has(m.id)){const{res,rej}=c.pending.get(m.id);c.pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};return c;}
send(m,p={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method:m,params:p}));});}
close(){try{this.ws.close();}catch{}}}
const tabs=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
const page=tabs.find(t=>t.type==='page');
const cdp=await CDP.connect(page.webSocketDebuggerUrl);await cdp.send('Runtime.enable');
const expr=`(async()=>{const u='/api/composer-api.bx/page/json/v2?url='+encodeURIComponent('/product/1234567893/');
const j=await (await fetch(u,{headers:{accept:'application/json'}})).json();
const ws=j.widgetStates||{};const hits=[];
for(const k of Object.keys(ws)){const s=String(ws[k]);let i=s.indexOf('Вес');if(i>=0){hits.push({widget:k,ctx:s.slice(Math.max(0,i-120),i+220)});} }
const keys=Object.keys(ws).filter(k=>/characteristics|PdpGrid|Aspects|webDescription/i.test(k));
return {hits:hits.slice(0,6),gridKeys:keys.slice(0,10)};})()`;
const r=await cdp.send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
console.log(JSON.stringify(r.result&&r.result.value,null,1).slice(0,4500));
process.exit(0);