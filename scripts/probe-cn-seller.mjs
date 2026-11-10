import fs from 'node:fs';
const PORT=9222;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const T=(p,ms=15000)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),ms))]);
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
static async connect(url){const ws=new WebSocket(url);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('ws'));});const c=new CDP(ws);ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&c.pending.has(m.id)){const{res,rej}=c.pending.get(m.id);c.pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};return c;}
send(m,p={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method:m,params:p}));});}
close(){try{this.ws.close();}catch{}}}
const tabs=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
const page=tabs.find(t=>t.type==='page');
const cdp=await CDP.connect(page.webSocketDebuggerUrl);
await T(cdp.send('Page.enable'));await T(cdp.send('Runtime.enable'));
const targets=['https://seller.ozonru.cn/app/','https://seller.ozonru.cn/index'];
for(const url of targets){
  try{ await T(cdp.send('Page.navigate',{url})); }catch(e){ console.log('nav fail '+e.message); }
  await sleep(9000);
  try{ const t=await T(cdp.send('Runtime.evaluate',{expression:`JSON.stringify({u:location.href,t:document.title,l:(document.body?document.body.innerText:'').length,head:(document.body?document.body.innerText:'').slice(0,260)})`,returnByValue:true})); console.log('PROBE ' + url + '\n  ' + (t.result&&t.result.value)); }catch(e){ console.log('eval fail '+e.message); }
}
try{ const shot=await T(cdp.send('Page.captureScreenshot',{format:'png'})); fs.writeFileSync('raw/cn-seller.png',Buffer.from(shot.data,'base64')); console.log('shot saved'); }catch(e){ console.log('shot fail '+e.message); }
process.exit(0);