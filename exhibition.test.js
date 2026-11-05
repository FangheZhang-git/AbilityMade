const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { getCatalog, publicCatalog, qrUrl, labelSvg, handleExhibition } = require('./exhibition');
const { createPayments, validateCart } = require('./payments');
const cart = require('./exhibition-cart');
const products = getCatalog();
const body = () => ({items:[{id:products[0].id, quantity:1}], language:'en', shippingDetails:{name:'Synthetic',address:{line1:'123 Test Street',city:'Test City',state:'CA',postal_code:'90001',country:'US'}}, requestId:crypto.randomUUID()});
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'abilitymade-exhibition-'));
  const env = {STRIPE_SECRET_KEY:'sk_test_mock',STRIPE_WEBHOOK_SECRET:'whsec_mock',ORDER_DATA_DIR:directory,PUBLIC_SITE_URL:'https://abilitymade.net',SHIPPING_FLAT_RATE_CENTS:'1000',STRIPE_AUTOMATIC_TAX:'false'};
  const calls = [];
  const payments = createPayments({env,fetchImpl:async (url,options) => {
    calls.push(new URLSearchParams(options.body));
    return new Response(JSON.stringify({id:'cs_test_fixture',url:'https://checkout.stripe.com/c/test'}));
  }});
  return {directory,env,calls,payments};
}
function route(url, method = 'GET') {
  const result = {headers:{}};
  const res = {setHeader:(k,v) => result.headers[k]=v,writeHead:(status,headers) => {result.status=status;Object.assign(result.headers,headers);},end:body => result.body=body};
  return handleExhibition({method},res,new URL(url,'https://abilitymade.net')).then(() => result);
}
test('catalog publishes all stable IDs and bilingual display fields', () => {
  const entries=publicCatalog();assert.equal(entries.length,products.length);
  assert.ok(entries.every(p => p.name && p.nameZh && p.image && p.available));
  assert.equal(qrUrl(products[0].id), `https://abilitymade.net/exhibition/add/${products[0].id}`);
  assert.throws(() => qrUrl('../bad'));
  assert.equal(qrUrl({...products[0],name:'New name',unitAmount:9999}.id),qrUrl(products[0].id));
});
test('real QR SVG, 1200px PNG, escaped labels, and all-product print sheet', async () => {
  const svg=await route(`/exhibition/qr/${products[0].id}.svg`);
  assert.equal(svg.status,200);assert.match(svg.body,/<path/);
  const png=await route(`/exhibition/qr/${products[0].id}.png`);
  assert.equal(png.body.readUInt32BE(16),1200);
  const label=await labelSvg({...products[0],name:'<unsafe & name>'});
  assert.match(label,/&lt;unsafe &amp; name&gt;/);assert.match(label,/Scan to Add to Cart/);
  const print=await route('/exhibition/labels');assert.equal((print.body.match(/<article>/g)||[]).length,products.length);
  assert.equal((await route('/exhibition/add/missing')).status,404);
  assert.equal((await route('/api/exhibition/catalog','POST')).status,405);
});
test('each deliberate scan has a fresh receipt and redirects to isolated cart', async () => {
  const url=`/exhibition/add/${products[0].id}?language=zh-CN`;
  const first=await route(url);const second=await route(url);
  assert.equal(first.status,303);assert.equal(first.headers['Cache-Control'],'no-store');
  assert.notEqual(first.headers.Location,second.headers.Location);assert.match(first.headers.Location,/language=zh-CN/);
});
test('scan persistence is atomic and repeat receipt does not increment; fresh scan preserves edited price', () => {
  const p=publicCatalog()[0], q=publicCatalog()[1];
  const storage=new Map([['abilitymade-cart-v1','online untouched']]);
  storage.getItem=storage.get.bind(storage);storage.setItem=storage.set.bind(storage);
  let state=cart.load(storage), receipt=crypto.randomUUID();
  assert.equal(cart.scan(state,p,receipt),true);
  state.items[0].unitAmount+=100;
  storage.setItem(cart.KEY,JSON.stringify(state));state=cart.load(storage);
  assert.equal(cart.scan(state,p,receipt),false);
  cart.scan(state,p,crypto.randomUUID());cart.scan(state,q,crypto.randomUUID());
  assert.equal(state.items[0].quantity,2);assert.equal(state.items[0].unitAmount,p.unitAmount+100);
  assert.equal(state.items.length,2);assert.equal(storage.get('abilitymade-cart-v1'),'online untouched');
  assert.throws(() => cart.scan(state,{...p,available:false},crypto.randomUUID()));
  assert.throws(() => cart.scan(state,p,'bad'));
  assert.equal(cart.cents('12.01'),1201);
  for(const value of ['1.001','-1','1e3','NaN','']) assert.throws(() => cart.cents(value));
});
test('server validates selected prices, minimums, integer cents, quantities and totals', async () => {
  const {payments,calls}=await fixture(); const b=body();
  for(const amount of [products[0].unitAmount-1,0,-1,1.5,'9000',null,100000000]) {
    assert.throws(() => validateCart({...b,items:[{...b.items[0],unitAmount:amount}]}),{status:400});
  }
  b.items[0].unitAmount=products[0].unitAmount+123;
  await payments.createSession(b);assert.equal(calls[0].get('line_items[0][price_data][unit_amount]'),String(b.items[0].unitAmount));
  await assert.rejects(payments.createSession({...b,items:[{...b.items[0],quantity:99,unitAmount:99999999}]}),{status:400});
});
test('on-site sessions have zero delivery cost, pickup acknowledgement and payment metadata in both languages', async () => {
  for(const language of ['en','zh-CN']) {
    const {payments,calls}=await fixture();
    const b={...body(),language,fulfillment_type:'onsite',shippingDetails:undefined,pickupConfirmed:true};
    await payments.createSession(b);const params=calls[0];
    assert.ok(![...params.keys()].some(k => k.startsWith('shipping_')));
    assert.equal(params.get('metadata[fulfillment_type]'),'onsite');
    assert.equal(params.get('payment_intent_data[metadata][fulfillment_type]'),'onsite');
    assert.match(params.get('success_url'),/exhibition.html/);
    assert.equal(params.get('automatic_tax[enabled]'),'false');
    assert.ok(params.get('custom_text[submit][message]'));
  }
});
test('fulfillment spoofing never gives online delivery free shipping; threshold unchanged', async () => {
  const {payments,calls}=await fixture();const b=body();
  for(const fulfillment_type of ['',null,'free','delivery',1]) {
    await assert.rejects(payments.createSession({...b,fulfillment_type}),{status:400});
  }
  await assert.rejects(payments.createSession({...b,fulfillment_type:'onsite'}),{status:400});
  await assert.rejects(payments.createSession({...b,fulfillment_type:'onsite',shippingDetails:undefined,pickupConfirmed:true,shippingAddress:{country:'US'}}),{status:400});
  await payments.createSession({...b,shipping:0,mode:'onsite',qr:true});
  assert.equal(calls[0].get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'),'1000');
  assert.equal(calls[0].get('metadata[fulfillment_type]'),'online');
  assert.equal(calls[0].get('payment_intent_data[shipping][address][country]'),'US');
  await payments.createSession({...b,items:[{...b.items[0],unitAmount:12000}]});
  assert.equal(calls[1].get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'),'0');
});
test('tax pause disables automatic and manual rates in both modes despite legacy or client settings', async () => {
  for (const setting of ['true', 'false', undefined, '']) {
    for (const language of ['en', 'zh-CN']) {
      for (const fulfillment_type of ['online', 'onsite']) {
        const {payments,env,calls}=await fixture();env.STRIPE_AUTOMATIC_TAX=setting;
        const product=products.find(p=>p.unitAmount<12000);
        const unitAmount=product.unitAmount+1;
        await payments.createSession({...body(),language,fulfillment_type,shippingDetails:fulfillment_type==='onsite'?undefined:body().shippingDetails,pickupConfirmed:true,
          automatic_tax:{enabled:true},tax_rates:['txr_untrusted'],
          items:[{id:product.id,quantity:1,unitAmount,tax_rates:['txr_untrusted'],dynamic_tax_rates:['txr_untrusted']}]});
        const params=calls[0];
        assert.equal(params.get('automatic_tax[enabled]'),'false');
        assert.ok(![...params.keys()].some(k=>/tax_rates|tax_rate_data/.test(k)));
        assert.equal(params.get('line_items[0][price_data][unit_amount]'),String(unitAmount));
        assert.equal(params.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'),fulfillment_type==='online'?'1000':null);
      }
    }
  }
});
test('central pause can be lifted; historical taxed orders still verify after it resumes', async t => {
  const config=require('./checkout-config');
  t.after(()=>{config.taxCollectionPaused=true;});
  const {payments,env,calls,directory}=await fixture();env.STRIPE_AUTOMATIC_TAX='true';
  config.taxCollectionPaused=false;
  const b=body();
  await payments.createSession(b);assert.equal(calls[0].get('automatic_tax[enabled]'),'true');
  await assert.rejects(payments.createSession({...b,fulfillment_type:'onsite',shippingDetails:undefined,pickupConfirmed:true}),{status:503,message:'onsite_tax_configuration_required'});
  config.taxCollectionPaused=true;
  await payments.createSession(b);
  assert.equal(calls[1].get('automatic_tax[enabled]'),'false');
  assert.notEqual(calls[0].get('metadata[abilitymade_reference]'),calls[1].get('metadata[abilitymade_reference]'));
  const event={type:'checkout.session.completed',livemode:false,data:{object:{id:'cs_test_historicaltax',payment_status:'paid',mode:'payment',currency:'usd',livemode:false,
    metadata:{store:'abilitymade',abilitymade_reference:calls[0].get('metadata[abilitymade_reference]')},
    amount_subtotal:products[0].unitAmount,amount_total:products[0].unitAmount+1000+123,
    total_details:{amount_shipping:1000,amount_discount:0,amount_tax:123}}}};
  const raw=Buffer.from(JSON.stringify(event)),timestamp=Math.floor(Date.now()/1000);
  await payments.webhook(raw,`t=${timestamp},v1=${crypto.createHmac('sha256',env.STRIPE_WEBHOOK_SECRET).update(timestamp+'.').update(raw).digest('hex')}`);
  const orderFile=(await fs.readdir(directory)).find(n=>n.startsWith('order-'));
  assert.equal(JSON.parse(await fs.readFile(path.join(directory,orderFile))).tax,123);
});
test('only verified paid onsite webhook grants collection; duplicate events create one immutable order', async () => {
  const {payments,env,calls,directory}=await fixture();const b={...body(),fulfillment_type:'onsite',shippingDetails:undefined,pickupConfirmed:true};
  await payments.createSession(b);
  const reference=calls[0].get('metadata[abilitymade_reference]');
  const snapshot=JSON.parse(await fs.readFile(path.join(directory,`checkout-${reference}.json`)));
  assert.equal(snapshot.shipping,0);assert.equal(snapshot.fulfillment_type,'onsite');
  const event={id:'evt_test',type:'checkout.session.completed',livemode:false,data:{object:{id:'cs_test_onsite',payment_status:'unpaid',mode:'payment',currency:'usd',livemode:false,metadata:{store:'abilitymade',abilitymade_reference:reference},amount_subtotal:products[0].unitAmount,amount_total:products[0].unitAmount,total_details:{amount_shipping:0,amount_discount:0,amount_tax:0}}}};
  const deliver=() => {const raw=Buffer.from(JSON.stringify(event));const t=Math.floor(Date.now()/1000);return payments.webhook(raw,`t=${t},v1=${crypto.createHmac('sha256',env.STRIPE_WEBHOOK_SECRET).update(t+'.').update(raw).digest('hex')}`);};
  await deliver();assert.equal((await fs.readdir(directory)).filter(n=>n.startsWith('order-')).length,0);
  event.data.object.payment_status='paid';event.data.object.total_details.amount_shipping=800;
  await assert.rejects(deliver(),{status:400});event.data.object.total_details.amount_shipping=0;
  await Promise.all([deliver(),deliver(),deliver()]);
  // Public status is independently verified with Stripe (covered in recovery.test.js).
  const records=(await fs.readdir(directory)).filter(n => n.startsWith('order-'));assert.equal(records.length,1);
  const order=JSON.parse(await fs.readFile(path.join(directory,records[0])));
  assert.equal(order.fulfillmentStatus,'ready_for_collection');assert.equal(order.shippingDetails,undefined);
});
test('generated PNG decodes to the permanent product URL', async () => {
  const jsQR=require('jsqr');const {PNG}=require('pngjs');
  const result=await route(`/exhibition/qr/${products[0].id}.png`);
  const png=PNG.sync.read(result.body);
  const decoded=jsQR(new Uint8ClampedArray(png.data),png.width,png.height);
  assert.equal(decoded.data,qrUrl(products[0].id));
});
test('catalog additions and disablements are picked up without hardcoded QR lists', async t => {
  const syncfs=require('node:fs');const original=syncfs.readFileSync;
  const added={id:'future-stable-product',name:'Future product',unitAmount:500};
  t.mock.method(syncfs,'readFileSync',function(filename,...args) {
    if(String(filename)===path.join(__dirname,'data/products.json')) return JSON.stringify([...products.map((p,i)=>i? p:{...p,active:false}),added]);
    return original.call(this,filename,...args);
  });
  assert.equal((await route('/exhibition/qr/future-stable-product.svg')).status,200);
  assert.equal((await route(`/exhibition/add/${products[0].id}`)).status,404);
  assert.equal(publicCatalog().at(-1).id,added.id);
  assert.throws(()=>validateCart(body()),{status:400});
  assert.equal(validateCart({...body(),items:[{id:added.id,quantity:1}]})[0].unitAmount,500);
});
