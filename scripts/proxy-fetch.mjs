const PORT=Number(process.env.CDP_PORT||9335);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
static async connect(url){const ws=new WebSocket(url);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('ws err'));});const c=new CDP(ws);ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&c.pending.has(m.id)){const{res,rej}=c.pending.get(m.id);c.pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};return c;}
send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));});}
close(){try{this.ws.close();}catch{}}}
const urls=process.argv.slice(2);
const maxLen=Number(process.env.MAXLEN||4000);
const out=[];
for(const u of urls){
  const tr=await fetch('http://127.0.0.1:'+PORT+'/json/new?'+encodeURIComponent('about:blank'),{method:'PUT'});
  const info=await tr.json();
  const cdp=await CDP.connect(info.webSocketDebuggerUrl);
  await cdp.send('Page.enable');await cdp.send('Runtime.enable');
  try{await cdp.send('Page.navigate',{url:u});}catch(e){out.push({url:u,error:String(e)});cdp.close();continue;}
  let len=0;for(let i=0;i<12;i++){await sleep(2500);try{const t=await cdp.send('Runtime.evaluate',{expression:'document.body?document.body.innerText.length:0',returnByValue:true});len=t.result&&t.result.value||0;}catch(e){}if(len>400)break;}
  const t=await cdp.send('Runtime.evaluate',{expression:'document.title',returnByValue:true});
  const x=await cdp.send('Runtime.evaluate',{expression:'document.body?document.body.innerText.slice(0,'+maxLen+'):\'\'',returnByValue:true});
  const now=await cdp.send('Runtime.evaluate',{expression:'location.href',returnByValue:true});
  out.push({url:u,finalUrl:now.result&&now.result.value,len,title:t.result&&t.result.value,text:x.result&&x.result.value});
  cdp.close();
  await fetch('http://127.0.0.1:'+PORT+'/json/close/'+info.id).catch(()=>{});
}
console.log(JSON.stringify(out,null,1));
process.exit(0);