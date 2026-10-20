// Stripe payment recovery. Never writes operational ledgers or initiates payments.
const crypto = require('node:crypto');
const revision = crypto.createHash('sha256').update(JSON.stringify(require('./data/products.json'))).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
const sessionPattern = /^cs_(?:test_|live_)?[a-zA-Z0-9]+$/;
const legacy = new Set([
  'cs_test_a1s24XUaABDvjlWQzqnELXvCoD6dHZpNJG9PyGXzGscsO5VQ4JERBGy8Fz',
  'cs_test_b1dPlAUxnaob24PGv880auaoTO0xzejPnpVaAfOkzMvC2z8wV5eXC1Z4MB',
]);
// Product IDs, names and historical prices privately reviewed in Stripe Dashboard.
const legacyProducts = {
  prod_VSxdv8ogHE9u2I: { id: 'frame-clutch-black-vine', name: 'Black Floral Frame Clutch', unitAmount: 8000 },
  prod_VSxiEq4Q95OvrZ: { id: 'frame-clutch-blue-bunny', name: 'Blue Bunny Frame Clutch', unitAmount: 2000 },
};
function createRecovery({ env, fetchImpl }) {
  const environment = () => env.PAYMENT_ENVIRONMENT || env.RAILWAY_ENVIRONMENT_NAME || 'local';
  let requestWindow = 0, requestCount = 0;
  async function get(route) {
    const now = Date.now();
    if (now - requestWindow >= 60000) { requestWindow = now; requestCount = 0; }
    if (++requestCount > 120) throw fail(429, 'verification_rate_limited');
    if (!/^(sk|rk)_(test|live)_/.test(env.STRIPE_SECRET_KEY || '')) throw fail(503, 'verification_unavailable');
    try {
      const r = await fetchImpl('https://api.stripe.com/v1/' + route, { method: 'GET',
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Stripe-Version': '2025-06-30.basil' },
        signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error();
      return await r.json();
    } catch { throw fail(503, 'verification_unavailable'); }
  }
  async function list(route) {
    const result = []; let after = '';
    for (let page = 0; page < 20; page++) {
      const r = await get(route + (route.includes('?') ? '&' : '?') + 'limit=100' + (after ? '&starting_after=' + encodeURIComponent(after) : ''));
      if (!Array.isArray(r.data) || typeof r.has_more !== 'boolean') throw fail(503, 'incomplete_provider_data');
      result.push(...r.data);
      if (!r.has_more) return result;
      const next = r.data.at(-1)?.id;
      if (!next || next === after) break;
      after = next;
    }
    throw fail(503, 'incomplete_provider_data');
  }
  // Explicit fixed half-open date window permits repeatable scans after total disk loss.
  // No event-retention dependency and no local snapshots or Session IDs required.
  async function discover({ from, to }) {
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from || to > Math.floor(Date.now() / 1000)) throw fail(400, 'invalid_discovery_window');
    const rows = await list(`checkout/sessions?created[gte]=${from}&created[lt]=${to}&status=complete`);
    const live = /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY || '');
    const candidates = new Set(), review = new Set();
    for (const s of rows) {
      if (!sessionPattern.test(s.id || '') || s.livemode !== live) throw fail(409, 'incomplete_provider_data');
      if (s.mode !== 'payment' || s.payment_status !== 'paid') continue;
      const old = !live && environment() === 'staging' && legacy.has(s.id);
      if (old || (s.metadata?.store === 'abilitymade' && s.metadata?.environment === environment())) candidates.add(s.id);
      else if (!s.metadata?.store || (s.metadata.store === 'abilitymade' && !s.metadata.environment)) review.add(s.id);
    }
    return { from, to, scanned: rows.length, sessionIds: [...candidates].sort(), reviewSessionIds: [...review].sort(), scanComplete: true };
  }
  async function verify(id) {
    if (!sessionPattern.test(id || '')) throw fail(400, 'invalid_session');
    const s = await get('checkout/sessions/' + encodeURIComponent(id));
    const live = /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY);
    const isLegacy = !live && environment() === 'staging' && legacy.has(id);
    if (s.id !== id || s.mode !== 'payment' || s.currency !== 'usd' || s.livemode !== live ||
        s.metadata?.store !== 'abilitymade' || !/^[a-f0-9]{64}$/.test(s.metadata?.abilitymade_reference || '') ||
        (!isLegacy && (s.metadata?.schema_version !== '2' || s.metadata?.environment !== environment()))) throw fail(409, 'unrecognized_payment');
    if (s.payment_status === 'unpaid') return { status: 'pending', session: s };
    if (s.payment_status !== 'paid' || s.status !== 'complete' || !/^pi_[a-zA-Z0-9]+$/.test(s.payment_intent || '')) throw fail(409, 'incomplete_payment');
    const p = await get('payment_intents/' + s.payment_intent);
    if (p.id !== s.payment_intent || p.status !== 'succeeded' || p.currency !== 'usd' || p.livemode !== live ||
        !Number.isSafeInteger(s.amount_total) || s.amount_total <= 0 || p.amount !== s.amount_total || p.amount_received !== s.amount_total ||
        (!isLegacy && (p.metadata?.abilitymade_reference !== s.metadata.abilitymade_reference || p.metadata?.store !== 'abilitymade'))) throw fail(409, 'payment_mismatch');
    const refunds = await list('refunds?payment_intent=' + p.id);
    const disputes = await list('disputes?payment_intent=' + p.id);
    if (refunds.some(r => r.payment_intent !== p.id || r.currency !== 'usd' || !Number.isSafeInteger(r.amount) || r.amount < 0) ||
        disputes.some(d => d.payment_intent !== p.id)) throw fail(409, 'payment_mismatch');
    const refunded = refunds.filter(r => r.status === 'succeeded').reduce((n, r) => n + r.amount, 0);
    if (refunded > s.amount_total) throw fail(409, 'payment_mismatch');
    const refundPending = refunds.some(r => !['succeeded', 'failed', 'canceled'].includes(r.status));
    const disputeReview = disputes.some(d => !['won', 'warning_closed'].includes(d.status));
    const status = disputeReview ? 'disputed' : refundPending ? 'refund_pending' : refunded === s.amount_total ? 'refunded' : refunded ? 'partially_refunded' : 'paid';
    return { status, session: s, isLegacy, refunded, disputes: disputes.map(d => ({ id: d.id, status: d.status })) };
  }
  async function reconstruct(id) {
    const v = await verify(id), s = v.session;
    if (v.status === 'pending') throw fail(409, 'payment_not_paid');
    const rows = await list('checkout/sessions/' + id + '/line_items?expand[]=data.price.product');
    if (!rows.length || rows.length > 50) throw fail(409, 'incomplete_order');
    const items = rows.map(row => {
      const price = row.price, product = price?.product;
      const historical = v.isLegacy && legacyProducts[product?.id];
      const m = product?.metadata;
      const productId = historical?.id || m?.abilitymade_product_id;
      const name = row.description; // Stripe line-item description preserves the purchased label.
      if (!product || !productId || !/^[a-z0-9-]+$/.test(productId) || typeof name !== 'string' || !name.trim() ||
          !Number.isSafeInteger(price.unit_amount) || price.unit_amount < 0 || price.currency !== 'usd' ||
          !Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 99 || row.currency !== 'usd' ||
          row.amount_subtotal !== price.unit_amount * row.quantity ||
          (v.isLegacy ? (!historical || name !== historical.name || price.unit_amount !== historical.unitAmount) :
            (m.schema_version !== '2' || m.environment !== environment() || m.catalog_revision !== s.metadata.catalog_revision || m.abilitymade_reference !== s.metadata.abilitymade_reference))) throw fail(409, 'ambiguous_product_mapping');
      return { id: productId, name, unitAmount: price.unit_amount, quantity: row.quantity };
    }).sort((a,b) => a.id.localeCompare(b.id));
    if (v.isLegacy) {
      const expected = id === [...legacy][0] ? [['frame-clutch-black-vine', 1, 8000]] : [['frame-clutch-black-vine', 1, 8000], ['frame-clutch-blue-bunny', 2, 2000]];
      if (JSON.stringify(items.map(p => [p.id, p.quantity, p.unitAmount])) !== JSON.stringify(expected) || s.amount_total !== (expected.length === 1 ? 8700 : 12000)) throw fail(409, 'legacy_order_mismatch');
    }
    const subtotal = items.reduce((n,p) => n + p.unitAmount * p.quantity, 0), t = s.total_details;
    const shipping = s.collected_information?.shipping_details || s.shipping_details;
    const language = v.isLegacy ? ({ en: 'en', zh: 'zh-CN' })[s.locale] : s.metadata.language;
    if (new Set(items.map(p=>p.id)).size !== items.length || s.amount_subtotal !== subtotal ||
        !t || !Number.isSafeInteger(t.amount_shipping) || t.amount_shipping < 0 || !Number.isSafeInteger(t.amount_tax) || t.amount_tax < 0 ||
        t.amount_discount !== 0 || s.amount_total !== subtotal + t.amount_shipping + t.amount_tax ||
        !['en','zh-CN'].includes(language) || !s.customer_details?.email || !shipping?.name ||
        !['US', 'PR', 'GU'].includes(shipping.address?.country) ||
        !['line1','city','postal_code'].every(k=>typeof shipping.address[k] === 'string' && shipping.address[k].trim()) ||
        (shipping.address.state != null && typeof shipping.address.state !== 'string') ||
        (shipping.address.country === 'US' && !shipping.address.state?.trim()) ||
        ['AS','MP','VI','UM','AMERICAN SAMOA','NORTHERN MARIANA ISLANDS','US VIRGIN ISLANDS','U.S. VIRGIN ISLANDS','UNITED STATES MINOR OUTLYING ISLANDS'].includes(shipping.address.state?.trim().toUpperCase()) ||
        (!v.isLegacy && !/^[a-f0-9]{64}$/.test(s.metadata.catalog_revision || ''))) throw fail(409, 'incomplete_order');
    return { schemaVersion: 2, items, subtotal, shipping: t.amount_shipping, language, live: s.livemode,
      status: 'paid', financialStatusAtRecovery: v.status, refundedAtRecovery: v.refunded,
      disputesAtRecovery: v.disputes, sessionId: s.id, paymentIntent: s.payment_intent,
      reference: s.metadata.abilitymade_reference, amountTotal: s.amount_total, tax: t.amount_tax,
      customer: s.customer_details, shippingDetails: shipping,
      catalogRevision: v.isLegacy ? 'legacy-29f1e5f' : s.metadata.catalog_revision,
      recoveredAt: new Date().toISOString(), source: 'stripe_recovery', requiresHumanReview: true };
  }
  return { verify, reconstruct, environment, discover };
}
module.exports = { createRecovery, revision, sessionPattern };
