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
await cdp.send('Page.enable');await cdp.send('Runtime.enable');await cdp.send('Network.enable');
const failed=[];
cdp.ws.addEventListener('message',(ev)=>{try{const m=JSON.parse(ev.data);if(m.method==='Network.loadingFailed')failed.push((m.params.errorText||'')+' '+(m.params.blockedReason||''));}catch(e){}});
await sleep(14000);
const st=await cdp.send('Runtime.evaluate',{expression:`JSON.stringify({rs:document.readyState,title:document.title,url:location.href,len:(document.body?document.body.innerText:'').length,head:(document.body?document.body.innerText:'').slice(0,400),inputs:document.querySelectorAll('input').length})`,returnByValue:true});
console.log('STATE '+ (st.result&&st.result.value));
console.log('FAILED(top10) '+ JSON.stringify(failed.slice(0,10)));
const shot=await cdp.send('Page.captureScreenshot',{format:'png'});
fs.writeFileSync('raw/seller-login-3.png',Buffer.from(shot.data,'base64'));
console.log('shot3 saved');
process.exit(0);