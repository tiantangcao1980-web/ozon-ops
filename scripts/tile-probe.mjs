const PORT=Number(process.env.CDP_PORT||9335);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();this.handlers=new Map();}
static async connect(url){const ws=new WebSocket(url);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('ws err'));});const c=new CDP(ws);ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&c.pending.has(m.id)){const{res,rej}=c.pending.get(m.id);c.pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}else if(m.method)for(const h of(c.handlers.get(m.method)||[]))h(m.params);};return c;}
on(m,fn){const a=this.handlers.get(m)||[];a.push(fn);this.handlers.set(m,a);}
send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));});}
close(){try{this.ws.close();}catch{}}}
const tabs=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
const page=tabs.find(t=>t.type==='page');
const cdp=await CDP.connect(page.webSocketDebuggerUrl);
const tp=process.env.TPATH||'/search/?text='+encodeURIComponent('плоскогубцы');
const expr=`(async()=>{const u='/api/composer-api.bx/page/json/v2?url='+encodeURIComponent(${JSON.stringify(tp)});const j=await (await fetch(u,{headers:{accept:'application/json'}})).json();
const key=Object.keys(j.widgetStates).find(k=>k.startsWith('tileGridDesktop'))||Object.keys(j.widgetStates).find(k=>k.startsWith('searchResults'))||Object.keys(j.widgetStates).find(k=>k.startsWith('skuGrid'));
if(!key)return {noGrid:Object.keys(j.widgetStates)};
const w=JSON.parse(j.widgetStates[key]);
const items=w.items||[];
const first=items[0]||{};
return {key, wKeys:Object.keys(w), itemCount:items.length, pageInfo:j.pageInfo, itemKeys:Object.keys(first), sample:first, second:items[1] ? Object.keys(items[1]) : null};})()`;
const r=await cdp.send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
console.log(JSON.stringify(r.result&&r.result.value,null,1).slice(0,6000));
process.exit(0);