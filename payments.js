// Stripe's HTTP API keeps this small server dependency-free.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { getCatalog } = require('./exhibition');
const checkoutConfig = require('./checkout-config');
const { validateShipping, shippingHash } = require('./shipping');
const { createRecovery, revision } = require('./recovery');
const { validPrice, MAX_CENTS } = require('./pricing');

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
      (!checkoutConfig.taxCollectionPaused && !['true', 'false'].includes(env.STRIPE_AUTOMATIC_TAX)) ||
      (live && (env.STRIPE_LIVE_ENABLED !== 'true' || origin.protocol !== 'https:')) ||
      (!live && origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname))) {
    throw fail(503, 'checkout_unavailable');
  }
  const shipping = Number(env.SHIPPING_FLAT_RATE_CENTS);
  if (shipping !== 1000) throw fail(503, 'checkout_unavailable');
  return { origin: origin.origin, directory, shipping, live, tax: !checkoutConfig.taxCollectionPaused && env.STRIPE_AUTOMATIC_TAX === 'true' };
}

function validateCart(body) {
  if (!body || !Array.isArray(body.items) || !body.items.length || body.items.length > 50 ||
      !/^[0-9a-f-]{36}$/i.test(body.requestId || '') || !['en', 'zh-CN'].includes(body.language)) {
    throw fail(400, 'invalid_cart');
  }
  if (body.currency !== undefined && body.currency !== 'usd') throw fail(400, 'invalid_currency');
  const catalog = new Map(getCatalog().map(p => [p.id, p]));
  const seen = new Set();
  return body.items.map(item => {
    const product = catalog.get(item?.id);
    if (!product || product.active === false || product.available === false || seen.has(item.id) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
      throw fail(400, 'invalid_cart');
    }
    seen.add(item.id);
    const unitAmount = item.unitAmount === undefined ? product.unitAmount : item.unitAmount;
    if (!validPrice(unitAmount, product.unitAmount) || (product.maxUnitAmount !== undefined && unitAmount > product.maxUnitAmount) || (item.currency !== undefined && item.currency !== 'usd')) {
      throw fail(400, 'invalid_price');
    }
    return { ...product, unitAmount, quantity: item.quantity };
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
  const recovery = createRecovery({ env, fetchImpl });
  // Public traffic must not consume the signed webhook verifier budget.
  const statusRecovery = createRecovery({ env, fetchImpl });
  const statusCache = new Map();
  let windowStart = 0, lookups = 0;
  async function recover(sessionId, { write = false } = {}) {
    const record = await recovery.reconstruct(sessionId);
    if (!write) return record;
    if (!env.ORDER_DATA_DIR) throw fail(503, 'storage_unavailable');
    const directory = path.resolve(env.ORDER_DATA_DIR);
    if (directory === __dirname || directory.startsWith(__dirname + path.sep)) throw fail(503, 'unsafe_storage');
    return saveOnce(path.resolve(env.ORDER_DATA_DIR), 'order-' + hash(sessionId), record);
  }
  async function createSession(body) {
    const config = configuration(env);
    const fulfillment = body?.fulfillment_type === undefined ? 'online' : body.fulfillment_type;
    if (!['online', 'onsite'].includes(fulfillment)) throw fail(400, 'invalid_fulfillment');
    if (fulfillment === 'onsite' && (body.pickupConfirmed !== true || body.shippingDetails || body.shippingAddress || body.shipping_details)) throw fail(400, 'physical_collection_required');
    if (fulfillment === 'onsite' && config.tax) throw fail(503, 'onsite_tax_configuration_required');
    const items = validateCart(body);
    const shippingDetails = fulfillment === 'online' ? validateShipping(body.shippingDetails) : undefined;
    const subtotal = items.reduce((sum, p) => sum + p.unitAmount * p.quantity, 0);
    // One order-wide fee, regardless of supplier count. Approved deployment value: 1000.
    const shipping = fulfillment === 'onsite' || subtotal >= 12000 ? 0 : config.shipping;
    if (subtotal + shipping > MAX_CENTS) throw fail(400, 'amount_too_large');
    const snapshot = { items, subtotal, shipping, fulfillment_type: fulfillment, language: body.language, live: config.live, shippingDetails };
    const reference = hash(JSON.stringify({ ...snapshot, requestId: body.requestId, tax: config.tax, schema: 2, shippingDestinations: 'bound_v1', revision, environment: recovery.environment() }));
    await saveOnce(config.directory, 'checkout-' + reference, snapshot);
    const page = fulfillment === 'onsite' ? 'exhibition.html' : 'checkout.html';
    const params = new URLSearchParams({
      mode: 'payment', locale: body.language === 'zh-CN' ? 'zh' : 'en',
      success_url: `${config.origin}/${page}?language=${body.language}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.origin}/${page}?language=${body.language}&cancelled=1`,
      'metadata[abilitymade_reference]': reference,
      'metadata[store]': 'abilitymade',
      'automatic_tax[enabled]': String(config.tax),
      'shipping_options[0][shipping_rate_data][type]': 'fixed_amount',
      'shipping_options[0][shipping_rate_data][fixed_amount][amount]': String(shipping),
      'shipping_options[0][shipping_rate_data][fixed_amount][currency]': 'usd',
      'shipping_options[0][shipping_rate_data][display_name]': body.language === 'zh-CN' ? '标准配送' : 'Standard shipping',
    });
    const metadata = { store: 'abilitymade', abilitymade_reference: reference, schema_version: '2', catalog_revision: revision, environment: recovery.environment(), language: body.language, fulfillment_type: fulfillment, shipping_mode: fulfillment === 'onsite' ? 'onsite_v1' : 'bound_v1', ...(shippingDetails ? { shipping_hash: shippingHash(shippingDetails) } : {}) };
    for (const [key, value] of Object.entries(metadata)) {
      params.set(`metadata[${key}]`, value);
      params.set(`payment_intent_data[metadata][${key}]`, value);
    }
    // Do not collect/edit delivery addresses in hosted Checkout. Billing may differ.
    if (fulfillment === 'online') {
      params.set('payment_intent_data[shipping][name]', shippingDetails.name);
      for (const [key, value] of Object.entries(shippingDetails.address)) {
        if (value) params.set(`payment_intent_data[shipping][address][${key}]`, value);
      }
      params.set('custom_text[submit][message]', body.language === 'zh-CN'
        ? '配送地址已在 AbilityMade 确认。账单地址不会更改配送地址。需修改配送地址请返回商店。'
        : 'Delivery uses the address confirmed on AbilityMade. Billing details do not change it. Return to the store to change delivery.');
    } else {
      for (const key of [...params.keys()]) if (key.startsWith('shipping_')) params.delete(key);
      params.set('custom_text[submit][message]', body.language === 'zh-CN'
        ? '仅限展览现场自取，不提供配送。付款确认后方可取走商品。'
        : 'Exhibition collection only. No delivery. Collect items only after payment is confirmed.');
    }
    // Only server-selected inline prices; never forward manual or dynamic tax rates.
    items.forEach((p, i) => {
      for (const [key, value] of Object.entries({ ...metadata, abilitymade_product_id: p.id })) {
        params.set(`line_items[${i}][price_data][product_data][metadata][${key}]`, value);
      }
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
    if (!/^cs_(test_|live_)?[a-zA-Z0-9]+$/.test(session.id || '') || !session.url || new URL(session.url).origin !== 'https://checkout.stripe.com') throw fail(502, 'payment_provider_unavailable');
    return { url: session.url, sessionId: session.id };
  }

  async function webhook(raw, signature) {
    // Webhooks keep working even if new checkout sessions have been disabled.
    if (!env.STRIPE_WEBHOOK_SECRET || !env.ORDER_DATA_DIR) throw fail(503, 'checkout_unavailable');
    const event = verifyEvent(raw, signature, env.STRIPE_WEBHOOK_SECRET);
    if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) return;
    const session = event.data?.object;
    if (session?.metadata?.store !== 'abilitymade') return;
    if (session.payment_status !== 'paid') return;
    if (session.metadata.schema_version === '2') { await recover(session.id, { write: true }); statusCache.delete(session.id); return; }
    const reference = session.metadata.abilitymade_reference;
    if (!/^[a-f0-9]{64}$/.test(reference || '') || !/^cs_(test_|live_)?[a-zA-Z0-9]+$/.test(session.id || '')) throw fail(400, 'invalid_event');
    const directory = path.resolve(env.ORDER_DATA_DIR);
    let snapshot;
    try { snapshot = JSON.parse(await fs.readFile(path.join(directory, `checkout-${reference}.json`), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await recover(session.id, { write: true }); statusCache.delete(session.id); return; }
    if (session.mode !== 'payment' || session.currency !== 'usd' || session.livemode !== snapshot.live ||
        event.livemode !== snapshot.live || session.amount_subtotal !== snapshot.subtotal ||
        session.total_details?.amount_shipping !== snapshot.shipping ||
        session.total_details?.amount_discount !== 0 ||
        !Number.isSafeInteger(session.total_details?.amount_tax) || session.total_details.amount_tax < 0 ||
        session.amount_total !== snapshot.subtotal + snapshot.shipping + session.total_details.amount_tax) {
      throw fail(400, 'order_mismatch');
    }
    await saveOnce(directory, 'order-' + hash(session.id), {
      ...snapshot, status: 'paid', requiresHumanReview: true,
      ...(snapshot.fulfillment_type === 'onsite' ? { fulfillmentStatus: 'ready_for_collection' } : {}),
      sessionId: session.id, paymentIntent: session.payment_intent, eventId: event.id,
      recordedAt: new Date().toISOString(), amountTotal: session.amount_total,
      tax: session.total_details.amount_tax, customer: session.customer_details,
      shippingDetails: snapshot.fulfillment_type === 'onsite' ? undefined : snapshot.shippingDetails || session.collected_information?.shipping_details || session.shipping_details,
    });
  }

  async function status(sessionId) {
    if (!/^cs_(test_|live_)?[a-zA-Z0-9]+$/.test(sessionId || '')) throw fail(400, 'invalid_session');
    const now = Date.now(), cached = statusCache.get(sessionId);
    if (cached && cached.until > now) return cached.promise;
    if (now - windowStart >= 60000) { windowStart = now; lookups = 0; }
    if (++lookups > 30) throw fail(429, 'rate_limited');
    for (const [key, value] of statusCache) if (value.until <= now) statusCache.delete(key);
    if (statusCache.size >= 200) throw fail(429, 'rate_limited');
    // Share in-flight requests and cache failures. Never return PII or write files here.
    const promise = statusRecovery.verify(sessionId).then(v => ({ status: v.status, ...(v.session.metadata.fulfillment_type ? { fulfillment_type: v.session.metadata.fulfillment_type } : {}) }));
    statusCache.set(sessionId, { until: now + 30000, promise });
    return promise;
  }

  return { createSession, webhook, status, recover };
}
module.exports = { createPayments, validateCart, verifyEvent, saveOnce };
