const PORT=9335;
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
static async connect(url){const ws=new WebSocket(url);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('ws'));});const c=new CDP(ws);ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&c.pending.has(m.id)){const{res,rej}=c.pending.get(m.id);c.pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};return c;}
send(m,p={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method:m,params:p}));});}
close(){try{this.ws.close();}catch{}}}
const tabs=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
const page=tabs.find(t=>t.type==='page');
const cdp=await CDP.connect(page.webSocketDebuggerUrl);await cdp.send('Runtime.enable');
const expr=`(async()=>{const u='/api/composer-api.bx/page/json/v2?url='+encodeURIComponent('/product/1234567892/reviews/');
const j=await (await fetch(u,{headers:{accept:'application/json'}})).json();
const ws=j.widgetStates||{};const k=Object.keys(ws).find(x=>/^webListReviews/.test(x));
const w=JSON.parse(ws[k]);
const info={keys:Object.keys(w)};
for(const kk of Object.keys(w)){const v=w[kk];if(Array.isArray(v)&&v.length&&typeof v[0]==='object'){info.arrayKey=kk;info.len=v.length;info.firstKeys=Object.keys(v[0]);info.first=v[0];break;}}
return info;})()`;
const r=await cdp.send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
console.log(JSON.stringify(r.result&&r.result.value,null,1).slice(0,4000));
process.exit(0);