const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('./checkout.js'), 'utf8');
const cartKey = 'abilitymade-cart-v1', handoffKey = 'abilitymade-checkout-request-v1', attemptKey = 'abilitymade-payment-attempt-v2';
const items = [{ id: 'fixture', quantity: 1, title: 'Fixture', price: '$80' }];
const fingerprint = JSON.stringify([{ id: 'fixture', quantity: 1 }]);
function setup({ search = '', status = 'paid', storage = new Map(), error = false, confirm = false } = {}) {
  const nodes = new Map(), calls = [], timers = [], redirects = [];
  const node = key => { if (!nodes.has(key)) nodes.set(key, { value: ({'#shipping-country':'US','#shipping-state':'CA','#shipping-name':'Synthetic','#shipping-line1':'123 Test Street','#shipping-line2':'','#shipping-city':'Test City','#shipping-postal_code':'90001'})[key] || '', reportValidity: () => true, disabled: true, classList: { add() {} }, append() {}, addEventListener(_, fn) { this.click = fn; } }); return nodes.get(key); };
  const localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) };
  vm.runInNewContext(source, {
    window: { confirm: () => confirm }, URL, URLSearchParams, Date, localStorage, TextEncoder, Uint8Array, crypto: { subtle: require('node:crypto').webcrypto.subtle, randomUUID: () => '00000000-0000-4000-8000-000000000000' },
    navigator: { locks: { request: async (_, fn) => fn() } },
    location: { search, assign: url => redirects.push(url) }, setTimeout: fn => timers.push(fn),
    document: { documentElement: {}, querySelector: node, querySelectorAll: selector => selector === '.checkout-nav-links a' ? [node('link1'),node('link2')] : ['eyebrow', 'order', 'edit', 'subtotal', 'caption', 'payment', 'secure', 'delivery', 'help'].map(key => Object.assign(node('copy-' + key), { dataset: { checkoutCopy: key } })), createElement: () => ({ setAttribute() {}, append() {} }) },
    fetch: async (url, options) => { calls.push({url,options}); if(error) throw Error('offline'); return { ok: true, json: async () => url.includes('checkout-status') ? { status } : { sessionId: 'cs_test_fixture', url: 'https://checkout.stripe.com/c/pay/fixture' } }; },
  });
  return {storage,nodes,calls,timers,redirects};
}
const settle = () => new Promise(resolve => setImmediate(resolve));
function saved() { return new Map([[cartKey, JSON.stringify(items)], [handoffKey, JSON.stringify({items})], [attemptKey, JSON.stringify({ fingerprint, sessionId:'cs_test_fixture', created:Date.now(),requestId:'existing',language:'en' })]]); }
test('verified paid return clears matching cart and handoff; refresh is idempotent',async()=>{
 const storage=saved(); setup({storage,search:'?session_id=cs_test_fixture'});await settle();
 assert.equal(storage.get(cartKey),'[]');assert.equal(storage.has(handoffKey),false);
 assert.equal(JSON.parse(storage.get(attemptKey)).paid,true);
 setup({storage,search:'?session_id=cs_test_fixture'});await settle();assert.equal(storage.get(cartKey),'[]');
});
test('paid return preserves changed carts and unrelated session carts',async()=>{
 for(const changed of [true,false]) {const storage=saved();if(changed)storage.set(cartKey,JSON.stringify([{id:'new',quantity:2}]));const before=storage.get(cartKey);
 setup({storage,search:'?session_id='+ (changed?'cs_test_fixture':'cs_test_other')});await settle();assert.equal(storage.get(cartKey),before);}
});
test('pending authentication, refund, dispute and provider failure never clear cart or offer repayment',async()=>{
 for(const status of ['pending','refunded','partially_refunded','disputed']) {
 const storage=saved(),before=storage.get(cartKey);const ui=setup({storage,status,search:'?session_id=cs_test_fixture'});await settle();
 assert.equal(storage.get(cartKey),before);assert.equal(ui.nodes.get('#pay-button').hidden,true);
 }
 const storage=saved();setup({storage,error:true,search:'?session_id=cs_test_fixture'});await settle();assert.notEqual(storage.get(cartKey),'[]');
});
test('double clicks and cross-language retries reuse the same attempt; cancellation retains items',async()=>{
 const storage=saved(),ui=setup({storage,search:'?cancelled=1'});const button=ui.nodes.get('#pay-button');
 await Promise.all([button.click(),button.click()]);assert.equal(ui.calls.length,1);
 const zh=setup({storage,search:'?language=zh-CN&cancelled=1'});await zh.nodes.get('#pay-button').click();
 const a=JSON.parse(ui.calls[0].options.body),b=JSON.parse(zh.calls[0].options.body);assert.deepEqual(a,b);
 assert.equal(a.requestId,'existing');assert.equal(storage.get(cartKey),JSON.stringify(items));
});
test('stale paid checkout tabs and old uncertain attempts cannot create another session',async()=>{
 for(const paid of [true,false]) {const storage=saved();const attempt=JSON.parse(storage.get(attemptKey));attempt.paid=paid;attempt.created=0;storage.set(attemptKey,JSON.stringify(attempt));
 const ui=setup({storage});await ui.nodes.get('#pay-button').click();assert.equal(ui.calls.length,0);}
});

test('refreshing old success does not remove deliberately re-added items; repeat order needs confirmation',async()=>{
 const storage=saved();setup({storage,search:'?session_id=cs_test_fixture'});await settle();
 storage.set(cartKey,JSON.stringify(items));storage.set(handoffKey,JSON.stringify({items}));
 setup({storage,search:'?session_id=cs_test_fixture'});await settle();assert.equal(storage.get(cartKey),JSON.stringify(items));
 const ui=setup({storage,confirm:true});await ui.nodes.get('#pay-button').click();assert.equal(ui.calls.length,1);
 assert.notEqual(JSON.parse(ui.calls[0].options.body).requestId,'existing');
});

test('invalid delivery form never contacts provider; address edits require confirmation and do not store raw address',async()=>{
 const storage=saved(),ui=setup({storage});
 ui.nodes.get('#shipping-form').reportValidity=()=>false;
 await ui.nodes.get('#pay-button').click();assert.equal(ui.calls.length,0);
 ui.nodes.get('#shipping-form').reportValidity=()=>true;
 await ui.nodes.get('#pay-button').click();assert.equal(ui.calls.length,1);
 const request=JSON.parse(ui.calls[0].options.body);
 assert.equal(request.shippingDetails.address.country,'US');
 assert.equal(storage.get(attemptKey).includes('123 Test Street'),false);
 ui.nodes.get('#shipping-line1').value='456 Changed Street';
 await ui.nodes.get('#pay-button').click();assert.equal(ui.calls.length,1);
});
