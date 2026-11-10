import fs from 'node:fs';
const PORT=9222;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const T=(p,ms=15000)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),ms))]);
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
static async connect(url){const ws=new WebSocket(url);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('ws'));});const c=new CDP(ws);ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&c.pending.has(m.id)){const{res,rej}=c.pending.get(m.id);c.pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};return c;}
send(m,p={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method:m,params:p}));});}
close(){try{this.ws.close();}catch{}}}
const tabs=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
const page=tabs.find(t=>t.type==='page'&&/ozon/i.test(t.url)) || tabs.find(t=>t.type==='page');
console.log('PAGE ' + (page&&page.url.slice(0,90)));
const cdp=await CDP.connect(page.webSocketDebuggerUrl);
await T(cdp.send('Page.enable'));await T(cdp.send('Runtime.enable'));
// 找到「Быстрый вход」并点击
const pre=await T(cdp.send('Runtime.evaluate',{expression:`JSON.stringify([...document.querySelectorAll('button,a,div')].map(e=>({t:(e.innerText||'').trim()})).filter(x=>/быстр|почт/i.test(x.t)).slice(0,6))`,returnByValue:true}));
console.log('CANDIDATES ' + (pre.result&&pre.result.value));
const click=await T(cdp.send('Runtime.evaluate',{expression:`(()=>{const els=[...document.querySelectorAll('button,a')].filter(e=>/быстрый вход/i.test((e.innerText||'').trim()));if(!els.length)return 'no-fast-login';els[0].click();return 'clicked '+els[0].innerText.trim();})()`,returnByValue:true}));
console.log('CLICK ' + (click.result&&click.result.value));
for(let i=0;i<8;i++){ await sleep(3000); try{ const t=await T(cdp.send('Runtime.evaluate',{expression:`JSON.stringify({u:location.href.slice(0,120),t:document.title,l:(document.body?document.body.innerText:'').length})`,returnByValue:true})); console.log('poll '+i+' '+(t.result&&t.result.value)); }catch(e){console.log('poll '+i+' fail');} }
try{ const shot=await T(cdp.send('Page.captureScreenshot',{format:'png'})); fs.writeFileSync('raw/fast-login.png',Buffer.from(shot.data,'base64')); console.log('shot saved'); }catch(e){}
process.exit(0);