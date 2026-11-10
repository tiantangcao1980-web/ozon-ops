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
await cdp.send('Runtime.enable');
await sleep(12000);
const st=await cdp.send('Runtime.evaluate',{expression:`JSON.stringify({url:location.href,title:document.title,len:(document.body?document.body.innerText:'').length,inputs:document.querySelectorAll('input').length,head:(document.body?document.body.innerText:'').slice(0,200)})`,returnByValue:true});
console.log('STATE '+(st.result&&st.result.value));
const shot=await cdp.send('Page.captureScreenshot',{format:'png'});
fs.writeFileSync('raw/login-window-ready2.png',Buffer.from(shot.data,'base64'));
console.log('shot saved');
process.exit(0);