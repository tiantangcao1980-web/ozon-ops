const fs=require('fs');
const spec=JSON.parse(fs.readFileSync('spec/ozon-seller-openapi.json','utf8'));
function deref(o){ if(!o) return o; if(o.$ref) return spec.components.schemas[o.$ref.split('/').pop()]; return o; }
const top=deref(spec.paths['/v1/analytics/product-queries'].post.responses['200'].content['application/json'].schema);
const items=deref(top.properties.items);
console.log('ITEMS TYPE', items.type, 'items ref', JSON.stringify(items.items));
const it=deref(items.items);
console.log('ITEM PROPS:');
for(const [k,v] of Object.entries(it.properties||{})) console.log(' ',k,JSON.stringify({type:v.type,fmt:v.format,enum:v.enum}).slice(0,120));
const qitems=deref((it.properties.queries||{}).items);
if(qitems&&qitems.properties){ console.log('QUERY PROPS:'); for(const [k,v] of Object.entries(qitems.properties)) console.log('   ',k,JSON.stringify({type:v.type,fmt:v.format}).slice(0,100)); }
