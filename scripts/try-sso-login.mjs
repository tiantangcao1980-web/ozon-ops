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
await T(cdp.send('Page.navigate',{url:'https://seller.ozon.ru/app/registration/signin'}));
await sleep(8000);
const btn=await T(cdp.send('Runtime.evaluate',{expression:`JSON.stringify([...document.querySelectorAll('a,button')].map((e,i)=>({i,t:(e.innerText||'').trim().slice(0,20),tag:e.tagName,h:e.getAttribute('href')||''})).filter(x=>/войти/i.test(x.t)))`,returnByValue:true}));
console.log('BTNS ' + (btn.result&&btn.result.value));
const clickRes=await T(cdp.send('Runtime.evaluate',{expression:`(()=>{const els=[...document.querySelectorAll('a,button')].filter(e=>/^Войти$/i.test((e.innerText||'').trim()));if(!els.length)return 'no-button';els[0].click();return 'clicked';})()`,returnByValue:true}));
console.log('CLICK ' + (clickRes.result&&clickRes.result.value));
for(let i=0;i<10;i++){
  await sleep(3000);
  try{ const t=await T(cdp.send('Runtime.evaluate',{expression:`JSON.stringify({u:location.href,t:document.title,l:(document.body?document.body.innerText:'').length})`,returnByValue:true})); const s=t.result&&t.result.value; console.log('poll '+i+' '+s); if(s&&!/registration|signin|sso\./i.test(s))break; }catch(e){ console.log('poll '+i+' fail'); }
}
try{ const shot=await T(cdp.send('Page.captureScreenshot',{format:'png'})); fs.writeFileSync('raw/seller-after-click.png',Buffer.from(shot.data,'base64')); console.log('shot saved'); }catch(e){ console.log('shot fail'); }
process.exit(0);