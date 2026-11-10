const PORT=9335;
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
static async connect(url){const ws=new WebSocket(url);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('ws'));});const c=new CDP(ws);ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&c.pending.has(m.id)){const{res,rej}=c.pending.get(m.id);c.pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};return c;}
send(m,p={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method:m,params:p}));});}
close(){try{this.ws.close();}catch{}}}
const tabs=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
const page=tabs.find(t=>t.type==='page');
const cdp=await CDP.connect(page.webSocketDebuggerUrl);await cdp.send('Runtime.enable');
const expr=`(async()=>{const out=[];
const tries=['/api/composer-api.bx/page/json/v2?url=','/api/entrypoint-api.bx/page/json/v2?url='];
const paths=['/suggest/?text=','/search-suggest/?text=','/api/suggest?text='];
for(const b of tries){for(const p of paths){
try{const r=await fetch(b+encodeURIComponent(p+'когтерезка'),{headers:{accept:'application/json'}});const t=await r.text();let keys=[];try{const j=JSON.parse(t);keys=Object.keys(j.widgetStates||j).slice(0,12);}catch(e){keys=['raw',t.slice(0,80)];}out.push({b:b.slice(6,26),p,status:r.status,keys});}catch(e){out.push({p,err:String(e).slice(0,50)});}
await new Promise(z=>setTimeout(z,1500));}}
return out;})()`;
const r=await cdp.send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
console.log(JSON.stringify(r.result&&r.result.value,null,1).slice(0,3000));
process.exit(0);