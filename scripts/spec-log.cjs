const fs=require('fs');
const spec=JSON.parse(fs.readFileSync('spec/ozon-seller-openapi.json','utf8'));
for(const p of ['/v1/seller/ozon-logistics/info','/v1/delivery/check','/v2/delivery/checkout']){
  const item=spec.paths[p]; if(!item){console.log(p,'MISSING');continue;}
  const op=item.post||item.get;
  console.log('===',p, op.summary);
  const rb=op.requestBody&&op.requestBody.content&&op.requestBody.content['application/json'];
  console.log('  body:', JSON.stringify(rb&&rb.schema).slice(0,300));
  const resp=op.responses['200']&&op.responses['200'].content&&op.responses['200'].content['application/json'];
  console.log('  resp:', JSON.stringify(resp&&resp.schema).slice(0,300));
}
