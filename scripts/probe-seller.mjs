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
async function probe(url,waitMs){
  await cdp.send('Page.navigate',{url});
  let len=0;for(let i=0;i<Math.ceil(waitMs/2500);i++){await sleep(2500);const t=await cdp.send('Runtime.evaluate',{expression:'document.body?document.body.innerText.length:0',returnByValue:true});len=t.result?.value||0;if(len>300)break;}
  const o=await cdp.send('Runtime.evaluate',{expression:`JSON.stringify({url:location.href,title:document.title,rs:document.readyState,len:(document.body?document.body.innerText:'').length,head:(document.body?document.body.innerText:'').slice(0,300)})`,returnByValue:true});
  console.log('PROBE ' + url);
  console.log('  -> ' + (o.result&&o.result.value));
}
await probe('https://seller.ozon.ru/app/',25000);
await probe('https://seller.ozonru.cn/',20000);
const shot=await cdp.send('Page.captureScreenshot',{format:'png'});
fs.writeFileSync('raw/seller-probe.png',Buffer.from(shot.data,'base64'));
console.log('shot saved');
process.exit(0);