const fs=require('fs');
const spec=JSON.parse(fs.readFileSync('spec/ozon-seller-openapi.json','utf8'));
const names=[
 'v1AnalyticsProductQueriesRequest','v1AnalyticsProductQueriesDetailsRequest',
 'v1AnalyticsTurnoverStocksRequest','v1AnalyticsStocksRequest',
 'v1SearchQueriesTopRequest','v1SearchQueriesTextRequest',
 'analytics.v1.AnalyticsLocalSaleTotalRequest','analytics.v1.AnalyticsDecommissionedGoodsRequest',
 'analytics.v1.AnalyticsCategoryComparisonRequest'
];
function resolve(s,depth){
  if(!s)return s;
  if(s.$ref){const n=s.$ref.split('/').pop();
    if(spec.components.schemas[n]) return {name:n, ...resolve(spec.components.schemas[n],depth+1)};
    if(spec.components.schemas[n]&&spec.components.schemas[n].allOf) return resolve(spec.components.schemas[n].allOf[0],depth+1);
    return {ref:n};
  }
  if(s.allOf) return s.allOf.map(x=>resolve(x,depth+1));
  if(depth>3) return s;
  const o={type:s.type};
  if(s.properties) o.props=Object.fromEntries(Object.entries(s.properties).map(([k,v])=>[k,{type:v.type,format:v.format,example:v.example,enum:v.enum,items:v.items&&(v.items.$ref? v.items.$ref.split('/').pop(): {type:v.items.type,enum:v.items.enum}),description:(v.description||'').slice(0,120)}]));
  if(s.required)o.required=s.required;
  return o;
}
for(const n of names){
  const s=spec.components.schemas[n];
  console.log('=== '+n);
  console.log(JSON.stringify(resolve(s,0),null,1).slice(0,2500));
}
