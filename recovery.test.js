const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createPayments } = require('./payments');
const { revision } = require('./recovery');
async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'abilitymade-recovery-synthetic-'));
  const meta = { store: 'abilitymade', schema_version: '2', environment: 'staging', catalog_revision: revision, language: 'en', abilitymade_reference: 'a'.repeat(64) };
  const s = { id: 'cs_test_synthetic', mode: 'payment', status: 'complete', currency: 'usd', livemode: false,
    payment_status: 'paid', payment_intent: 'pi_synthetic', metadata: meta, amount_subtotal: 7500, amount_total: 8200,
    total_details: { amount_shipping: 700, amount_tax: 0, amount_discount: 0 },
    customer_details: { email: 'synthetic@example.invalid' },
    collected_information: { shipping_details: { name: 'Synthetic fixture', address: { line1: 'Fixture', city: 'Fixture', state: 'CA', postal_code: '00000', country: 'US' } } } };
  const p = { id: 'pi_synthetic', status: 'succeeded', currency: 'usd', livemode: false, amount: 8200, amount_received: 8200, metadata: { ...meta } };
  const rows = [{ id: 'li_synthetic', description: 'Historical name', currency: 'usd', quantity: 1, amount_subtotal: 7500, price: { unit_amount: 7500, currency: 'usd', product: { id: 'prod_synthetic', name: 'Historical name', metadata: { ...meta, abilitymade_product_id: 'frame-clutch-black-vine' } } } }];
  const state = { s, p, rows, refunds: [], disputes: [], calls: 0, failure: false, paginated: false };
  const env = { STRIPE_SECRET_KEY: 'sk_test_synthetic', STRIPE_WEBHOOK_SECRET: 'whsec_synthetic', PAYMENT_ENVIRONMENT: 'staging', ORDER_DATA_DIR: dir };
  const fetchImpl = async (url, options) => {
    state.calls++; assert.equal(options.method, 'GET');
    if (state.failure) throw new Error('DO_NOT_LEAK_PRIVATE_PROVIDER_DATA');
    const u = new URL(url); let body;
    if (u.pathname.endsWith('/line_items')) body = state.paginated && !u.searchParams.has('starting_after') ? { data: rows.slice(0,1), has_more: true } : { data: state.paginated ? rows.slice(1) : rows, has_more: false };
    else if (u.pathname.includes('/checkout/sessions/')) body = s;
    else if (u.pathname.includes('/payment_intents/')) body = p;
    else if (u.pathname.endsWith('/refunds')) body = { data: state.refunds, has_more: false };
    else if (u.pathname.endsWith('/disputes')) body = { data: state.disputes, has_more: false };
    else throw new Error('Unexpected fixture route');
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { state, dir, env, payments: createPayments({ env, fetchImpl }), fetchImpl };
}
test('rebuilds in empty directory using historical prices; dry-run does not write; repeated recovery preserves ledger', async () => {
  const { payments, dir } = await fixture();
  const dry = await payments.recover('cs_test_synthetic');
  assert.equal(dry.items[0].unitAmount, 7500); // Current catalog charges 8000.
  assert.equal(dry.requiresHumanReview, true);
  assert.equal('fulfillmentStatus' in dry, false);
  assert.deepEqual(await fs.readdir(dir), []);
  await fs.writeFile(path.join(dir, 'operational-ledger.json'), '{"shipped":true,"settled":true}');
  await Promise.all([payments.recover('cs_test_synthetic',{write:true}), payments.recover('cs_test_synthetic',{write:true})]);
  const name = (await fs.readdir(dir)).find(n=>n.startsWith('order-'));
  const before = await fs.readFile(path.join(dir,name));
  await payments.recover('cs_test_synthetic',{write:true});
  assert.deepEqual(await fs.readFile(path.join(dir,name)),before);
  assert.equal((await fs.readdir(dir)).filter(n=>n.startsWith('order-')).length,1);
  assert.equal(await fs.readFile(path.join(dir,'operational-ledger.json'),'utf8'),'{"shipped":true,"settled":true}');
  assert.equal((await fs.stat(path.join(dir,name))).mode & 0o777, 0o600);
});
test('existing order including operational history cannot be overwritten', async()=>{
  const { payments, dir }=await fixture();
  const file=path.join(dir,'order-'+crypto.createHash('sha256').update('cs_test_synthetic').digest('hex')+'.json');
  const old='{"fulfillmentStatus":"shipped","settlement":"paid"}'; await fs.writeFile(file,old);
  await payments.recover('cs_test_synthetic',{write:true}); assert.equal(await fs.readFile(file,'utf8'),old);
});
test('complete line item pagination is required and summed', async()=>{
  const {state,payments}=await fixture(); state.paginated=true;
  const second=structuredClone(state.rows[0]);second.id='li_second';second.price.product.metadata.abilitymade_product_id='second';
  state.rows.push(second);state.s.amount_subtotal=15000;state.s.amount_total=15700;state.p.amount=state.p.amount_received=15700;
  assert.equal((await payments.recover(state.s.id)).items.length,2);
});
test('unpaid sessions never produce paid records',async()=>{
  const {state,payments,dir}=await fixture(); state.s.payment_status='unpaid';
  assert.deepEqual(await payments.status(state.s.id),{status:'pending'});
  await assert.rejects(payments.recover(state.s.id,{write:true}),{message:'payment_not_paid'});assert.deepEqual(await fs.readdir(dir),[]);
});
test('missing product metadata allows payment verification but prevents unsafe reconstruction',async()=>{
  const {state,payments}=await fixture();delete state.rows[0].price.product.metadata.abilitymade_product_id;
  assert.deepEqual(await payments.status(state.s.id),{status:'paid'});
  await assert.rejects(payments.recover(state.s.id),{message:'ambiguous_product_mapping'});
});
test('wrong environment, invalid amounts, missing shipping, duplicate mappings and unknown schema are rejected',async()=>{
  for(const mutate of [x=>x.s.metadata.environment='production',x=>x.s.metadata.schema_version='99',x=>x.p.amount_received=1,
    x=>delete x.s.collected_information,x=>x.rows.push(structuredClone(x.rows[0])),x=>x.s.total_details.amount_discount=1]){
    const {state,payments,dir}=await fixture();mutate(state);await assert.rejects(payments.recover(state.s.id,{write:true}));assert.deepEqual(await fs.readdir(dir),[]);
  }
});
test('refunds and disputes are reconciled without issuing mutations',async()=>{
  for(const [amount,refundStatus,dispute,status] of [[8200,'succeeded',null,'refunded'],[100,'succeeded',null,'partially_refunded'],[100,'pending',null,'refund_pending'],[100,'failed',null,'paid'],[0,null,'needs_response','disputed'],[0,null,'won','paid']]){
    const {state,payments}=await fixture();
    if(refundStatus)state.refunds=[{id:'re_fixture',payment_intent:state.p.id,currency:'usd',amount,status:refundStatus}];
    if(dispute)state.disputes=[{id:'dp_fixture',payment_intent:state.p.id,status:dispute}];
    assert.deepEqual(await payments.status(state.s.id),{status});
    assert.equal((await payments.recover(state.s.id)).financialStatusAtRecovery,status);
  }
});
test('provider failures are sanitized, cached and do not write',async()=>{
  const {state,payments,dir}=await fixture();state.failure=true;
  for(let i=0;i<3;i++)await assert.rejects(payments.status(state.s.id),{status:503,message:'verification_unavailable'});
  assert.equal(state.calls,1);assert.deepEqual(await fs.readdir(dir),[]);
});
test('status after complete local loss is private, coalesced and globally bounded',async()=>{
  const {state,payments,dir}=await fixture();
  const results=await Promise.all(Array.from({length:10},()=>payments.status(state.s.id)));
  assert.ok(results.every(r=>JSON.stringify(r)==='{"status":"paid"}'));assert.equal(state.calls,4);assert.deepEqual(await fs.readdir(dir),[]);
  for(let i=0;i<29;i++)await assert.rejects(payments.status('cs_test_other'+i));
  await assert.rejects(payments.status('cs_test_limit'),{status:429});
});
test('both allowlisted legacy sandbox purchases recover using reviewed product IDs only',async()=>{
  const ids=['cs_test_a1s24XUaABDvjlWQzqnELXvCoD6dHZpNJG9PyGXzGscsO5VQ4JERBGy8Fz','cs_test_b1dPlAUxnaob24PGv880auaoTO0xzejPnpVaAfOkzMvC2z8wV5eXC1Z4MB'];
  for(let i=0;i<2;i++){
    const {state,payments}=await fixture();state.s.id=ids[i];state.s.metadata={store:'abilitymade',abilitymade_reference:'b'.repeat(64)};state.s.locale=i?'zh':'en';state.p.metadata={};
    Object.assign(state.rows[0].price.product,{id:'prod_VSxdv8ogHE9u2I',name:'Black Floral Frame Clutch',metadata:{}});state.rows[0].description='Black Floral Frame Clutch';state.rows[0].price.unit_amount=8000;state.rows[0].amount_subtotal=8000;
    if(i){const row=structuredClone(state.rows[0]);row.id='li_bunny';row.description='Blue Bunny Frame Clutch';row.quantity=2;row.price.unit_amount=2000;row.amount_subtotal=4000;row.price.product={id:'prod_VSxiEq4Q95OvrZ',name:'Blue Bunny Frame Clutch',metadata:{}};state.rows.push(row);}
    state.s.amount_subtotal=i?12000:8000;state.s.total_details.amount_shipping=i?0:700;state.s.amount_total=i?12000:8700;state.p.amount=state.p.amount_received=state.s.amount_total;
    const result=await payments.recover(state.s.id);assert.equal(result.amountTotal,i?12000:8700);assert.equal(result.language,i?'zh-CN':'en');
    state.rows[0].price.product.id='prod_unreviewed';await assert.rejects(payments.recover(state.s.id),{message:'ambiguous_product_mapping'});
  }
});
test('v2 signed webhooks reconstruct with no checkout snapshot and remain idempotent',async()=>{
  const {state,payments,env,dir}=await fixture();const raw=Buffer.from(JSON.stringify({type:'checkout.session.completed',data:{object:state.s}}));
  const t=Math.floor(Date.now()/1000),sig='t='+t+',v1='+crypto.createHmac('sha256',env.STRIPE_WEBHOOK_SECRET).update(t+'.').update(raw).digest('hex');
  await payments.webhook(raw,sig);await payments.webhook(raw,sig);
  assert.equal((await fs.readdir(dir)).filter(n=>n.startsWith('order-')).length,1);
});
test('administrator command requires private empty target and writes only with explicit flag', async()=>{
  const { main }=require('./scripts/recover-orders.cjs');
  const {env,fetchImpl,state,dir}=await fixture();const report=[];
  const args=['--environment','staging','--target',await fs.realpath(dir),'--session',state.s.id];
  const options={env,fetchImpl,report:s=>report.push(JSON.parse(s))};
  await main(args,options);assert.deepEqual(await fs.readdir(dir),[]);assert.equal(report[0].mode,'dry-run');
  await main([...args,'--write-reviewed'],options);assert.equal(report[1].complete,true);
  assert.equal((await fs.readdir(dir)).filter(n=>n.startsWith('order-')).length,1);
  await assert.rejects(main(args,options),{message:'unsafe_target'});
  assert.ok(!JSON.stringify(report).includes('synthetic@example.invalid'));
});
test('administrator rejects wrong environment and unsafe permissions before provider access',async()=>{
  const {main}=require('./scripts/recover-orders.cjs');const {env,fetchImpl,state,dir}=await fixture();
  const args=['--environment','production','--target',await fs.realpath(dir),'--session',state.s.id];
  await assert.rejects(main(args,{env,fetchImpl}),{message:'environment_mismatch'});assert.equal(state.calls,0);
  args[1]='staging';await fs.chmod(dir,0o755);
  await assert.rejects(main(args,{env,fetchImpl}),{message:'unsafe_target'});assert.equal(state.calls,0);
});
test('forged v2 webhook never contacts provider or writes',async()=>{
  const {payments,state,dir}=await fixture();const raw=Buffer.from(JSON.stringify({type:'checkout.session.completed',data:{object:state.s}}));
  await assert.rejects(payments.webhook(raw,'t=1,v1=bad'),{status:400});assert.equal(state.calls,0);assert.deepEqual(await fs.readdir(dir),[]);
});
test('truncated pagination and storage failure never report reconstruction success',async()=>{
  const f=await fixture();
  const payments=createPayments({env:f.env,fetchImpl:async(url,options)=>url.includes('/line_items')?new Response(JSON.stringify({data:[],has_more:true})):f.fetchImpl(url,options)});
  await assert.rejects(payments.recover(f.state.s.id),{message:'incomplete_provider_data'});
  const file=path.join(f.dir,'not-a-directory');await fs.writeFile(file,'fixture');f.env.ORDER_DATA_DIR=file;
  await assert.rejects(f.payments.recover(f.state.s.id,{write:true}));
});
test('discovery after total local loss paginates and separates ambiguous metadata without customer output', async()=>{
  const {createRecovery}=require('./recovery');
  const f=await fixture(); const legacy='cs_test_a1s24XUaABDvjlWQzqnELXvCoD6dHZpNJG9PyGXzGscsO5VQ4JERBGy8Fz';
  const entries=[f.state.s,{...f.state.s,id:legacy,metadata:{}}, {...f.state.s,id:'cs_test_unknown',metadata:{}},
    {...f.state.s,id:'cs_test_other',metadata:{store:'other'}}, {...f.state.s,id:'cs_test_unpaid',payment_status:'unpaid'},
    {...f.state.s,id:'cs_test_production',metadata:{store:'abilitymade',environment:'production'}}];
  let calls=0;
  const fetchImpl=async(url,options)=>{
    calls++;assert.equal(options.method,'GET');const u=new URL(url);
    assert.equal(u.pathname,'/v1/checkout/sessions');assert.equal(u.searchParams.get('created[gte]'),'0');assert.equal(u.searchParams.get('created[lt]'),'100');
    return new Response(JSON.stringify(u.searchParams.has('starting_after')?{data:entries.slice(1),has_more:false}:{data:entries.slice(0,1),has_more:true}));
  };
  const r=createRecovery({env:f.env,fetchImpl});const result=await r.discover({from:0,to:100});
  assert.equal(calls,2);assert.deepEqual(result.sessionIds,[legacy,f.state.s.id].sort());assert.deepEqual(result.reviewSessionIds,['cs_test_unknown']);
  assert.equal(result.scanComplete,true);assert.ok(!JSON.stringify(result).includes('synthetic@example.invalid'));assert.deepEqual(await fs.readdir(f.dir),[]);
  const {main}=require('./scripts/recover-orders.cjs');let output;
  await main(['--environment','staging','--discover','--from','0','--to','100'],{env:f.env,fetchImpl,report:s=>output=JSON.parse(s)});
  assert.deepEqual(output.sessionIds,result.sessionIds);
  await assert.rejects(main(['--environment','staging','--discover','--write-reviewed'],{env:f.env,fetchImpl}));
  await assert.rejects(r.discover({from:100,to:100}));
});
test('discovery fails closed on truncated pagination and provider failure',async()=>{
  const {createRecovery}=require('./recovery');const f=await fixture();
  for(const fetchImpl of [async()=>new Response(JSON.stringify({data:[],has_more:true})),async()=>{throw new Error('private');}]){
    const r=createRecovery({env:f.env,fetchImpl});await assert.rejects(r.discover({from:0,to:100}));
  }
});
test('public verification budget exhaustion cannot starve signed webhook reconstruction',async()=>{
  const f=await fixture();
  // Four requests per paid verification; exhaust the public 120-request budget.
  const fetchImpl=async(url,options)=>{
    if(url.includes('/checkout/sessions/')&&!url.includes('/line_items')){
      const s={...f.state.s,id:new URL(url).pathname.split('/').at(-1)};
      return new Response(JSON.stringify(s));
    }
    return f.fetchImpl(url,options);
  };
  const p=createPayments({env:f.env,fetchImpl});
  for(let i=0;i<30;i++)assert.deepEqual(await p.status('cs_test_budget'+i),{status:'paid'});
  await assert.rejects(p.status('cs_test_extra'),{status:429});
  assert.equal((await p.recover(f.state.s.id,{write:true})).status,'paid');
});
