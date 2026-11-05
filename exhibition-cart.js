/* Shared pure cart operations; one storage write persists items and scan receipts together. */
(function(root) {
  const KEY = 'abilitymade-onsite-cart-v1';
  function load(storage) {
    try {
      const state = JSON.parse(storage.getItem(KEY));
      if (state && Array.isArray(state.items) && Array.isArray(state.receipts)) return state;
    } catch {}
    return {items: [], receipts: []};
  }
  function scan(state, product, receipt) {
    if (!product?.available) throw new Error('unavailable');
    if (!/^[a-f0-9-]{36}$/i.test(receipt || '')) throw new Error('invalid_scan');
    if (state.receipts.includes(receipt)) return false;
    const item = state.items.find(i => i.id === product.id);
    if (item) {
      if (item.quantity >= 99) throw new Error('quantity_limit');
      item.quantity += 1;
    } else {
      if (state.items.length >= 50) throw new Error('cart_limit');
      state.items.push({id: product.id, quantity: 1, unitAmount: product.unitAmount});
    }
    state.receipts.push(receipt);
    return true;
  }
  function cents(value) {
    if (!/^\d+(?:\.\d{1,2})?$/.test(String(value))) throw new Error('invalid_price');
    const [whole, part = ''] = String(value).split('.');
    const amount = Number(whole) * 100 + Number(part.padEnd(2,'0'));
    if (!Number.isSafeInteger(amount)) throw new Error('invalid_price');
    return amount;
  }
  const api = {KEY, load, scan, cents};
  if (typeof module !== 'undefined') module.exports = api;
  else root.OnsiteCart = api;
})(globalThis);
