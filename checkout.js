(() => {
  const query = new URLSearchParams(location.search);
  const zh = query.get('language') === 'zh-CN';
  const language = zh ? 'zh-CN' : 'en';
  const copy = zh ? {
    repeat: '这份购物车已付款。确定要再购买一次并创建一个单独的新订单吗？',
    title: '确认订单', intro: '确认商品后，前往安全支付页面。', button: '前往安全支付',
    note: '仅配送美国 50 州、华盛顿特区、波多黎各及关岛。商品金额未满 $120，每笔订单标准运费为 $10；满 $120 免标准运费。多个供应商的商品也只收取一次运费。商品由供应商直接寄送。适用税费将在付款前显示。',
    empty: '购物车为空，请返回商店添加商品。', loading: '正在打开支付页面…',
    unavailable: '在线支付暂不可用，请稍后再试或通过下方邮箱联系我们。',
    invalid: '购物车需要更新，请返回商店重新选择商品。',
    pending: '正在确认付款，请稍候…', paid: '付款已确认，感谢你的订单！',
    review: '付款记录需要核对（可能涉及退款或争议）。请联系我们，请勿重复付款。',
    unknown: '暂时无法核实付款状态。请稍后刷新或联系我们，请勿重复付款。',
    wait: '付款确认仍在处理中。请稍后刷新此页，或通过下方邮箱联系我们。请勿重复付款。',
    cancelled: '支付已取消，购物车商品仍然保留。', shop: '返回商店', contact: '联系我们',
  } : {
    repeat: 'This cart was already paid for. Do you intentionally want to buy it again as a separate new order?',
    title: 'Review your order', intro: 'Review your items, then continue to secure payment.', button: 'Continue to secure payment',
    note: 'Shipping to all 50 US states, DC, Puerto Rico and Guam only. Standard shipping is $10 per order below $120 in merchandise, and free at $120 or more. One shipping fee covers all suppliers. Suppliers ship directly to you. Applicable tax is shown before payment.',
    empty: 'Your cart is empty. Return to the shop to add items.', loading: 'Opening secure payment…',
    unavailable: 'Online checkout is temporarily unavailable. Please try again later or contact us at the email below.',
    invalid: 'Your cart needs updating. Please return to the shop and select your items again.',
    pending: 'Confirming your payment. Please wait…', paid: 'Payment confirmed. Thank you for your order!',
    review: 'This payment has a refund or dispute requiring review. Please contact us; do not pay again.',
    unknown: 'Payment status is temporarily unavailable. Refresh later or contact us; do not pay again.',
    wait: 'Payment confirmation is still processing. Refresh this page later or contact us at the email below. Please do not pay again.',
    cancelled: 'Checkout was cancelled. Your cart is still here.', shop: 'Back to Shop', contact: 'Contact Us',
  };
  document.documentElement.lang = language;
  document.title = `${zh ? '结账' : 'Checkout'} | AbilityMade`;
  const shop = zh ? 'index-zh.html' : 'index.html';
  document.querySelector('.logo').href = shop;
  const links = document.querySelectorAll('.checkout-nav-links a');
  links[0].href = shop + '#shop'; links[0].textContent = copy.shop;
  links[1].href = shop + '#contact'; links[1].textContent = copy.contact;
  document.querySelector('.delivery-strip').textContent = zh ? '美国 50 州及特区、波多黎各、关岛配送 · 未满 $120 运费 $10 · 满 $120 免标准运费' : 'US (50 states + DC), PR & GU · $10 below $120 · Free standard shipping at $120+';
  document.querySelector('#checkout-title').textContent = copy.title;
  document.querySelector('#checkout-intro').textContent = copy.intro;
  document.querySelector('#checkout-note').textContent = copy.note;
  const button = document.querySelector('#pay-button');
  const status = document.querySelector('#payment-status');
  button.textContent = copy.button;
  const policyLink = document.querySelector('#policy-link');
  policyLink.href = 'customer-policies.html#' + (zh ? 'zh' : 'en');
  policyLink.textContent = zh ? '配送、退款、隐私及顾客支持' : 'Shipping, refunds, privacy & support';
  const shippingForm = document.querySelector('#shipping-form');
  const shippingField = key => document.querySelector('#shipping-' + key);
  const shippingLabels = zh ? { name: '收件人姓名', line1: '街道地址', line2: '公寓 / 房号（选填）', city: '城市', country: '配送地区', state: '州 / 华盛顿特区', postal_code: '邮政编码' }
    : { name: 'Full name', line1: 'Street address', line2: 'Apartment / suite (optional)', city: 'City', country: 'Destination', state: 'State / DC', postal_code: 'ZIP code' };
  for (const [key, label] of Object.entries(shippingLabels)) document.querySelector('#label-' + key).textContent = label;
  document.querySelector('#shipping-title').textContent = zh ? '配送地址' : 'Delivery address';
  document.querySelector('#shipping-lock-note').textContent = zh ? '此地址用于配送。在 Stripe 输入的账单地址不会更改配送地址。' : 'This is your delivery address. Billing details entered at Stripe will not change it.';
  if (zh) {
    for (const [id, text] of Object.entries({'destination-us':'美国（50 州及华盛顿特区）','destination-pr':'波多黎各','destination-gu':'关岛','state-select':'请选择'})) document.querySelector('#' + id).textContent = text;
  }
  const updateDestination = () => {
    const us = shippingField('country').value === 'US';
    shippingField('state').required = us;
    document.querySelector('#state-field').hidden = !us;
  };
  shippingField('country').addEventListener('change', updateDestination);
  shippingForm.addEventListener('submit', event => event.preventDefault());
  updateDestination();
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('abilitymade-checkout-request-v1') || '{}'); } catch {}
  const items = Array.isArray(saved?.items) ? saved.items : [];
  for (const item of items) {
    const row = document.createElement('p');
    row.textContent = `${item.title} × ${item.quantity} — ${item.price}`;
    document.querySelector('#checkout-items').append(row);
  }
  const attemptKey = 'abilitymade-payment-attempt-v2';
  const fingerprint = rows => JSON.stringify(rows.map(({ id, quantity }) => ({ id, quantity })).sort((a, b) => a.id.localeCompare(b.id)));
  const readAttempt = () => JSON.parse(localStorage.getItem(attemptKey) || 'null');
  // Only clear the exact submitted cart after server verification of its bound Session.
  // Preserve edits made while Checkout was open, and retain the attempt for stale tabs.
  const finishCart = id => {
    try {
      const attempt = readAttempt();
      if (!attempt || attempt.sessionId !== id || attempt.paid) return;
      attempt.paid = true;
      localStorage.setItem(attemptKey, JSON.stringify(attempt));
      const cart = JSON.parse(localStorage.getItem('abilitymade-cart-v1') || '[]');
      if (fingerprint(cart) === attempt.fingerprint) localStorage.setItem('abilitymade-cart-v1', '[]');
      const handoff = JSON.parse(localStorage.getItem('abilitymade-checkout-request-v1') || '{}');
      if (Array.isArray(handoff.items) && fingerprint(handoff.items) === attempt.fingerprint) localStorage.removeItem('abilitymade-checkout-request-v1');
    } catch { /* Storage unavailable: payment confirmation remains accurate. */ }
  };
  const sessionId = query.get('session_id');
  if (sessionId) {
    button.hidden = true;
    shippingForm.hidden = true;
    document.querySelector('#checkout-items').hidden = true;
    document.querySelector('#checkout-intro').textContent = copy.pending;
    const check = async (attempt = 0) => {
      try {
        const response = await fetch('/api/checkout-status?session_id=' + encodeURIComponent(sessionId), { cache: 'no-store' });
        if (!response.ok) { status.textContent = copy.unknown; return; }
        const result = await response.json();
        if (['refunded', 'partially_refunded', 'refund_pending', 'disputed'].includes(result.status)) {
          status.textContent = copy.review;
          document.querySelector('#checkout-intro').textContent = '';
          return;
        }
        if (result.status === 'paid') {
          status.textContent = copy.paid;
          document.querySelector('#checkout-intro').textContent = '';
          finishCart(sessionId);
          return;
        }
      } catch { status.textContent = copy.unknown; return; }
      if (attempt < 9) setTimeout(() => check(attempt + 1), 2000);
      else status.textContent = copy.wait;
    };
    check();
    return;
  }
  if (!items.length) { status.textContent = copy.empty; return; }
  if (items.some(item => !item.id)) { status.textContent = copy.invalid; return; }
  button.disabled = false;
  if (query.has('cancelled')) status.textContent = copy.cancelled;
  button.addEventListener('click', async () => {
    if (button.disabled || !shippingForm.reportValidity()) return;
    button.disabled = true;
    status.textContent = copy.loading;
    const submit = async () => {
      const country = shippingField('country').value;
      const shippingDetails = { name: shippingField('name').value.trim(), address: {
        line1: shippingField('line1').value.trim(), line2: shippingField('line2').value.trim(),
        city: shippingField('city').value.trim(), country,
        state: country === 'US' ? shippingField('state').value : country,
        postal_code: shippingField('postal_code').value.trim(),
      } };
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(shippingDetails)));
      const shippingKey = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      const cart = items.map(({ id, quantity }) => ({ id, quantity }));
      const cartFingerprint = fingerprint(cart);
      let attempt = readAttempt();
      if (attempt && attempt.fingerprint === cartFingerprint) {
        if (attempt.paid) {
          if (!window.confirm(copy.repeat)) { status.textContent = copy.paid; return; }
          attempt = null;
        }
        // Do not silently renew an uncertain payment after Stripe's retry window.
        if (attempt && Date.now() - attempt.created > 23 * 60 * 60 * 1000) { status.textContent = copy.unknown; return; }
      }
      if (attempt?.shippingKey && attempt.shippingKey !== shippingKey) {
        if (attempt.sessionId && !window.confirm(zh ? '配送地址已更改。请确保之前的支付页面已关闭且未付款。要创建新结账吗？' : 'Delivery address changed. Make sure the previous payment page is closed and unpaid. Create a new checkout?')) { status.textContent = copy.unknown; return; }
        attempt = null;
      }
      if (!attempt || attempt.fingerprint !== cartFingerprint) {
        attempt = { fingerprint: cartFingerprint, requestId: crypto.randomUUID(), language, created: Date.now() };
        localStorage.setItem(attemptKey, JSON.stringify(attempt));
      }
      attempt.shippingKey = shippingKey;
      localStorage.setItem(attemptKey, JSON.stringify(attempt));
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: cart, language: attempt.language, requestId: attempt.requestId, shippingDetails }),
      });
      if (!response.ok) {
        status.textContent = response.status === 400 ? (zh ? '请检查商品和配送地址。仅支持美国 50 州及特区、波多黎各和关岛，请填写匹配的邮编。' : 'Check your items and delivery address. Only the 50 US states, DC, Puerto Rico and Guam are supported; enter a matching ZIP code.') : copy.unavailable;
        return;
      }
      const result = await response.json();
      if (new URL(result.url).origin !== 'https://checkout.stripe.com') throw new Error();
      if (!/^cs_(test_|live_)?[a-zA-Z0-9]+$/.test(result.sessionId || '')) throw new Error();
      attempt.sessionId = result.sessionId;
      localStorage.setItem(attemptKey, JSON.stringify(attempt));
      location.assign(result.url);
    };
    try {
      // Serialize tab retries so they share the same server idempotency key.
      if (navigator.locks) await navigator.locks.request('abilitymade-checkout', submit);
      else { status.textContent = copy.unavailable; }
    } catch { status.textContent = copy.unavailable; }
    finally { button.disabled = false; }
  });
})();
