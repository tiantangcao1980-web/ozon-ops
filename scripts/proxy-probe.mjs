import { spawn } from 'node:child_process';
import fs from 'node:fs';
const CHROME='C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE='.chrome-proxy';
const PORT=Number(process.env.CDP_PORT||9335);
const PROXY=process.env.PROXY||'http://127.0.0.1:7897';
const URLS=process.argv.slice(2);
const HEADED=process.env.HEADLESS==='1'?false:true;
fs.mkdirSync(PROFILE,{recursive:true});
const flags=['--remote-debugging-port='+PORT,'--user-data-dir='+PROFILE,'--no-first-run','--no-default-browser-check','--disable-blink-features=AutomationControlled','--proxy-server='+PROXY,'--lang=ru-RU','--window-size=1400,900','--window-position=-2400,-2400','--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36','about:blank'];
if(!HEADED)flags.unshift('--headless=new');
const child=spawn(CHROME,flags,{stdio:'ignore',detached:true});child.unref();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitDevtools(){for(let i=0;i<100;i++){try{const r=await fetch('http://127.0.0.1:'+PORT+'/json/version');if(r.ok)return await r.json();}catch{}await sleep(300);}throw new Error('devtools not up');}
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();this.handlers=new Map();}
static async connect(url){const ws=new WebSocket(url);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('ws err'));});const c=new CDP(ws);ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&c.pending.has(m.id)){const{res,rej}=c.pending.get(m.id);c.pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}else if(m.method)for(const h of(c.handlers.get(m.method)||[]))h(m.params);};return c;}
on(m,fn){const a=this.handlers.get(m)||[];a.push(fn);this.handlers.set(m,a);}
send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));});}
close(){try{this.ws.close();}catch{}}}
const ver=await waitDevtools();
const out={proxy:PROXY,headed:HEADED,browser:ver.Browser,results:[]};
for(const target of URLS){
  const tr=await fetch('http://127.0.0.1:'+PORT+'/json/new?'+encodeURIComponent('about:blank'),{method:'PUT'});
  const info=await tr.json();const cdp=await CDP.connect(info.webSocketDebuggerUrl);
  await cdp.send('Page.enable');await cdp.send('Network.enable');await cdp.send('Runtime.enable');
  const xhr=[];const reqIdToUrl=new Map();
  cdp.on('Network.requestWillBeSent',(p)=>{const u=p.request.url;if(/xhr|fetch/i.test(p.type)||/\/api\//.test(u)){xhr.push(p.request.method+' '+u.slice(0,180));reqIdToUrl.set(p.requestId,u);}});
  const resp=await cdp.send('Page.navigate',{url:target});
  let len=0;for(let i=0;i<10;i++){await sleep(2500);try{const t=await cdp.send('Runtime.evaluate',{expression:'document.body?document.body.innerText.length:0',returnByValue:true});len=t.result?.value||0;}catch{}if(len>200)break;}
  const title=await cdp.send('Runtime.evaluate',{expression:'document.title',returnByValue:true});
  const urlNow=await cdp.send('Runtime.evaluate',{expression:'location.href',returnByValue:true});
  const text=await cdp.send('Runtime.evaluate',{expression:"document.body?document.body.innerText.slice(0,900):''",returnByValue:true});
  out.results.push({target,navError:resp.errorText||null,len,title:title.result?.value,urlNow:urlNow.result?.value,textHead:String(text.result?.value||''),xhr:xhr.slice(0,15)});
  cdp.close();
}
console.log(JSON.stringify(out,null,1));
process.exit(0);