import fs from 'node:fs';
const PORT=Number(process.env.CDP_PORT||9335);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitDevtools(){for(let i=0;i<100;i++){try{const r=await fetch('http://127.0.0.1:'+PORT+'/json/version');if(r.ok)return await r.json();}catch{}await sleep(300);}throw new Error('devtools not up');}
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();this.handlers=new Map();}
static async connect(url){const ws=new WebSocket(url);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('ws err'));});const c=new CDP(ws);ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&c.pending.has(m.id)){const{res,rej}=c.pending.get(m.id);c.pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}else if(m.method)for(const h of(c.handlers.get(m.method)||[]))h(m.params);};return c;}
on(m,fn){const a=this.handlers.get(m)||[];a.push(fn);this.handlers.set(m,a);}
send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));});}
close(){try{this.ws.close();}catch{}}}
const ver=await waitDevtools();
const tabs=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
const page=tabs.find(t=>t.type==='page');
const cdp=await CDP.connect(page.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
const targetPath=process.env.TPATH||'/search/?text='+encodeURIComponent('плоскогубцы');
await cdp.send('Page.navigate',{url:'https://www.ozon.ru'+targetPath});
await sleep(6000);
const expr=`(async()=>{try{const u='/api/composer-api.bx/page/json/v2?url='+encodeURIComponent(${JSON.stringify(targetPath)});const r=await fetch(u,{headers:{'accept':'application/json'}});const t=await r.text();let j=null;try{j=JSON.parse(t);}catch(e){return {apiStatus:r.status,raw:t.slice(0,300)};}
const ws=Object.keys(j.widgetStates||{});
return {apiStatus:r.status, topKeys:Object.keys(j).slice(0,30), widgetCount:ws.length, widgets:ws.slice(0,45), seo:j.seo||null};}catch(e){return {error:String(e)};}})()`;
const r=await cdp.send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
console.log(JSON.stringify(r.result&&r.result.value,null,1));
process.exit(0);