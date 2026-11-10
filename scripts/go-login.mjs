import fs from 'node:fs';
const PORT=9342;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
static async connect(url){const ws=new WebSocket(url);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('ws'));});const c=new CDP(ws);ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&c.pending.has(m.id)){const{res,rej}=c.pending.get(m.id);c.pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};return c;}
send(m,p={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method:m,params:p}));});}
close(){try{this.ws.close();}catch{}}}
const tabs=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
const page=tabs.find(t=>t.type==='page');
const cdp=await CDP.connect(page.webSocketDebuggerUrl);
await cdp.send('Page.enable');await cdp.send('Runtime.enable');
// 找登录入口
const ls=await cdp.send('Runtime.evaluate',{expression:`JSON.stringify([...document.querySelectorAll('a,button')].map(e=>({t:(e.innerText||'').trim().slice(0,20),h:e.getAttribute('href')||'',c:e.className.slice(0,40)})).filter(x=>/登录|войти|login/i.test(x.t)).slice(0,8))`,returnByValue:true});
console.log('LOGIN LINKS '+ (ls.result&&ls.result.value));
// 尝试打开登录页
const cands=JSON.parse((ls.result&&ls.result.value)||'[]');
const target=cands.find(x=>x.h&&x.h.includes('login'));
if(target){await cdp.send('Page.navigate',{url:new URL(target.h,'https://seller.ozon.ru').href});}
else {await cdp.send('Page.navigate',{url:'https://seller.ozon.ru/app/login'});}
let len=0;for(let i=0;i<12;i++){await sleep(2500);const t=await cdp.send('Runtime.evaluate',{expression:'document.body?document.body.innerText.length:0',returnByValue:true});len=t.result?.value||0;if(len>300)break;}
const info=await cdp.send('Runtime.evaluate',{expression:'JSON.stringify({title:document.title,url:location.href,head:(document.body?document.body.innerText:\'\').slice(0,700)})',returnByValue:true});
console.log('AFTER '+ (info.result&&info.result.value));
const shot=await cdp.send('Page.captureScreenshot',{format:'png'});
fs.writeFileSync('raw/seller-login-2.png',Buffer.from(shot.data,'base64'));
console.log('shot2 saved');
process.exit(0);