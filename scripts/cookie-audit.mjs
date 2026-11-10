const PORT=9222;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const T=(p,ms=15000)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),ms))]);
const ver=await (await fetch('http://127.0.0.1:'+PORT+'/json/version')).json();
const ws=new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('wsfail'));});
let id=0;const pend=new Map();
ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&pend.has(m.id)){const{res,rej}=pend.get(m.id);pend.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};
const send=(method,params={})=>new Promise((res,rej)=>{const i=++id;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method,params}));});
await T(send('Storage.enable')).catch(()=>{});
let cookies=[];
try{ const r=await T(send('Storage.getCookies',{})); cookies=(r.cookies||[]); }catch(e){ console.log('getCookies fail '+e.message); }
const oz=cookies.filter(c=>/ozon/i.test(c.domain||''));
console.log('total cookies=' + cookies.length + ' ozon=' + oz.length);
const by={};for(const c of oz){by[c.domain]=(by[c.domain]||0)+1;}
console.log('ozon domains: ' + JSON.stringify(by));
const names=oz.map(c=>c.domain+'|'+c.name).slice(0,25);
console.log('sample: ' + JSON.stringify(names));
process.exit(0);