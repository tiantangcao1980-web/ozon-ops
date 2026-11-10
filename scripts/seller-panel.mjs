import fs from 'node:fs';
const PORT=Number(process.env.CDP_PORT||9342);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
static async connect(url){const ws=new WebSocket(url);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('ws'));});const c=new CDP(ws);ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&c.pending.has(m.id)){const{res,rej}=c.pending.get(m.id);c.pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};return c;}
send(m,p={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method:m,params:p}));});}
close(){try{this.ws.close();}catch{}}}
const tabs=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
const page=tabs.find(t=>t.type==='page');
if(!page){console.log('NO_PAGE');process.exit(1);}
const cdp=await CDP.connect(page.webSocketDebuggerUrl);
await cdp.send('Page.enable');await cdp.send('Runtime.enable');
await cdp.send('Page.navigate',{url:'https://seller.ozon.ru/app/'});
let len=0;for(let i=0;i<12;i++){await sleep(2500);const t=await cdp.send('Runtime.evaluate',{expression:'document.body?document.body.innerText.length:0',returnByValue:true});len=t.result?.value||0;if(len>200)break;}
const st=await cdp.send('Runtime.evaluate',{expression:`JSON.stringify({url:location.href,title:document.title,len:(document.body?document.body.innerText:'').length})`,returnByValue:true});
const s=JSON.parse((st.result&&st.result.value)||'{}');
console.log('CABINET ' + JSON.stringify(s));
if(/registration|signin|sso\.ozon|login/i.test(s.url||'')){console.log('NOT_LOGGED_IN');process.exit(2);}
console.log('LOGGED_IN');
const links=await cdp.send('Runtime.evaluate',{expression:`JSON.stringify([...document.querySelectorAll('a')].map(a=>({t:(a.innerText||'').trim().replace(/\\s+/g,' ').slice(0,40),h:a.getAttribute('href')||''})).filter(x=>/продвиж|реклам|аналит|отч[её]т|статистик|кампани/i.test(x.t)).slice(0,40))`,returnByValue:true});
console.log('LINKS ' + (links.result&&links.result.value));
const shot=await cdp.send('Page.captureScreenshot',{format:'png'});
fs.writeFileSync('raw/seller-cabinet.png',Buffer.from(shot.data,'base64'));
console.log('shot saved');
process.exit(0);