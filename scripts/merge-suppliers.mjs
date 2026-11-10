import fs from 'node:fs';
const files=['raw/1688-detail-raw1.txt','raw/1688-detail-raw2.txt','raw/1688-detail-raw3.txt'];
const groupBy={ '1234567824':'pet','1234567827':'pet','1234567822':'pet','1234567823':'pet','1234567813':'auto','1234567829':'auto','1234567821':'auto','1234567825':'auto','1234567828':'spatula','1234567811':'spatula','1234567826':'spatula','1234567812':'spatula' };
const rows=[];
for(const f of files){ if(!fs.existsSync(f))continue; const raw=fs.readFileSync(f,'utf8');
  for(const b of raw.split(/={20,}/)){
    const url=(b.match(/requested_url:\s*(\S+)/)||[])[1]||(b.match(/url:\s*(\S+)/)||[])[1]||'';
    const id=(url.match(/offer\/(\d+)/)||[])[1]; if(!id) continue;
    const title=((b.match(/title:\s*([^\n]+)/)||[])[1]||'').replace(/ - 阿里巴巴$/,'');
    const seller=(b.match(/#\s*\[([^\]]{2,40})\]\(https:\/\/[a-z0-9]+\.1688\.com/)||[])[1]||'';
    const yr=(b.match(/入驻(\d+)年/)||[])[1]||'';
    const blocked=/验证码拦截|x5secdata|punish/.test(b.slice(0,600));
    const prices=[...new Set([...b.matchAll(/¥\s*(\d+(?:\.\d+)?)/g)].map(m=>Number(m[1])))].filter(x=>x>0&&x<500).sort((a,b)=>a-b);
    const moq=(b.match(/(\d+)\s*件起批/)||[])[1]||'';
    rows.push({group:groupBy[id]||'?',id,title,seller,years:yr,blocked,prices,moq});
  }
}
const uniq={};for(const r of rows){ if(!uniq[r.id])uniq[r.id]=r; }
const list=Object.values(uniq);
fs.writeFileSync('raw/1688-suppliers.json',JSON.stringify(list,null,1),'utf8');
for(const g of ['auto','pet','spatula']){ console.log('\n=== '+g);
  for(const r of list.filter(x=>x.group===g)) console.log('  '+r.id+' | '+(r.blocked?'[CAPTCHA] ':'')+r.seller+' 入驻'+(r.years||'?')+'年 | ¥'+(r.prices.join('/')||'?')+' | MOQ='+(r.moq||'?')+' | '+r.title.slice(0,42)); }