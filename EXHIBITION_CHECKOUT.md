# Exhibition QR checkout

Integrated from `feature/exhibition-qr-checkout` into `main`, preserving production delivery validation, pricing UI, payment recovery and refund/dispute verification.

## Review and run

Use Node 20+, `npm ci`, `npm test`, then `npx playwright install chromium webkit` and `npm run test:browser`. Browser tests start a localhost server without payment credentials and mock checkout responses. Unit tests mock Stripe and Resend. No live payments are needed.

Run `npm start`, then open `/exhibition/labels` for all printable labels, or scan a QR / visit `/exhibition/add/PRODUCT_ID`. The separate cart is `/exhibition.html`. Use `?language=zh-CN` or its language switch for Chinese. Ordinary storefront Add to Cart buttons still use the online cart.

## Catalog and labels

`data/products.json` remains the authoritative minimum-price catalog. Existing products, IDs, prices and images are unchanged. Every catalog entry is automatically eligible for dynamic QR generation; no per-product code changes or migration are needed. Keep IDs permanent. Optional `active:false` or `available:false` disables purchase; no inventory tracking was added. Optional `nameZh`, `image`, and `maxUnitAmount` support future catalog entries. Existing bilingual names/images are read from storefront markup for display only. Keep the existing storefront/catalog consistency convention when adding products.

- `/exhibition/qr/PRODUCT_ID.svg`: scalable QR download.
- `/exhibition/qr/PRODUCT_ID.png`: 1200px PNG download.
- `/exhibition/label/PRODUCT_ID.svg`: branded printable label with current minimum price.
- `/exhibition/labels`: all active labels, browser Print / Save as PDF.

Codes use `qrcode` 1.5.4 with a four-module quiet zone and medium error correction. They encode the stable ID URL under `PUBLIC_SITE_URL`, defaulting to `https://abilitymade.net`. Regenerate displayed labels after price/name changes; the QR itself remains valid. Printed labels need a physical phone scan before use. Links become usable publicly only after an authorized deployment.

## Carts, prices and shipping

On-site state uses `abilitymade-onsite-cart-v1`; online cart and checkout handoff keys remain separate. Each redirect from a permanent QR URL receives a fresh receipt. Items and processed receipts are stored together before removing scan parameters from browser history. Refresh/back/retry of that receipt does not add again; a fresh scan increments quantity and keeps the customer's chosen per-unit price. Web Locks serialize same-origin on-site writes in supported browsers. Browser storage must be enabled. Carts are retained on cancellation and after payment, so customers should review/remove previous items before another order.

Both storefront carts support editable per-unit prices. The merged online storefront retains its existing Pay What You Want UI and validation. The server re-reads catalog prices, checks availability, integer-cent amounts, minimum prices, optional product maximums, quantities 1–99, unique rows, and a 99,999,999-cent cart ceiling. QR parameters cannot specify trusted prices.

The server defaults legacy checkout requests to `online`. Online shipping remains the configured US flat rate below $120 and zero at/above $120. `onsite` requires explicit physical-collection acknowledgement, omits all Stripe shipping options/address collection, and stores shipping as exactly zero. It cannot create a delivery order. Both Checkout Session and PaymentIntent metadata identify fulfillment; private immutable snapshots and paid orders carry the same classification. Existing old snapshots default to online. A checkbox is an acknowledgement, not geolocation or proof of physical presence.

## Payment confirmation and taxes

The existing Stripe HTTP integration and pinned API version are retained. Online shipping remains the approved $10 below $120, with addresses validated and bound before payment. Both modes use v2 metadata and provider-verified recovery; onsite recovery requires matching pickup metadata and zero shipping. Signed, amount-validated Stripe webhooks create paid orders atomically and idempotently; the success page polls those records. An on-site success message additionally requires the verified order's fulfillment type to be onsite. Visiting a success URL alone never authorizes collection. Delayed payments remain pending. This does not implement item pickup tracking or prevent someone re-showing an old paid receipt; exhibition operating procedures must address that.

**Temporary tax pause (owner-approved November 5, 2026):** `checkout-config.js` sets `taxCollectionPaused: true` for both online and on-site purchases. New Sessions explicitly send `automatic_tax[enabled]=false`, attach no manual or dynamic tax rates, and ignore client-supplied tax settings. The pause overrides `STRIPE_AUTOMATIC_TAX`, including an existing `true` value, and removes the on-site tax blocker while active. Shipping and product prices are unchanged.

To re-enable collection, set `taxCollectionPaused: false` centrally and use an explicit `STRIPE_AUTOMATIC_TAX=true` or `false` environment setting. Restart the server after changing configuration. With automatic tax enabled again, the on-site venue-location guard still applies until trusted exhibition tax sourcing is implemented; online automatic tax resumes normally. Do not change Stripe tax registrations for this pause.

Only new Sessions use this setting. Already-created Sessions may retain their original tax configuration. Existing paid orders and signed webhook processing retain their original amounts, including tax; no transaction history is rewritten. Deployment is a separate authorized release step.

## Changed feature files

`exhibition.js`, `exhibition-cart.js`, `exhibition-client.js`, `exhibition.html`, `exhibition.css`, `exhibition.test.js`, `browser-tests/exhibition.spec.js`, `playwright.config.js`, `payments.js`, `payments.test.js`, `server.js`, `index.html`, `index-zh.html`, `checkout.js`, `package.json`, `package-lock.json`, and this guide. Test artifacts are ignored.

Existing uncommitted Stripe/storefront prerequisites are recorded in a separate prerequisite commit so the feature commit can be reviewed on its own. Unrelated outreach changes remain outside both commits. No credentials or order data are staged.

## Before production

1. Review the prerequisite and feature commits, including price limits and collection operating procedures.
2. Confirm the temporary tax pause is still intended. Before re-enabling on-site automatic tax, resolve venue tax sourcing/configuration.
3. Complete the existing `STRIPE_SETUP.md` checks: approved shipping rate, persistent private order volume/backups, Stripe sandbox webhook and payment-method validation.
4. Test actual hosted Stripe Checkout in sandbox, including English/Chinese, tax, cancellation, delayed payments, signature retries, restart persistence and mobile devices. Local mocks do not verify Stripe account configuration.
5. Test printed labels with physical phones. Confirm the production origin and label prices.
6. Obtain separate authorization before pushing to main or deploying to Railway.

References: https://github.com/soldair/node-qrcode and https://docs.stripe.com/api/checkout/sessions/create .
