// Delivery validation before Stripe payment; billing addresses never control fulfillment.
const crypto = require('node:crypto');
const states = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));
function validateShipping(input) {
  const invalid = () => { throw Object.assign(new Error('invalid_shipping'), { status: 400 }); };
  const clean = (value, limit, optional = false) => {
    if (optional && (value == null || value === '')) return '';
    if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\x00-\x1f\x7f]/.test(value)) invalid();
    return value.trim();
  };
  const a = input?.address;
  const country = clean(a?.country, 2).toUpperCase();
  const state = clean(a?.state, 2, country !== 'US').toUpperCase();
  const postal_code = clean(a?.postal_code, 10);
  if (!['US', 'PR', 'GU'].includes(country) || !/^\d{5}(-\d{4})?$/.test(postal_code)) invalid();
  const zip = Number(postal_code.slice(0, 5));
  if (country === 'US' && (!states.has(state) || zip < 1000 || [96799, 96898].includes(zip) || (zip >= 96900 && zip <= 96999))) invalid();
  if (country === 'PR' && ((state && state !== 'PR') || !/^(006|007|009)/.test(postal_code))) invalid();
  if (country === 'GU' && ((state && state !== 'GU') || zip < 96910 || zip > 96932)) invalid();
  return { name: clean(input?.name, 100), address: {
    line1: clean(a?.line1, 200), line2: clean(a?.line2, 200, true),
    city: clean(a?.city, 100), state: country === 'US' ? state : country, postal_code, country,
  } };
}
const shippingHash = shipping => crypto.createHash('sha256').update(JSON.stringify(validateShipping(shipping))).digest('hex');
module.exports = { validateShipping, shippingHash };
