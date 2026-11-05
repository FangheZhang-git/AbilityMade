(async () => {
  const query = new URLSearchParams(location.search);
  let remembered = 'en';
  try { remembered = localStorage.getItem('abilitymade-onsite-language') || 'en'; } catch {}
  const language = query.get('language') || remembered;
  const zh = language === 'zh-CN';
  const lang = zh ? 'zh-CN' : 'en';
  const text = (en, cn) => zh ? cn : en;
  const $ = id => document.getElementById(id);
  const money = cents => new Intl.NumberFormat(zh ? 'zh-CN' : 'en-US', {style:'currency',currency:'USD'}).format(cents/100);
  const notice = message => { $('status').textContent = message; };
  document.documentElement.lang = lang;
  document.title = text('On-Site Purchase | AbilityMade', '现场购买 | AbilityMade');
  $('title').textContent = text('On-Site Purchase — No Shipping Required', '现场购买 — 无需配送');
  $('intro').textContent = text('After payment is confirmed, you may take your purchased products from the exhibition. No delivery is provided.', '付款确认后，您可从展览现场取走已购买的商品。不提供配送。');
  $('online').textContent = text('Online shop', '网上商店');
  $('online').href = zh ? '/index-zh.html' : '/index.html';
  // Language changes never replay a scan; the receipt has already been stored.
  $('language').textContent = zh ? 'English' : '中文';
  $('language').href = '?language=' + (zh ? 'en' : 'zh-CN');
  $('subtotal-label').textContent = text('Subtotal', '商品小计');
  $('shipping').textContent = text('Shipping: $0.00', '运费：$0.00');
  $('tax').textContent = text('Applicable taxes and final total are shown in Stripe before payment.', '适用税费及最终总额将在 Stripe 付款前显示。');
  $('pickup-label').textContent = text('I am at the exhibition and will collect these items here. No delivery.', '我在展览现场，并将在此自取商品。不提供配送。');
  $('pay').textContent = text('Continue to secure payment', '前往安全支付');
  $('help').textContent = text('Need help? abilitymade@gmail.com', '需要帮助？abilitymade@gmail.com');
  const session = query.get('session_id');
  if (session) {
    $('summary').hidden = true;
    $('intro').textContent = text('Confirming payment. Do not pay again or collect items yet.', '正在确认付款。请勿重复付款或提前取走商品。');
    const check = async (attempt = 0) => {
      try {
        const response = await fetch('/api/checkout-status?session_id=' + encodeURIComponent(session), {cache:'no-store'});
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (result.status === 'paid' && result.fulfillment_type === 'onsite') {
          $('title').textContent = text('Payment Successful!', '付款成功！');
          $('intro').textContent = text('Thank you for supporting artists with disabilities. Your payment has been confirmed. You may now collect your purchased items from the AbilityMade exhibition.', '感谢您支持残障艺术家。您的付款已确认。现在您可以从 AbilityMade 展览现场取走已购买的商品。');
          try {
            // Retain the cart: another tab or payment attempt may have changed it.
            sessionStorage.removeItem('abilitymade-onsite-attempt');
          } catch {}
          return;
        }
      } catch {}
      if (attempt < 14) setTimeout(() => check(attempt+1), 2000);
      else notice(text('Payment is not yet confirmed. Refresh later or contact us. Do not pay again or collect items yet.', '付款尚未确认。请稍后刷新或联系我们。请勿重复付款或提前取走商品。'));
    };
    check(); return;
  }
  let catalog;
  try {
    localStorage.setItem('abilitymade-onsite-language', lang);
    const response = await fetch('/api/exhibition/catalog', {cache:'no-store'});
    if (!response.ok) throw new Error();
    catalog = new Map((await response.json()).map(p => [p.id, p]));
  } catch { notice(text('The cart could not load. Enable browser storage and try again.', '无法加载购物车。请启用浏览器存储后重试。')); return; }
  const lock = action => navigator.locks ? navigator.locks.request(OnsiteCart.KEY, action) : Promise.resolve().then(action);
  const mutate = fn => lock(() => {
    const state = OnsiteCart.load(localStorage);
    fn(state);
    localStorage.setItem(OnsiteCart.KEY, JSON.stringify(state));
    render();
  }).catch(() => notice(text('Could not update cart. Check the amount, quantity, and browser storage.', '无法更新购物车。请检查金额、数量及浏览器存储。')));
  const render = () => {
    const state = OnsiteCart.load(localStorage);
    $('items').replaceChildren();
    let total = 0;
    let valid = state.items.length > 0;
    $('empty').textContent = state.items.length ? '' : text('Scan a product QR code to add it here. Your online cart is kept separately.', '扫描商品二维码即可添加到此购物车。网上购物车单独保留。');
    for (const item of state.items) {
      const p = catalog.get(item.id);
      const available = p?.available;
      const correct = available && Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 99 && Number.isSafeInteger(item.unitAmount) && item.unitAmount >= p.unitAmount && item.unitAmount <= p.maxUnitAmount;
      valid &&= correct;
      if (correct) total += item.unitAmount * item.quantity;
      const row = document.createElement('article'); row.className = 'exhibition-item';
      const image = document.createElement('img'); image.alt = ''; if (p?.image) image.src = '/' + p.image.replace(/^\//, '');
      const details = document.createElement('div');
      const title = document.createElement('h2'); title.textContent = p ? (zh ? p.nameZh : p.name) : item.id;
      const min = document.createElement('p'); min.textContent = available ? text('Minimum per item: ', '每件最低价格：') + money(p.unitAmount) : text('Unavailable — remove this item to continue.', '商品不可购买，请移除后继续。');
      details.append(title, min);
      for (const [field, label, value, minimum, maximum, step] of [
        ['quantity', text('Quantity', '数量'), item.quantity, 1, 99, 1],
        ['unitAmount', text('Your price per item (USD)', '您的每件价格（美元）'), (item.unitAmount/100).toFixed(2), p ? p.unitAmount/100 : 0, p ? p.maxUnitAmount/100 : 0, .01],
      ]) {
        const wrapper = document.createElement('label'); wrapper.textContent = label + ' ';
        const input = document.createElement('input'); input.type = 'number'; input.min = minimum; input.max = maximum; input.step = step; input.value = value; input.disabled = !available;
        input.addEventListener('change', () => {
          if (!input.checkValidity() || input.value === '') { input.reportValidity(); $('pay').disabled = true; return; }
          mutate(state => {
            const saved = state.items.find(i => i.id === item.id);
            if (saved) saved[field] = field === 'quantity' ? Number(input.value) : OnsiteCart.cents(input.value);
          });
        });
        wrapper.append(input); details.append(wrapper);
      }
      const remove = document.createElement('button'); remove.textContent = text('Remove', '移除');
      remove.addEventListener('click', () => mutate(state => { state.items = state.items.filter(i => i.id !== item.id); }));
      details.append(remove); row.append(image, details); $('items').append(row);
    }
    $('subtotal').textContent = money(total);
    $('pay').disabled = !valid || total > 99999999 || !$('pickup').checked;
  };
  $('pickup').addEventListener('change', render);
  addEventListener('storage', event => { if (event.key === OnsiteCart.KEY) render(); });
  if (query.has('scan')) {
    await mutate(state => {
      const product = catalog.get(query.get('scan'));
      OnsiteCart.scan(state, product, query.get('receipt'));
      notice(text('Added to your on-site cart: ', '已添加到现场购物车：') + (zh ? product.nameZh : product.name));
      // Write before removing the receipt from the URL, so interrupted navigation is safe.
    });
    history.replaceState(null, '', '/exhibition.html?language=' + lang);
  }
  if (query.has('cancelled')) notice(text('Payment cancelled. Your cart is preserved.', '付款已取消，购物车已保留。'));
  render();
  $('pay').addEventListener('click', async () => {
    if (!$('pickup').checked) return;
    $('pay').disabled = true;
    notice(text('Opening secure checkout…', '正在打开安全支付页面…'));
    try {
      const items = OnsiteCart.load(localStorage).items;
      const fingerprint = JSON.stringify(items);
      let attempt;
      try { attempt = JSON.parse(sessionStorage.getItem('abilitymade-onsite-attempt')); } catch {}
      if (!attempt || attempt.fingerprint !== fingerprint || Date.now() - attempt.created > 23*3600000) {
        attempt = {fingerprint, requestId: crypto.randomUUID(), created: Date.now()};
        sessionStorage.setItem('abilitymade-onsite-attempt', JSON.stringify(attempt));
      }
      const response = await fetch('/api/create-checkout-session', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items, language:lang, requestId:attempt.requestId, fulfillment_type:'onsite', pickupConfirmed:true})});
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (new URL(result.url).origin !== 'https://checkout.stripe.com') throw new Error();
      location.assign(result.url);
    } catch { notice(text('Checkout is unavailable or your cart needs updating. Please contact AbilityMade. No payment was confirmed.', '暂时无法结账或购物车需要更新。请联系 AbilityMade。尚未确认付款。')); render(); }
  });
})();
