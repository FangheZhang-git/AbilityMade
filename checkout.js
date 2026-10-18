(() => {
  const query = new URLSearchParams(location.search);
  const zh = query.get('language') === 'zh-CN';
  const language = zh ? 'zh-CN' : 'en';
  const copy = zh ? {
    title: '确认订单', intro: '确认商品后，前往安全支付页面。', button: '前往安全支付',
    note: '仅配送美国。商品金额满 $120 免标准运费。付款前会显示运费及适用税费。',
    empty: '购物车为空，请返回商店添加商品。', loading: '正在打开支付页面…',
    unavailable: '在线支付暂不可用，请稍后再试或通过下方邮箱联系我们。',
    invalid: '购物车需要更新，请返回商店重新选择商品。',
    pending: '正在确认付款，请稍候…', paid: '付款已确认，感谢你的订单！',
    review: '付款记录需要核对（可能涉及退款或争议）。请联系我们，请勿重复付款。',
    unknown: '暂时无法核实付款状态。请稍后刷新或联系我们，请勿重复付款。',
    wait: '付款确认仍在处理中。请稍后刷新此页，或通过下方邮箱联系我们。请勿重复付款。',
    cancelled: '支付已取消，购物车商品仍然保留。', shop: '返回商店', contact: '联系我们',
  } : {
    title: 'Review your order', intro: 'Review your items, then continue to secure payment.', button: 'Continue to secure payment',
    note: 'US shipping only. Free standard shipping on merchandise orders of $120 or more. Shipping and applicable tax are shown before payment.',
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
  document.querySelector('.delivery-strip').textContent = zh ? '美国配送 · 商品金额满 $120 免标准运费' : 'US shipping · Free standard delivery on orders $120 and above';
  document.querySelector('#checkout-title').textContent = copy.title;
  document.querySelector('#checkout-intro').textContent = copy.intro;
  document.querySelector('#checkout-note').textContent = copy.note;
  const button = document.querySelector('#pay-button');
  const status = document.querySelector('#payment-status');
  button.textContent = copy.button;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('abilitymade-checkout-request-v1') || '{}'); } catch {}
  const items = Array.isArray(saved?.items) ? saved.items : [];
  for (const item of items) {
    const row = document.createElement('p');
    row.textContent = `${item.title} × ${item.quantity} — ${item.price}`;
    document.querySelector('#checkout-items').append(row);
  }
  const sessionId = query.get('session_id');
  if (sessionId) {
    button.hidden = true;
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
          // Preserve the cart: it may have changed in another tab while payment was open.
          sessionStorage.removeItem('abilitymade-payment-attempt');
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
    button.disabled = true;
    status.textContent = copy.loading;
    try {
      const cart = items.map(({ id, quantity }) => ({ id, quantity }));
      const fingerprint = JSON.stringify(cart);
      let attempt;
      try { attempt = JSON.parse(sessionStorage.getItem('abilitymade-payment-attempt')); } catch {}
      if (!attempt || attempt.fingerprint !== fingerprint || Date.now() - attempt.created > 23 * 60 * 60 * 1000) {
        attempt = { fingerprint, requestId: crypto.randomUUID(), created: Date.now() };
        sessionStorage.setItem('abilitymade-payment-attempt', JSON.stringify(attempt));
      }
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: cart, language, requestId: attempt.requestId }),
      });
      if (!response.ok) {
        status.textContent = response.status === 400 ? copy.invalid : copy.unavailable;
        return;
      }
      const result = await response.json();
      if (new URL(result.url).origin !== 'https://checkout.stripe.com') throw new Error();
      location.assign(result.url);
    } catch { status.textContent = copy.unavailable; }
    finally { button.disabled = false; }
  });
})();
