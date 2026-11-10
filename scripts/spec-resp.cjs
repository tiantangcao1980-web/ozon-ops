const fs=require('fs');
const spec=JSON.parse(fs.readFileSync('spec/ozon-seller-openapi.json','utf8'));
const p=spec.paths['/v1/analytics/product-queries'].post;
const ref=p.responses['200'].content['application/json'].schema;
console.log('RESP REF', JSON.stringify(ref));
function deref(o){ if(!o) return o; if(o.$ref) return spec.components.schemas[o.$ref.split('/').pop()]; return o; }
const top=deref(ref);
console.log('TOP PROPS', Object.keys(top.properties||{}));
const data=deref(top.properties&&top.properties.data);
if(data&&data.properties) console.log('DATA PROPS', Object.entries(data.properties).map(([k,v])=>k+':'+(v.type||JSON.stringify(v).slice(0,80))));
const items=data&&data.properties&&data.properties.items&&deref(data.properties.items.items);
if(items&&items.properties) for(const [k,v] of Object.entries(items.properties)) console.log('  item.'+k, JSON.stringify(v).slice(0,160));
