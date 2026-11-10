const fs=require('fs');
const spec=JSON.parse(fs.readFileSync('spec/ozon-seller-openapi.json','utf8'));
const want=[
 '/v1/analytics/product-queries',
 '/v1/analytics/product-queries/details',
 '/v1/analytics/decommissioned-goods',
 '/v1/analytics/turnover/stocks',
 '/v1/analytics/stocks',
 '/v1/analytics/local-sale/total',
 '/v1/search-queries/top',
 '/v1/search-queries/text',
 '/v1/analytics/category/comparison'
];
const out={};
for(const p of want){
  const item=spec.paths[p];
  if(!item){out[p]='MISSING';continue;}
  const op=item.post||item.get;
  const bodyRef=op.requestBody&&op.requestBody.content&&op.requestBody.content['application/json']&&op.requestBody.content['application/json'].schema;
  out[p]={summary:op.summary||op.operationId, params:(op.parameters||[]).map(x=>x.name+':'+(x.schema&&x.schema.type)), body:bodyRef, responses:Object.keys(op.responses||{})};
}
console.log(JSON.stringify(out,null,1));
