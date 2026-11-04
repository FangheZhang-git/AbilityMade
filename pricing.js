// Shared USD arithmetic. Inputs stay as text while editing; calculations use cents.
(function (root) {
  const MAX_CENTS = 99999999;
  function parseCents(value) {
    if (typeof value !== 'string' || !/^\d{1,8}(?:\.\d{1,2})?$/.test(value)) return null;
    const [dollars, fraction = ''] = value.split('.');
    const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, '0'));
    return Number.isSafeInteger(cents) && cents <= MAX_CENTS ? cents : null;
  }
  function validPrice(cents, minimum) {
    return Number.isSafeInteger(cents) && cents >= minimum && cents <= MAX_CENTS;
  }
  const api = { parseCents, validPrice, MAX_CENTS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AbilityPricing = api;
})(globalThis);
