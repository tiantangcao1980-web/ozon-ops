import fs from 'node:fs';
const PORT=9342;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// 浏览器级 CDP：最大化窗口
const ver=await (await fetch('http://127.0.0.1:'+PORT+'/json/version')).json();
const bws=new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res,rej)=>{bws.onopen=res;bws.onerror=()=>rej(new Error('bws fail'));});
let bid=0;const bp=new Map();
bws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&bp.has(m.id)){const{res,rej}=bp.get(m.id);bp.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};
const bsend=(method,params)=>new Promise((res,rej)=>{const id=++bid;bp.set(id,{res,rej});bws.send(JSON.stringify({id,method,params}));});
const tabs0=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
const tgt=tabs0.find(t=>t.type==='page');
const win=await bsend('Browser.getWindowForTarget',{targetId:tgt.id});
await bsend('Browser.setWindowBounds',{windowId:win.windowId,bounds:{windowState:'normal',left:60,top:40,width:1400,height:950}});
await bsend('Browser.setWindowBounds',{windowId:win.windowId,bounds:{windowState:'maximized'}});
console.log('window maximized');
bws.close();
// 回到俄文登录页并截图
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
static async connect(url){const ws=new WebSocket(url);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('ws'));});const c=new CDP(ws);ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&c.pending.has(m.id)){const{res,rej}=c.pending.get(m.id);c.pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};return c;}
send(m,p={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method:m,params:p}));});}
close(){try{this.ws.close();}catch{}}}
const cdp=await CDP.connect(tgt.webSocketDebuggerUrl);
await cdp.send('Page.enable');await cdp.send('Runtime.enable');
await cdp.send('Page.navigate',{url:'https://seller.ozon.ru/app/registration/signin'});
await sleep(9000);
const st=await cdp.send('Runtime.evaluate',{expression:`JSON.stringify({url:location.href,title:document.title,len:(document.body?document.body.innerText:'').length})`,returnByValue:true});
console.log('STATE '+(st.result&&st.result.value));
const shot=await cdp.send('Page.captureScreenshot',{format:'png'});
fs.writeFileSync('raw/login-window-ready.png',Buffer.from(shot.data,'base64'));
console.log('ready shot saved');
process.exit(0);