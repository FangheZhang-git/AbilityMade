const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createPayments, verifyEvent } = require('./payments');
const products = require('./data/products.json');
const sign = (raw, secret, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(t + '.').update(raw).digest('hex')}`;
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'abilitymade-payments-'));
  const env = { STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
    ORDER_DATA_DIR: directory, PUBLIC_SITE_URL: 'https://example.com', SHIPPING_FLAT_RATE_CENTS: '1000', STRIPE_AUTOMATIC_TAX: 'false' };
  const calls = [];
  const payments = createPayments({ env, fetchImpl: async (url, options) => {
    calls.push({ url, options, params: new URLSearchParams(options.body) });
    return new Response(JSON.stringify({ id: 'cs_test_fixture', url: 'https://checkout.stripe.com/c/pay/cs_test_fixture' }), { status: 200 });
  } });
  const body = { items: [{ id: products[0].id, quantity: 1, price: 1 }], language: 'en', requestId: crypto.randomUUID() };
  return { env, calls, payments, body, directory };
}
test('charges catalog prices, collects US shipping, and uses stable retry keys', async () => {
  const { payments, body, calls } = await fixture();
  await payments.createSession(body); await payments.createSession(body);
  const params = calls[0].params;
  assert.equal(params.get('metadata[schema_version]'), '2');
  assert.equal(params.get('line_items[0][price_data][product_data][metadata][abilitymade_product_id]'), products[0].id);
  assert.equal(params.get('payment_intent_data[metadata][abilitymade_reference]'), params.get('metadata[abilitymade_reference]'));
  assert.match(params.get('metadata[catalog_revision]'), /^[a-f0-9]{64}$/);
  assert.equal(params.get('line_items[0][price_data][unit_amount]'), String(products[0].unitAmount));
  assert.equal(params.get('shipping_address_collection[allowed_countries][0]'), 'US');
  assert.equal(params.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'), '1000');
  assert.equal(calls[0].options.headers['Idempotency-Key'], calls[1].options.headers['Idempotency-Key']);
  body.items[0].quantity = 2;
  await payments.createSession(body);
  assert.equal(calls[2].params.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'), '0');
  assert.notEqual(calls[0].options.headers['Idempotency-Key'], calls[2].options.headers['Idempotency-Key']);
});
test('rejects unknown products, duplicate rows, invalid quantities and missing configuration', async () => {
  const { payments, body, env, calls } = await fixture();
  for (const items of [[], [{ id: 'unknown', quantity: 1 }], [body.items[0], body.items[0]],
    ...[0, -1, 100, 1.5, '2', null].map(quantity => [{ id: products[0].id, quantity }])]) {
    await assert.rejects(payments.createSession({ ...body, items }), { status: 400 });
  }
  assert.equal(calls.length, 0);
  env.SHIPPING_FLAT_RATE_CENTS = '';
  await assert.rejects(payments.createSession(body), { status: 503 });
});
test('live payments require explicit activation and HTTPS', async () => {
  const { payments, body, env } = await fixture();
  env.STRIPE_SECRET_KEY = 'sk_live_fixture';
  await assert.rejects(payments.createSession(body), { status: 503 });
  env.STRIPE_LIVE_ENABLED = 'true'; env.PUBLIC_SITE_URL = 'http://example.com';
  await assert.rejects(payments.createSession(body), { status: 503 });
});
test('signature verification rejects tampering, stale events and malformed signatures', () => {
  const raw = Buffer.from('{"id":"evt_fixture"}'); const secret = 'whsec_fixture';
  assert.equal(verifyEvent(raw, sign(raw, secret), secret).id, 'evt_fixture');
  for (const signature of ['', 't=bad,v1=bad', sign(raw, 'wrong'), sign(raw, secret, 1)]) {
    assert.throws(() => verifyEvent(raw, signature, secret), { status: 400 });
  }
  assert.throws(() => verifyEvent(Buffer.from('{}'), sign(raw, secret), secret), { status: 400 });
});
test('only paid verified events create durable orders; concurrent duplicates and restarts are idempotent', async () => {
  const { payments, body, env, calls, directory } = await fixture();
  await payments.createSession(body);
  const event = { id: 'evt_fixture', type: 'checkout.session.completed', livemode: false, data: { object: {
    id: 'cs_test_fixture', mode: 'payment', currency: 'usd', livemode: false, payment_status: 'unpaid',
    metadata: { store: 'abilitymade', abilitymade_reference: calls[0].params.get('metadata[abilitymade_reference]') },
    amount_subtotal: products[0].unitAmount, amount_total: products[0].unitAmount + 1000,
    total_details: { amount_shipping: 1000, amount_discount: 0, amount_tax: 0 },
    customer_details: { email: 'customer@example.com' },
    collected_information: { shipping_details: { name: 'Test customer', address: { country: 'US' } } },
  } } };
  const deliver = (instance = payments) => {
    const raw = Buffer.from(JSON.stringify(event)); return instance.webhook(raw, sign(raw, env.STRIPE_WEBHOOK_SECRET));
  };
  await deliver();
  assert.equal((await fs.readdir(directory)).filter(n => n.startsWith('order-')).length, 0);
  event.data.object.payment_status = 'paid'; event.data.object.amount_total = 1;
  await assert.rejects(deliver(), { status: 400 });
  event.data.object.amount_total = products[0].unitAmount + 1000;
  await Promise.all([deliver(), deliver(), deliver()]);
  const restarted = createPayments({ env });
  await deliver(restarted);
  // Legacy webhook snapshot path remains supported; status now verifies Stripe.
  const files = (await fs.readdir(directory)).filter(f => f.startsWith('order-'));
  assert.equal(files.length, 1);
  const order = JSON.parse(await fs.readFile(path.join(directory, files[0]), 'utf8'));
  assert.equal(order.items[0].unitAmount, products[0].unitAmount);
  assert.equal(order.requiresHumanReview, true);
  assert.equal('fulfillmentStatus' in order, false);
  assert.equal(order.shippingDetails.address.country, 'US');
  assert.equal((await fs.stat(path.join(directory, files[0]))).mode & 0o777, 0o600);
});
test('storage errors fail the webhook so Stripe can retry; provider errors never expose credentials', async () => {
  const { env, body } = await fixture();
  const payments = createPayments({ env, fetchImpl: async () => new Response('private provider error', { status: 401 }) });
  await assert.rejects(payments.createSession(body), { status: 502, message: 'payment_provider_unavailable' });
  const event = { type: 'checkout.session.completed', data: { object: { id: 'cs_test_fixture', payment_status: 'paid',
    metadata: { store: 'abilitymade', abilitymade_reference: 'a'.repeat(64) } } } };
  const raw = Buffer.from(JSON.stringify(event));
  await assert.rejects(payments.webhook(raw, sign(raw, env.STRIPE_WEBHOOK_SECRET)), { status: 503 });
});
test('catalog matches both storefronts including existing product additions', async () => {
  for (const filename of ['index.html', 'index-zh.html']) {
    const html = await fs.readFile(path.join(__dirname, filename), 'utf8');
    const cards = [...html.matchAll(/<article class="merchandise-card"[^>]*>([\s\S]*?)<\/article>/g)];
    assert.equal(cards.length, products.length);
    for (const [, card] of cards) {
      const id = path.basename(card.match(/<img src="([^"]+)"/)[1]).replace(/\.[a-z0-9]+$/i, '').toLowerCase();
      const product = products.find(p => p.id === id);
      assert.ok(product, id);
      assert.equal(product.unitAmount, Math.round(Number(card.match(/class="price">\$([\d.]+)/)[1]) * 100));
    }
  }
});

test('Railway checkout requires storage on its mounted volume', async () => {
  const { payments, body, env, directory } = await fixture();
  env.RAILWAY_ENVIRONMENT_ID = 'test-environment';
  await assert.rejects(payments.createSession(body), { status: 503 });
  env.RAILWAY_VOLUME_MOUNT_PATH = '/not-the-order-volume';
  await assert.rejects(payments.createSession(body), { status: 503 });
  env.RAILWAY_VOLUME_MOUNT_PATH = directory;
  assert.ok((await payments.createSession(body)).url);
});

test('approved shipping is one $10 order fee below $120 and free at or above $120 in both languages', async () => {
  for (const language of ['en', 'zh-CN']) {
    const { payments, body, calls } = await fixture();
    for (const [items, expected] of [
      [[{ id: 'frame-clutch-black-vine', quantity: 1 }, { id: 'frame-clutch-black-gold', quantity: 1 }], '1000'], // $110, multiple products
      [[{ id: 'frame-clutch-blue-bunny', quantity: 6 }], '0'], // exactly $120
      [[{ id: 'frame-clutch-black-vine', quantity: 1 }, { id: 'member-drawing-art-block', quantity: 1 }], '0'], // $130
    ]) {
      await payments.createSession({ ...body, language, items, shipping: 1, supplierCount: 9, state: 'AK' });
      const params = calls.at(-1).params;
      assert.equal(params.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'), expected);
      assert.equal(params.has('shipping_options[1][shipping_rate_data][fixed_amount][amount]'), false);
      assert.equal(params.get('shipping_address_collection[allowed_countries][0]'), 'US');
      assert.deepEqual([...params].filter(([k]) => k.startsWith('shipping_address_collection[allowed_countries]')).map(([,v]) => v), ['US', 'PR', 'GU']);
      assert.equal(params.get('locale'), language === 'en' ? 'en' : 'zh');
      assert.equal(params.get('ui_mode'), null); // Stripe-hosted default remains unchanged.
    }
  }
});

test('outdated shipping configuration blocks new checkout without affecting historical recovery', async () => {
  const { payments, body, env, calls } = await fixture();
  for (const rate of ['700', '800', '0', '1001']) {
    env.SHIPPING_FLAT_RATE_CENTS = rate;
    await assert.rejects(payments.createSession(body), {status:503, message:'checkout_unavailable'});
  }
  assert.equal(calls.length, 0);
  env.SHIPPING_FLAT_RATE_CENTS = '1000';
  await payments.createSession(body);
  assert.equal(calls[0].params.get('automatic_tax[enabled]'), 'false');
});
