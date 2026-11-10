import fs from 'node:fs';
const PORT=9222;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function ver(){try{const r=await fetch('http://127.0.0.1:'+PORT+'/json/version');if(!r.ok)return null;return await r.json();}catch{return null;}}
let v=null;
for(let i=0;i<12;i++){v=await ver();if(v)break;await sleep(2500);}
if(!v){console.log('PORT_9222_DOWN');process.exit(3);}
console.log('BROWSER ' + v.Browser);
let tabs=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
let page=tabs.find(t=>t.type==='page');
if(!page){const nr=await fetch('http://127.0.0.1:'+PORT+'/json/new?about:blank',{method:'PUT'});page=await nr.json();}
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
static async connect(url){const ws=new WebSocket(url);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('ws'));});const c=new CDP(ws);ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&c.pending.has(m.id)){const{res,rej}=c.pending.get(m.id);c.pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};return c;}
send(m,p={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method:m,params:p}));});}
close(){try{this.ws.close();}catch{}}}
const cdp=await CDP.connect(page.webSocketDebuggerUrl);
await cdp.send('Page.enable');await cdp.send('Runtime.enable');
await cdp.send('Page.navigate',{url:'https://seller.ozon.ru/app/'});
let len=0;for(let i=0;i<14;i++){await sleep(2500);const t=await cdp.send('Runtime.evaluate',{expression:'document.body?document.body.innerText.length:0',returnByValue:true});len=t.result?.value||0;if(len>300)break;}
const st=await cdp.send('Runtime.evaluate',{expression:`JSON.stringify({url:location.href,title:document.title,len:(document.body?document.body.innerText:'').length,head:(document.body?document.body.innerText:'').slice(0,300)})`,returnByValue:true});
console.log('CABINET ' + (st.result&&st.result.value));
const shot=await cdp.send('Page.captureScreenshot',{format:'png'});
fs.writeFileSync('raw/seller-9222.png',Buffer.from(shot.data,'base64'));
console.log('shot saved');
process.exit(0);