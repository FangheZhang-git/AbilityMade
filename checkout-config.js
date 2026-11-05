// Temporary owner-approved pause for NEW online and on-site Checkout Sessions.
// Set false to resume using STRIPE_AUTOMATIC_TAX after reviewing tax configuration.
// Existing Sessions, Stripe registrations, and historical orders are unaffected.
module.exports = { taxCollectionPaused: true };
