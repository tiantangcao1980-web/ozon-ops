const PORT=9222;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const T=(p,ms=15000)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),ms))]);
let ver=null;
try{ ver=await (await fetch('http://127.0.0.1:'+PORT+'/json/version')).json(); }catch(e){ console.log('9222_DOWN'); process.exit(3); }
console.log('BROWSER ' + ver.Browser);
const tabs=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
console.log('TABS ' + JSON.stringify(tabs.filter(t=>t.type==='page').map(t=>({id:t.id,url:(t.url||'').slice(0,100)}))));
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
static async connect(url){const ws=new WebSocket(url);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('ws'));});const c=new CDP(ws);ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&c.pending.has(m.id)){const{res,rej}=c.pending.get(m.id);c.pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};return c;}
send(m,p={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method:m,params:p}));});}
close(){try{this.ws.close();}catch{}}}
const b=await CDP.connect(ver.webSocketDebuggerUrl);
let cookies=[];
try{ const r=await T(b.send('Storage.getCookies',{})); cookies=r.cookies||[]; }catch(e){ console.log('cookie fail '+e.message); }
const oz=cookies.filter(c=>/ozon/i.test(c.domain||''));
const dom={};for(const c of oz)dom[c.domain]=(dom[c.domain]||0)+1;
console.log('COOKIE DOMAINS ' + JSON.stringify(dom));
console.log('SELLER-DOMAIN COOKIES ' + JSON.stringify(oz.filter(c=>/seller/i.test(c.domain||'')).map(c=>c.domain+'|'+c.name)));
b.close();
// 当前页面状态
const page=tabs.find(t=>t.type==='page'&&/ozon/i.test(t.url)) || tabs.find(t=>t.type==='page');
if(page){
  const cdp=await CDP.connect(page.webSocketDebuggerUrl);
  await T(cdp.send('Runtime.enable'));
  for(let i=0;i<4;i++){ await sleep(2000); try{ const t=await T(cdp.send('Runtime.evaluate',{expression:`JSON.stringify({u:location.href.slice(0,110),t:document.title,l:(document.body?document.body.innerText:'').length})`,returnByValue:true})); console.log('PAGE '+i+' '+(t.result&&t.result.value)); }catch(e){ console.log('page eval fail'); } }
  cdp.close();
}
process.exit(0);