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
const ws=j.widgetStates||{};const res={};
for(const k of Object.keys(ws)){const s=String(ws[k]);for(const label of ['Достоинства','Минусы','Комментарий','отзыв']){const i=s.indexOf(label);if(i>=0&&!res[label]){res[label]={widget:k,ctx:s.slice(Math.max(0,i-150),i+300)};}}}
res.totalKeys=Object.keys(ws).length;
const revKeys=Object.keys(ws).filter(k=>/review/i.test(k));res.revKeys=revKeys;
return res;})()`;
const r=await cdp.send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
console.log(JSON.stringify(r.result&&r.result.value,null,1).slice(0,3500));
process.exit(0);