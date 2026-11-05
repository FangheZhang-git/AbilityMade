// Stripe's HTTP API keeps this small server dependency-free.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { getCatalog } = require('./exhibition');
const MAX_AMOUNT = 99999999;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });

function configuration(env) {
  const origin = new URL(env.PUBLIC_SITE_URL || 'http://localhost:3000');
  const live = /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY || '');
  const directory = env.ORDER_DATA_DIR && path.resolve(env.ORDER_DATA_DIR);
  const mount = env.RAILWAY_VOLUME_MOUNT_PATH && path.resolve(env.RAILWAY_VOLUME_MOUNT_PATH);
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET || !directory ||
      directory === __dirname || directory.startsWith(__dirname + path.sep) ||
      (env.RAILWAY_ENVIRONMENT_ID && (!mount || (directory !== mount && !directory.startsWith(mount + path.sep)))) ||
      !/^\d+$/.test(env.SHIPPING_FLAT_RATE_CENTS || '') ||
      !['true', 'false'].includes(env.STRIPE_AUTOMATIC_TAX) ||
      (live && (env.STRIPE_LIVE_ENABLED !== 'true' || origin.protocol !== 'https:')) ||
      (!live && origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname))) {
    throw fail(503, 'checkout_unavailable');
  }
  const shipping = Number(env.SHIPPING_FLAT_RATE_CENTS);
  if (!Number.isSafeInteger(shipping) || shipping > 100000) throw fail(503, 'checkout_unavailable');
  return { origin: origin.origin, directory, shipping, live, tax: env.STRIPE_AUTOMATIC_TAX === 'true' };
}

