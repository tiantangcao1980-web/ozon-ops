const PORT=Number(process.env.CDP_PORT||9335);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();this.handlers=new Map();}
static async connect(url){const ws=new WebSocket(url);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('ws err'));});const c=new CDP(ws);ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&c.pending.has(m.id)){const{res,rej}=c.pending.get(m.id);c.pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}else if(m.method)for(const h of(c.handlers.get(m.method)||[]))h(m.params);};return c;}
send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));});}
close(){try{this.ws.close();}catch{}}}
const tabs=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
const page=tabs.find(t=>t.type==='page');
if(!page){console.log('NO PAGE');process.exit(1);}
const cdp=await CDP.connect(page.webSocketDebuggerUrl);
const parseFn=`function parseTile(it){const o={sku:it.sku||it.id||null,name:null,price:null,orig:null,discount:null,rating:null,reviews:null,sold:null,badges:[]};const ms=it.mainState||[];for(const s of ms){if(s.type==='priceV2'){const p=s.priceV2.price||[];for(const x of p){if(x.textStyle==='PRICE')o.price=x.text;if(x.textStyle==='ORIGINAL_PRICE')o.orig=x.text;}o.discount=s.priceV2.discount||null;}else if(s.type==='textDS'&&s.id==='name'){o.name=s.textDS.text;}else if(s.type==='labelListV2'){const txt=(s.labelListV2.items||[]).filter(i=>i.type==='text').map(i=>i.text.text);o.labels=txt;for(const t of txt){if(/отзыв/.test(t))o.reviews=gNum(t);else if(/^[0-9][0-9.,]*$/.test(t))o.rating=Number(t.replace(',','.'));else if(/окуп|родан|аказ/.test(t))o.sold=t;}}else if(s.type==='textDS'&&s.id!=='name'){const t=s.textDS.text||'';if(/окуп|родан|аказ/.test(t))o.sold=t;}else if(s.type==='labelListV2'&&s.labelListV2&&s.labelListV2.text){}}if(it.tileImage&&it.tileImage.leftBottomBadgeV2)o.badges.push(it.tileImage.leftBottomBadgeV2.text);return o;}`;
const expr=`(async()=>{${parseFn}
function gNum(t){if(t==null)return null;const m=String(t).replace(/[\s\u00a0]/g,'').match(/([0-9][0-9.,]*)/);if(!m)return null;return Number(m[1].replace(',','.'));}
async function grab(path){const u='/api/composer-api.bx/page/json/v2?url='+encodeURIComponent(path);const r=await fetch(u,{headers:{accept:'application/json'}});if(!r.ok)return {path,status:r.status,rows:[]};const j=await r.json();const ws=j.widgetStates||{};const keys=Object.keys(ws).filter(k=>/^tileGridDesktop/.test(k));const rows=[];for(const k of keys){let w;try{w=JSON.parse(ws[k]);}catch(e){continue;}for(const it of (w.items||[])){if(it.sku||it.id)rows.push(parseTile(it));}}
const pag=Object.keys(ws).filter(k=>/infiniteVirtualPaginator|pagination/i.test(k)).map(k=>{try{return {k,v:JSON.parse(ws[k])};}catch(e){return null;}}).filter(Boolean);
const pv=pag[0]&&pag[0].v?{hasNext:!!pag[0].v.nextPage,keys:Object.keys(pag[0].v),nextPage:pag[0].v.nextPage||null}:null;
return {path,status:r.status,total:j.pageInfo?undefined:undefined,rows,pag:pv,pageInfoUrl:j.pageInfo&&j.pageInfo.url};}
const base=${JSON.stringify('/search/?text='+encodeURIComponent('плоскогубцы'))};
const r1=await grab(base);
const r2=await grab(base+'&page=2');
const r3=await grab(base+'');
return {n1:r1.rows.length,n2:r2.rows.length,first1:r1.rows.slice(0,3),first2:r2.rows.slice(0,3),pag:r1.pag,url:r1.pageInfoUrl};})()`;
const r=await cdp.send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
console.log(JSON.stringify(r.result&&r.result.value,null,1).slice(0,5000));
if(r.exceptionDetails)console.log('EXC:',JSON.stringify(r.exceptionDetails).slice(0,800));
process.exit(0);