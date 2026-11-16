const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const QRCode = require('qrcode');
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function getCatalog() {
  const products = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/products.json'), 'utf8'));
  const ids = new Set();
  for (const p of products) {
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(p.id) || ids.has(p.id) || typeof p.name !== 'string' ||
        !Number.isSafeInteger(p.unitAmount) || p.unitAmount < 50) throw new Error('invalid_catalog');
    ids.add(p.id);
  }
  return products;
}
function publicCatalog() {
  // Existing catalog IDs were derived from filenames. Never derive future IDs from names.
  const presentations = {};
  for (const [language, filename] of [['en', 'index.html'], ['zh-CN', 'index-zh.html']]) {
    const html = fs.readFileSync(path.join(__dirname, filename), 'utf8');
    for (const [, attributes, card] of html.matchAll(/<article class="merchandise-card"([^>]*)>([\s\S]*?)<\/article>/g)) {
      const image = card.match(/<img src="([^"]+)"/)?.[1];
      if (!image) continue;
      const id = attributes.match(/data-product-id="([^"]+)"/)?.[1] || path.basename(image).replace(/\.[a-z0-9]+$/i, '').toLowerCase();
      presentations[id] ||= {};
      presentations[id][language] = card.match(/<h3>([^<]+)<\/h3>/)?.[1];
      presentations[id].image = image;
    }
  }
  return getCatalog().map(p => ({ id: p.id, name: p.name,
    nameZh: p.nameZh || presentations[p.id]?.['zh-CN'] || p.name,
    image: p.image || presentations[p.id]?.image || '', unitAmount: p.unitAmount,
    maxUnitAmount: p.maxUnitAmount || 99999999,
    available: p.active !== false && p.available !== false }));
}
function qrUrl(id, origin = 'https://abilitymade.net') {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) throw new Error('invalid_product');
  const url = new URL(origin);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('invalid_origin');
  return `${url.origin}/exhibition/add/${encodeURIComponent(id)}`;
}
async function labelSvg(product, origin) {
  const qr = await QRCode.toString(qrUrl(product.id, origin), { type: 'svg', errorCorrectionLevel: 'M', margin: 4 });
  const embedded = qr.replace('<svg ', '<svg x="125" y="85" width="350" height="350" ');
  const lines = product.name.match(/.{1,38}(?:\s|$)|.{1,38}/g) || [product.name];
  const height = 575 + Math.max(0, lines.length - 2) * 25;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="${height}" viewBox="0 0 600 ${height}"><rect width="600" height="${height}" fill="white"/><g fill="#153d35" font-family="Arial, sans-serif" text-anchor="middle"><text x="300" y="55" font-size="32" font-weight="bold">AbilityMade</text>${embedded}${lines.map((line,i) => `<text x="300" y="${455+i*25}" font-size="22">${escape(line.trim())}</text>`).join('')}<text x="300" y="${height-55}" font-size="21">From $${(product.unitAmount/100).toFixed(2)} · Scan to Add to Cart</text><text x="300" y="${height-20}" font-size="18">abilitymade.net · Exhibition pickup only</text></g></svg>`;
}
async function handleExhibition(req, res, url) {
  res.setHeader('Cache-Control', 'no-store');
  const send = (status, type, body) => { res.writeHead(status, {'Content-Type': type}); res.end(req.method === 'HEAD' ? undefined : body); };
  if (!['GET','HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); return send(405, 'text/plain', 'Method Not Allowed'); }
  if (url.pathname === '/api/exhibition/catalog') return send(200, 'application/json', JSON.stringify(publicCatalog()));
  const match = url.pathname.match(/^\/exhibition\/(add|qr|label)\/([a-zA-Z0-9_-]{1,120})(?:\.(svg|png))?$/);
  if (match) {
    const [, action, id, format] = match;
    const product = getCatalog().find(p => p.id === id && p.active !== false && p.available !== false);
    if (!product) return send(404, 'text/html; charset=utf-8', '<h1>Product unavailable / 商品暂不可购买</h1><a href="/exhibition.html">On-site cart / 现场购物车</a>');
    if (action === 'add') {
      const language = url.searchParams.get('language') === 'zh-CN' ? '&language=zh-CN' : '';
      // A fresh scan gets a new receipt. Redirect removes the permanent URL from history.
      res.writeHead(303, { Location: `/exhibition.html?scan=${encodeURIComponent(id)}&receipt=${crypto.randomUUID()}${language}` });
      return res.end();
    }
    const origin = process.env.PUBLIC_SITE_URL || 'https://abilitymade.net';
    if (action === 'label') {
      res.setHeader('Content-Disposition', `attachment; filename="${id}-label.svg"`);
      return send(200, 'image/svg+xml', await labelSvg(product, origin));
    }
    res.setHeader('Content-Disposition', `attachment; filename="${id}-qr.${format === 'png' ? 'png' : 'svg'}"`);
    return format === 'png'
      ? send(200, 'image/png', await QRCode.toBuffer(qrUrl(id, origin), { width: 1200, margin: 4, errorCorrectionLevel: 'M' }))
      : send(200, 'image/svg+xml', await QRCode.toString(qrUrl(id, origin), { type: 'svg', margin: 4, errorCorrectionLevel: 'M' }));
  }
  if (url.pathname === '/exhibition/labels') {
    const labels = await Promise.all(getCatalog().filter(p => !p.exhibitionTest && p.active !== false && p.available !== false).map(async p =>
      `<article>${await labelSvg(p, process.env.PUBLIC_SITE_URL || 'https://abilitymade.net')}<p class="controls"><a href="/exhibition/label/${p.id}.svg">Label SVG</a> · <a href="/exhibition/qr/${p.id}.png">QR PNG</a></p></article>`));
    return send(200, 'text/html; charset=utf-8', `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>AbilityMade — Print labels</title><style>body{font-family:Arial;margin:16px}.labels{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}article{break-inside:avoid;border:1px solid #ddd}svg{width:100%;height:auto}.controls{padding:8px}@media print{@page{margin:10mm}.controls{display:none}.labels{grid-template-columns:repeat(2,1fr);gap:4mm}article{border:1px dotted #aaa}}</style><h1 class="controls">AbilityMade QR labels</h1><p class="controls">Use your browser’s Print command to print all labels or save as PDF. Verify printed QR codes with a phone before exhibition use.</p><main class="labels">${labels.join('')}</main></html>`);
  }
  return send(404, 'text/plain', 'Not Found');
}
module.exports = { getCatalog, publicCatalog, qrUrl, labelSvg, handleExhibition };