function validateCart(body) {
  if (!body || !Array.isArray(body.items) || !body.items.length || body.items.length > 50 ||
      !/^[0-9a-f-]{36}$/i.test(body.requestId || '') || !['en', 'zh-CN'].includes(body.language)) {
    throw fail(400, 'invalid_cart');
  }
  const catalog = new Map(getCatalog().map(p => [p.id, p]));
  const seen = new Set();
  return body.items.map(item => {
    const product = catalog.get(item?.id);
    if (!product || product.active === false || product.available === false || seen.has(item.id) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
      throw fail(400, 'invalid_cart');
    }
    seen.add(item.id);
    const amount = item.unitAmount === undefined ? product.unitAmount : item.unitAmount;
    if (!Number.isSafeInteger(amount) || amount < product.unitAmount || amount > MAX_AMOUNT ||
        (product.maxUnitAmount !== undefined && amount > product.maxUnitAmount)) throw fail(400, 'invalid_price');
    return { ...product, minimumUnitAmount: product.unitAmount, unitAmount: amount, quantity: item.quantity };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

// Publish complete immutable records atomically, including during concurrent retries.
async function saveOnce(directory, name, record) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.tmp-${crypto.randomUUID()}`);
  const target = path.join(directory, name + '.json');
  const file = await fs.open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(record, null, 2));
    await file.sync();
  } finally { await file.close(); }
  try {
    await fs.link(temporary, target);
    const dir = await fs.open(directory, 'r');
    try { await dir.sync(); } finally { await dir.close(); }
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally { await fs.unlink(temporary); }
  return JSON.parse(await fs.readFile(target, 'utf8'));
}

function verifyEvent(raw, signature, secret, now = Date.now()) {
  const parts = String(signature || '').split(',').map(p => p.trim().split('='));
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  if (!/^\d+$/.test(timestamp || '') || Math.abs(now / 1000 - Number(timestamp)) > 300) throw fail(400, 'invalid_signature');
  const expected = crypto.createHmac('sha256', secret).update(timestamp + '.').update(raw).digest();
  const valid = parts.some(([key, value]) => key === 'v1' && /^[a-f0-9]{64}$/i.test(value || '') &&
    crypto.timingSafeEqual(expected, Buffer.from(value, 'hex')));
  if (!valid) throw fail(400, 'invalid_signature');
  try { return JSON.parse(raw.toString('utf8')); } catch { throw fail(400, 'invalid_event'); }
}

function createPayments({ env = process.env, fetchImpl = (...args) => fetch(...args) } = {}) {
  async function createSession(body) {
    const config = configuration(env);
    const fulfillment = body?.fulfillment_type === undefined ? 'online' : body.fulfillment_type;
    if (!['online', 'onsite'].includes(fulfillment)) throw fail(400, 'invalid_fulfillment');
    if (fulfillment === 'onsite' && (body.pickupConfirmed !== true || body.shippingAddress || body.shipping_details)) {
      throw fail(400, 'physical_collection_required');
    }
    // Automatic tax currently sources the customer's address, not an exhibition's location.
    // Do not silently charge the wrong venue tax or claim a tax exemption.
    if (fulfillment === 'onsite' && config.tax) throw fail(503, 'onsite_tax_configuration_required');
    const items = validateCart(body);
    const subtotal = items.reduce((sum, p) => sum + p.unitAmount * p.quantity, 0);
    if (!Number.isSafeInteger(subtotal) || subtotal > MAX_AMOUNT) throw fail(400, 'invalid_total');
    const shipping = fulfillment === 'onsite' || subtotal >= 12000 ? 0 : config.shipping;
    const snapshot = { items, subtotal, shipping, fulfillment_type: fulfillment, language: body.language, live: config.live };
    const page = fulfillment === 'onsite' ? 'exhibition.html' : 'checkout.html';
    const reference = hash(JSON.stringify({ ...snapshot, requestId: body.requestId, tax: config.tax }));
    await saveOnce(config.directory, 'checkout-' + reference, snapshot);
    const params = new URLSearchParams({
      mode: 'payment', locale: body.language === 'zh-CN' ? 'zh' : 'en',
      success_url: `${config.origin}/${page}?language=${body.language}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.origin}/${page}?language=${body.language}&cancelled=1`,
      'metadata[abilitymade_reference]': reference,
      'metadata[store]': 'abilitymade',
      'shipping_address_collection[allowed_countries][0]': 'US',
      'automatic_tax[enabled]': String(config.tax),
      'shipping_options[0][shipping_rate_data][type]': 'fixed_amount',
      'shipping_options[0][shipping_rate_data][fixed_amount][amount]': String(shipping),
      'shipping_options[0][shipping_rate_data][fixed_amount][currency]': 'usd',
      'shipping_options[0][shipping_rate_data][display_name]': body.language === 'zh-CN' ? '标准配送' : 'Standard shipping',
    });
    params.set('metadata[fulfillment_type]', fulfillment);
    params.set('payment_intent_data[metadata][fulfillment_type]', fulfillment);
    params.set('payment_intent_data[metadata][abilitymade_reference]', reference);
    if (fulfillment === 'onsite') {
      for (const key of [...params.keys()]) {
        if (key.startsWith('shipping_')) params.delete(key);
      }
      params.set('custom_text[submit][message]', body.language === 'zh-CN'
        ? '仅限展览现场自取，不提供配送。付款确认后方可取走商品。'
        : 'Exhibition collection only. No delivery. Collect items only after payment is confirmed.');
    }
    items.forEach((p, i) => {
      params.set(`line_items[${i}][price_data][currency]`, 'usd');
      params.set(`line_items[${i}][price_data][unit_amount]`, String(p.unitAmount));
      params.set(`line_items[${i}][price_data][product_data][name]`, p.name);
      params.set(`line_items[${i}][price_data][tax_behavior]`, 'exclusive');
      params.set(`line_items[${i}][quantity]`, String(p.quantity));
    });
    const response = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST', headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': reference,
        'Stripe-Version': '2025-06-30.basil' }, body: params.toString(), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw fail(502, 'payment_provider_unavailable');
    const session = await response.json();
    if (!session.url || new URL(session.url).origin !== 'https://checkout.stripe.com') throw fail(502, 'payment_provider_unavailable');
    return { url: session.url };
  }

  async function webhook(raw, signature) {
    // Webhooks keep working even if new checkout sessions have been disabled.
    if (!env.STRIPE_WEBHOOK_SECRET || !env.ORDER_DATA_DIR) throw fail(503, 'checkout_unavailable');
    const event = verifyEvent(raw, signature, env.STRIPE_WEBHOOK_SECRET);
    if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) return;
    const session = event.data?.object;
    if (session?.metadata?.store !== 'abilitymade') return;
    if (session.payment_status !== 'paid') return;
    const reference = session.metadata.abilitymade_reference;
    if (!/^[a-f0-9]{64}$/.test(reference || '') || !/^cs_(test_|live_)?[a-zA-Z0-9]+$/.test(session.id || '')) throw fail(400, 'invalid_event');
    const directory = path.resolve(env.ORDER_DATA_DIR);
    const snapshot = JSON.parse(await fs.readFile(path.join(directory, `checkout-${reference}.json`), 'utf8'));
    if (session.mode !== 'payment' || session.currency !== 'usd' || session.livemode !== snapshot.live ||
        event.livemode !== snapshot.live || session.amount_subtotal !== snapshot.subtotal ||
        session.total_details?.amount_shipping !== snapshot.shipping ||
        session.total_details?.amount_discount !== 0 ||
        !Number.isSafeInteger(session.total_details?.amount_tax) || session.total_details.amount_tax < 0 ||
        session.amount_total !== snapshot.subtotal + snapshot.shipping + session.total_details.amount_tax) {
      throw fail(400, 'order_mismatch');
    }
    await saveOnce(directory, 'order-' + hash(session.id), {
      ...snapshot, status: 'paid', fulfillment_type: snapshot.fulfillment_type || 'online',
      fulfillmentStatus: snapshot.fulfillment_type === 'onsite' ? 'ready_for_collection' : 'awaiting_manual_review',
      sessionId: session.id, paymentIntent: session.payment_intent, eventId: event.id,
      recordedAt: new Date().toISOString(), amountTotal: session.amount_total,
      tax: session.total_details.amount_tax, customer: session.customer_details,
      shippingDetails: snapshot.fulfillment_type === 'onsite' ? undefined : session.collected_information?.shipping_details || session.shipping_details,
    });
  }

  async function status(sessionId) {
    if (!/^cs_(test_|live_)?[a-zA-Z0-9]+$/.test(sessionId || '')) throw fail(400, 'invalid_session');
    if (!env.ORDER_DATA_DIR) throw fail(503, 'checkout_unavailable');
    try {
      const order = JSON.parse(await fs.readFile(path.join(env.ORDER_DATA_DIR, 'order-' + hash(sessionId) + '.json'), 'utf8'));
      return { status: order.status, fulfillment_type: order.fulfillment_type || 'online' };
    } catch (error) {
      if (error.code === 'ENOENT') return { status: 'pending' };
      throw error;
    }
  }
  return { createSession, webhook, status };
}
module.exports = { createPayments, validateCart, verifyEvent, saveOnce };
