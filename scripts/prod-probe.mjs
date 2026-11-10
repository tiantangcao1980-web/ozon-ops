const PORT=Number(process.env.CDP_PORT||9335);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function devtools(){try{const r=await fetch('http://127.0.0.1:'+PORT+'/json/version');return r.ok;}catch{return false;}}
console.log('chrome up:', await devtools());
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
static async connect(url){const ws=new WebSocket(url);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('ws err'));});const c=new CDP(ws);ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&c.pending.has(m.id)){const{res,rej}=c.pending.get(m.id);c.pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};return c;}
send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));});}
close(){try{this.ws.close();}catch{}}}
const tabs=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
let page=tabs.find(t=>t.type==='page');
if(!page){const nr=await fetch('http://127.0.0.1:'+PORT+'/json/new?about:blank',{method:'PUT'});page=await nr.json();}
const cdp=await CDP.connect(page.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.navigate',{url:'https://www.ozon.ru/'});
await sleep(4000);
const expr=`(async()=>{const u='/api/composer-api.bx/page/json/v2?url='+encodeURIComponent('/product/1234567894/');const r=await fetch(u,{headers:{accept:'application/json'}});const t=await r.text();
if(!r.ok)return {status:r.status,body:t.slice(0,200)};
let j;try{j=JSON.parse(t);}catch(e){return {parse:'fail',head:t.slice(0,200)};}
const ws=j.widgetStates||{};return {status:r.status,keys:Object.keys(ws).slice(0,60),pageType:j.pageInfo&&j.pageInfo.pageType,url:j.pageInfo&&j.pageInfo.url};})()`;
const r=await cdp.send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
console.log(JSON.stringify(r.result&&r.result.value,null,1).slice(0,3000));
process.exit(0);