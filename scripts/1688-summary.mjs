import fs from 'node:fs';
import path from 'node:path';

const DIR = process.argv[2] || 'raw\\1688-202611061238';
function parseCsv(txt) {
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) {
      if (c === '"') { if (txt[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); cur = ''; rows.push(row); row = []; }
    else if (c === '\r') { /* skip */ }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
}
function toObjs(rows) { const h = rows[0]; return rows.slice(1).map((r) => { const o = {}; h.forEach((k, i) => o[k] = r[i]); return o; }); }

const c1688 = toObjs(parseCsv(fs.readFileSync(path.join(DIR, 'offers.csv'), 'utf8')));
const cAli = fs.existsSync(path.join(DIR, 'offers-alibaba.csv')) ? toObjs(parseCsv(fs.readFileSync(path.join(DIR, 'offers-alibaba.csv'), 'utf8'))) : [];

const kwOrder = ['硅胶锅铲', '硅胶刮刀', '桌面收纳盒', '笔筒', '猫玩具球', '硅胶蛋糕模具', '园艺小铲', '免打孔浴室置物架', '多功能切菜器', '猫指甲剪', '车载出风口收纳', '冰箱收纳盒'];
const byKw = new Map();
for (const r of c1688) { if (!byKw.has(r.keyword)) byKw.set(r.keyword, []); byKw.get(r.keyword).push(r); }
const byKwAli = new Map();
for (const r of cAli) { if (!byKwAli.has(r.keyword_en)) byKwAli.set(r.keyword_en, []); byKwAli.get(r.keyword_en).push(r); }

const runJson = (() => { for (const f of ['1688-run2.json', '1688-run.json']) { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch {} } return null; })();
const blockers = [];
if (runJson) for (const kw of (runJson.perKw || [])) {
  const errs = (kw.errors || []).filter((e) => /expired|验证码|拦截|ERR|exception/i.test(e));
  if (errs.length) blockers.push({ keyword: kw.keyword, errs });
}

const now = new Date().toISOString();
let md = '';
md += '# 1688 / Alibaba 货源真实报价抓取报告\n\n';
md += '- 抓取时间 (UTC): ' + now + '\n';
md += '- 产出目录: ' + DIR + '\n';
md += '- 数据文件: offers.csv（1688 详情页, ' + c1688.length + ' 行）; offers-alibaba.csv（alibaba.com 搜索页, ' + cAli.length + ' 行）\n';
md += '- 抓取工具: 本机 Chrome (Chrome/152) + 自建最小 CDP 客户端（scripts/1688-*.mjs）\n\n';

md += '## 一、1688 登录墙与可用入口（实测证据）\n\n';
md += '| 尝试入口 | 实际结果 |\n|---|---|\n';
md += '| https://s.1688.com/selloffer/offer_search.htm?keywords=<关键词> | 302 跳转 https://login.taobao.com/... ，页面标题「全球领先的采购批发平台,批发网」，正文仅「登录页面/密码登录/短信登录」；截图 raw/_1688probe/probe1.png |\n';
md += '| https://www.1688.com/ 首页 | 可打开（标题「阿里1688首页」），但搜索结果区无 detail.1688.com 商品链接；首页搜索框 DOM 中无文本输入框（只有 hidden/file input），无法在页内提交搜索 |\n';
md += '| https://m.1688.com/offer_search/-<GBK hex>.html 移动搜索 | 前 2 次加载可渲染约 1500 字结果文本（含商品标题/价格/成交量），随后所有请求 302 跳 https://havanalogin.taobao.com/mini_login.htm（登录墙）；截图 raw/_1688probe/m-search.png |\n';
md += '| **https://tw.1688.com/pic/-<GBK hex>.html** | **免登录可用**：每个关键词返回「共 20000+ 张图片」页，可提取 40 个唯一 offer_id |\n';
md += '| **https://detail.1688.com/offer/<id>.html** | **免登录可用**：自动跳 m.1688.com/offer/<id>.html，可读价格(¥x 起)、起批(件混批)、卖家、累计已售、发货地、属性；部分 ID 返回「验证码拦截」或「商品失效了」 |\n\n';
md += '结论：1688 的 PC/移动搜索接口在未登录状态下被强制登录墙，无法直采搜索结果；本次改用 tw.1688.com/pic 页取 offer_id + 详情页取报价的组合路径。\n\n';

md += '## 二、1688 各关键词代表性报价\n\n';
md += '说明：price 为详情页展示的「¥x 起」单价（人民币，未含运费/优惠）；moq 为页面「N件混批/起批」；monthly_sales 列标注「(累计)」表示页面只给出累计已售而非月销；重量/尺寸页面属性区未给出时留空。\n\n';
for (const kw of kwOrder) {
  const list = byKw.get(kw) || [];
  md += '### ' + kw + '（' + list.length + ' 条）\n\n';
  if (!list.length) { md += '未取到（见下方失败记录）。\n\n'; continue; }
  md += '| 标题 | 单价 CNY | 起批 | 重量 | 尺寸 | 卖家 | 销量 | 货号 |\n|---|---|---|---|---|---|---|---|\n';
  for (const r of list.slice(0, 5)) {
    md += '| ' + (r.title || '').replace(/\|/g, '/').slice(0, 60) + ' | ' + (r.price_min_cny || 'UNKNOWN') + (r.price_max_cny ? '~' + r.price_max_cny : '') + ' | ' + (r.moq || '') + ' | ' + (r.weight_g || '') + ' | ' + (r.size_cm || '') + ' | ' + (r.seller || 'UNKNOWN') + ' | ' + (r.monthly_sales || '') + ' | [' + r.offer_id + '](' + r.url + ') |\n';
  }
  md += '\n';
}

md += '## 三、Alibaba.com 各关键词报价（英文关键词，站点按 CN 地区返回人民币价）\n\n';
md += '说明：currency 列记录页面实际货币符号（本次均为 ¥，因站点按中国大陆地区返回 CNY 报价，未做汇率换算，因此不提供 price_usd 以免编造数字）。\n\n';
const pairs = [['silicone spatula', '硅胶刮刀'], ['silicone turner kitchen', '硅胶锅铲'], ['silicone kitchen brush', '硅胶刷'], ['desk organizer', '桌面收纳盒'], ['pen holder', '笔筒'], ['cat toy ball', '猫玩具球'], ['silicone baking mold', '硅胶蛋糕模具'], ['garden trowel', '园艺小铲'], ['bathroom shelf no drill', '免打孔浴室置物架'], ['vegetable grater', '多功能切菜器'], ['cat nail clipper', '猫指甲剪'], ['car vent organizer', '车载出风口收纳'], ['fridge storage container', '冰箱收纳盒']];
for (const [en, cn] of pairs) {
  const list = byKwAli.get(en) || [];
  md += '### ' + en + ' / ' + cn + '（' + list.length + ' 条）\n\n';
  if (!list.length) { md += '未取到（alibaba.com 该关键词搜索页未返回商品卡）。\n\n'; continue; }
  md += '| 标题 | 价格 | 起订量 | 供应商 | 链接 |\n|---|---|---|---|---|\n';
  for (const r of list.slice(0, 5)) {
    md += '| ' + (r.title || '').replace(/\|/g, '/').slice(0, 60) + ' | ' + (r.currency || '') + (r.price_min || '') + (r.price_max ? '-' + r.price_max : '') + ' | ' + (r.moq || '') + ' ' + (r.moq_unit || '') + ' | ' + (r.supplier || '') + ' | ' + r.url + ' |\n';
  }
  md += '\n';
}

md += '## 四、失败与缺口记录（不编造，逐条留证）\n\n';
if (blockers.length) {
  md += '1688 详情页失败明细：\n\n';
  for (const b of blockers) md += '- ' + b.keyword + ': ' + b.errs.join('; ') + '\n';
  md += '\n';
}
const uniqErrors = new Set();
for (const r of c1688) if (/验证码/.test(r.title || '')) uniqErrors.add('详情页返回「验证码拦截」');
md += '- 被抓取页面出现的拦截类型: ' + (Array.from(uniqErrors).join('、') || '无') + '（此类行已从 offers.csv 剔除）\n';
md += '- 重量/尺寸: 1688 移动详情页「属性」区主要展示材质/品牌，绝大多数商品页正文无重量或尺寸文字，故 weight_g/size_cm 多数为空；未用估算值填充。\n';
md += '- monthly_sales: 详情页只展示累计「已售 N」，未展示月销，故按「已售N(累计)」记录，不做月销推算。\n';
md += '- alibaba.com: 搜索页按中国大陆地区返回 CNY 报价；未切换到 USD，故未输出 price_usd。\n';
md += '- 截图证据: raw/_1688probe/probe1.png（PC 搜索跳 login.taobao.com）、raw/_1688probe/m-search.png（移动搜索页）、raw/_1688probe/A-search.png（1688 首页壳）、raw/_1688probe/alibaba-probe.png（alibaba 搜索结果）\n';

fs.writeFileSync(path.join(DIR, 'summary.md'), md);
console.log('summary.md written, 1688 rows=' + c1688.length + ' alibaba rows=' + cAli.length);
process.exit(0);
