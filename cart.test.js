const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const AbilityPricing = require('./pricing');

// Execute the actual cart code from each storefront with a minimal DOM adapter.
function cartFixture(filename, saved = []) {
  const html = fs.readFileSync(require.resolve('./' + filename), 'utf8');
  const nodes = new Map();
  const node = key => {
    if (!nodes.has(key)) nodes.set(key, { textContent: '', value: '', attributes: {}, children: [],
      setAttribute(k,v) { this.attributes[k]=v; }, append(v) { this.children.push(v); },
      addEventListener(k,v) { this[k]=v; }, querySelector(k) { return node(key+k); } });
    return nodes.get(key);
  };
  const storage = new Map([['cart', JSON.stringify(saved)]]);
  const context = vm.createContext({ AbilityPricing, Map, JSON, Intl,
    localStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v) },
    document: { querySelector: node, createElement: () => node('row'+nodes.size) },
    cartDrawer: node('drawer'), cartOverlay: {},
    cartItemsContainer: node('items'), cartEmpty: {}, cartSubtotal: node('subtotal'), cartShipping: node('shipping'),
    cartError: node('error'), cartCount: node('count'), checkoutButton: node('checkout'),
    productCatalog: new Map([['a',{id:'a',amount:2500,title:'Artwork'}],['b',{id:'b',amount:3500,title:'Craft'}]]),
    currencyFormatter: new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}),
    cartStorageKey: 'cart', checkoutRequestStorageKey: 'handoff',
  });
  const copy = html.slice(html.indexOf('    const cartCopy ='),html.indexOf('    const newsletterCopy ='));
  const code = html.slice(html.indexOf('    const loadCart ='),html.indexOf('    categoryTabs.forEach((tab) => {',html.indexOf('    const renderCart =')));
  vm.runInContext('let cart = [];\n'+copy+code,context);
  const run = code => vm.runInContext(code,context);
  run('loadCart(); renderCart();');
  return { run, storage, nodes, node, html };
}
for (const file of ['index.html','index-zh.html']) {
  test(`${file}: legacy cart migration, exact totals, quantity edits and refresh preserve prices`, () => {
    const f = cartFixture(file,[{id:'a',quantity:1},{id:'b',quantity:2}]);
    assert.equal(f.run('cart[0].unitAmount'),2500);
    assert.equal(f.run('getCartTotals().subtotal'),9500);
    f.run("cart[0].priceInput='40.01'; cart[0].unitAmount=4001; updateCartItem('a',2)");
    assert.equal(f.run('getCartTotals().subtotal'),15002);
    assert.equal(f.node('[data-cart-shipping-amount]').textContent,'$0.00');
    assert.equal(f.node('[data-cart-total]').textContent,'$150.02');
    f.run('saveCheckoutRequest()');
    assert.equal(JSON.parse(f.storage.get('handoff')).items[0].unitAmount,4001);
    const refreshed = cartFixture(file,JSON.parse(f.storage.get('cart')));
    assert.equal(refreshed.run('cart[0].priceInput'),'40.01');
    assert.equal(refreshed.run('getCartTotals().subtotal'),15002);
  });
  test(`${file}: editing validation preserves raw input, disables checkout, and recovers accessibly`, () => {
    const f = cartFixture(file,[{id:'a',quantity:1}]);
    const row = f.node('items').children[0];
    const input = row.querySelector('[data-cart-price]');
    input.dataset={cartPrice:'a'}; input.closest=()=>row;
    for (const value of ['','-1','24.99','25.001','no','1000000']) {
      input.value=value; f.node('items').input({target:input});
      assert.equal(f.run('cart[0].priceInput'),value);
      assert.equal(input.attributes['aria-invalid'],'true');
      assert.equal(f.node('checkout').disabled,true);
      assert.ok(row.querySelector('.cart-price-error').textContent);
    }
    input.value='25.29'; f.node('items').input({target:input});
    assert.equal(f.node('checkout').disabled,false);
    assert.equal(f.node('[data-cart-total]').textContent,'$35.29');
    assert.equal(input.attributes['aria-invalid'],'false');
    assert.match(f.html,/inputmode="decimal"/);
    assert.match(f.html,/aria-describedby="help-\$\{product.id\} error-\$\{product.id\}"/);
    assert.match(f.html,/class="cart-price-error" aria-live="polite"/);
  });
}
