import { spawn } from 'node:child_process';
import fs from 'node:fs';
const CHROME='C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE='.chrome-auth';
const PORT=9342; const PROXY='http://127.0.0.1:7897';
fs.mkdirSync(PROFILE,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function up(){try{const r=await fetch('http://127.0.0.1:'+PORT+'/json/version');return r.ok;}catch{return false;}}
if(!(await up())){
 const flags=['--remote-debugging-port='+PORT,'--user-data-dir='+PROFILE,'--no-first-run','--no-default-browser-check','--disable-blink-features=AutomationControlled','--proxy-server='+PROXY,'--lang=ru-RU','--window-size=1360,940','--window-position=80,60','--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36','about:blank'];
 const c=spawn(CHROME,flags,{stdio:'ignore',detached:true}); c.unref();
 for(let i=0;i<100;i++){ if(await up())break; await sleep(300);}
}
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
static async connect(url){const ws=new WebSocket(url);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('ws'));});const c=new CDP(ws);ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&c.pending.has(m.id)){const{res,rej}=c.pending.get(m.id);c.pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};return c;}
send(m,p={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method:m,params:p}));});}
close(){try{this.ws.close();}catch{}}}
const tabs=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
const page=tabs.find(t=>t.type==='page');
const cdp=await CDP.connect(page.webSocketDebuggerUrl);
await cdp.send('Page.enable');await cdp.send('Runtime.enable');
await cdp.send('Page.navigate',{url:'https://seller.ozon.ru/'});
let len=0;for(let i=0;i<14;i++){await sleep(2500);const t=await cdp.send('Runtime.evaluate',{expression:'document.body?document.body.innerText.length:0',returnByValue:true});len=t.result?.value||0;if(len>800)break;}
const info=await cdp.send('Runtime.evaluate',{expression:'JSON.stringify({title:document.title,url:location.href,head:(document.body?document.body.innerText:\'\').slice(0,600)})',returnByValue:true});
console.log('INFO '+(info.result&&info.result.value));
const shot=await cdp.send('Page.captureScreenshot',{format:'png'});
fs.writeFileSync('raw/seller-login-window.png',Buffer.from(shot.data,'base64'));
console.log('SHOT saved');
process.exit(0);