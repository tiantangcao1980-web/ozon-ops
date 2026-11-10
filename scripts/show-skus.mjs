import fs from 'node:fs';
const d=JSON.parse(fs.readFileSync('raw/sku-detail/skus.json','utf8'));
for(const r of d){
  const rev=(r.reviews||'').match(/"(?:count|reviewsCount|total)\D{0,6}(\d+)/i);
  const seller=(r.seller||'').match(/"(?:name|title|sellerName)"\s*:\s*"([^"]{2,40})"/);
  const sold=(JSON.stringify(r).match(/(?:Куплено|продан|заказов)[^"]{0,25}/i)||[])[0]||'';
  console.log([r.tag, r.sku, (r.price||'')+'₽', 'rev='+(rev?rev[1]:'?'), 'seller='+(seller?seller[1]:'?'), 'pairs='+r.pairsTotal, 'sold='+sold].join(' | '));
}