# AbilityMade Stripe Checkout setup

The local implementation replaces purchase-request checkout with Stripe-hosted Checkout. It uses USD prices from `data/products.json`, shipping addresses in US (all 50 states and DC), PR and GU, free standard shipping at a merchandise subtotal of $120, and one $10 standard shipping fee per order below $120, including orders containing products from multiple suppliers. Suppliers ship directly to customers. The state-based shipping proposal is cancelled; keep Stripe-hosted Checkout and US/PR/GU address collection (AS, MP, VI and UM excluded). On October 20, 2026, the owner confirmed that Stripe Payments and Payouts are activated and Truist Bank is connected. This is owner-confirmed; no credentials or account details were inspected during this review.

## Configuration

Set these privately in Railway service Variables. Never paste secret values into chat or source files.

| Variable | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe sandbox secret key initially; live secret key only at launch |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the matching sandbox/live webhook endpoint |
| `PUBLIC_SITE_URL` | `https://abilitymade.net` in production; your staging URL during testing |
| `ORDER_DATA_DIR` | `/data/orders` on a Railway persistent volume mounted at `/data` |
| `SHIPPING_FLAT_RATE_CENTS` | `1000` — approved $10 order-wide fee below $120; apply only when deployment configuration changes are authorized |
| `STRIPE_AUTOMATIC_TAX` | `false` per current owner instruction; do not enable without approval |
| `STRIPE_LIVE_ENABLED` | Keep `false` during testing; `true` permits live-key session creation |

Use a separate Railway environment, Stripe sandbox, and volume for test orders. Railway's ordinary application filesystem is ephemeral. Mount a volume before allowing payments, keep a single service replica, configure backups, and test that an order survives a restart/redeploy. The application refuses storage inside the public repository. In a Railway environment, it also requires the order directory to be on `RAILWAY_VOLUME_MOUNT_PATH`. Mounting the volume, configuring backups, and verifying persistence remain deployment prerequisites.

The app creates private immutable `checkout-<reference>.json` snapshots and `order-<session-hash>.json` paid records, using fsync and atomic publication to handle concurrent webhook retries. Do not delete these files as routine cleanup. They contain customer information. Backups require the same access restrictions. No customer data is returned by the public status endpoint.

## Stripe configuration and verification

1. Verify AbilityMade's legal business details and Truist payout connection in Stripe. Configure business contact/support information and receipt settings. Do not put account/routing numbers in the website.
2. In the sandbox, add an event destination for `https://YOUR-STAGING-HOST/api/stripe-webhook`. Select snapshot events `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Use API version `2025-06-30.basil` to match the pinned API requests. Store its signing secret in Railway.
3. Select the payment methods you want in Stripe's Dashboard. The integration allows Stripe to select eligible methods; delayed methods are not treated as paid until a successful payment event arrives. Disable delayed methods if they are not wanted for the launch.
4. Set the variables above, including `SHIPPING_FLAT_RATE_CENTS=1000` and an explicit tax choice. Railway variables and deployments require separate authorization; local example edits do not change them.
5. Use Stripe's documented test payment methods to complete an English and Chinese order. Check the item prices, US address collection, shipping below $120 and free shipping at/above $120, tax behavior, cancellation, and payment confirmation page.
6. Confirm the signed webhook returns 200 and produces exactly one private paid order with correct items, shipping address, totals, and payment reference. Replay the event and restart/redeploy the service to verify there is still one order and its status persists. A success redirect alone must never establish payment.
7. The approved customer policy is $10 below $120, free at $120 or more, US addresses only, and one fee per order across suppliers. Confirm supplier carrier costs, delivery windows, returns/refunds, and sales-tax treatment before launch. Do not add state-based pricing or supplier surcharges.
8. Switch to the live key and a matching live webhook secret; set `STRIPE_LIVE_ENABLED=true` only after the preceding checks. Deploy Railway's staged variables and code. A controlled live payment/refund requires the owner's explicit authorization.

Do not email suppliers automatically. Paid orders await human review. The operator can review payments and shipping details in Stripe and privately access order records through Railway. Supplier sub-orders, tracking, settlement ledgers, automated supplier payments, product administration, refund synchronization, and automated order emails are not part of this change. Enable desired Stripe receipts separately. Refunds and fulfillment are currently managed manually in Stripe/with suppliers.

## Local verification

Use Node 20.6+ for the optional env-file command (the server itself remains Node 20+):

```sh
node --env-file=.env server.js
npm test
```

Create `.env` privately using `.env.example`, set `ORDER_DATA_DIR` to a private absolute path outside this repository, and use sandbox keys only. The server does not automatically load `.env` under `npm start`; use the command above or exported environment variables. Stripe CLI can forward sandbox events to `localhost:3000/api/stripe-webhook`; its signing secret differs from a Dashboard endpoint's secret. No real Stripe or Resend calls are made by `npm test`.

`data/products.json` is authoritative for charged prices. Keep both storefronts aligned with it when products/prices change; the catalog consistency test checks both pages. No inventory management is introduced.

## Failure handling

- Missing shipping/tax/key/storage configuration returns 503; live keys also require explicit live activation and HTTPS.
- Invalid products/quantities fail before contacting Stripe. Browser-provided prices and names are never trusted.
- The same browser payment attempt uses an idempotency key on retries. A changed cart creates a new attempt. The cart is retained on cancellation. Verified payment clears only the matching submitted cart; edits made in another tab are retained, and repeating an identical paid cart requires confirmation.
- Unsigned, tampered, or stale webhooks are rejected. Unpaid events do not create paid orders. Storage failures return non-2xx so Stripe can retry; monitor failed webhook deliveries in Stripe and retry after correcting the storage issue.
- The confirmation page requests server-side Stripe payment verification and never declares success just from URL parameters. If confirmation is delayed it asks the customer not to pay again.
- Immutable paid records represent the original payment, not the current refund/dispute state. Review Stripe before manual fulfillment and maintain manual refund/settlement records.

References: [Stripe Checkout API](https://docs.stripe.com/api/checkout/sessions/create), [Stripe webhook verification](https://docs.stripe.com/events/manage-webhook-endpoints), [Railway volumes](https://docs.railway.com/volumes), [Railway backups](https://docs.railway.com/volumes/backups).

## Payment reconstruction

See [RECOVERY.md](RECOVERY.md) for schema-2 metadata, protected payment status,
and the administrator-only separate-directory recovery procedure. No staging or
production migration is performed automatically.

## Shipping policy rollout

The local configuration example now specifies `SHIPPING_FLAT_RATE_CENTS=1000`; the server requires explicit runtime configuration and refuses new Checkout Sessions unless this value is 1000. Historical webhook processing and recovery do not use this new-session check. Do not deploy the new $10 customer copy with an old $7 staging setting. When authorized, apply the variable and code together and verify a newly created Checkout Session before enabling customer checkout. No Railway variables were changed by this local update.

Do not rewrite old Checkout snapshots, paid orders, historical Stripe amounts, or recovery fixtures. Existing $87/$120 sandbox purchases retain their original shipping charges. Before a production price change, reconcile/expire older open Sessions under an approved procedure so stale quotes cannot conflict with new storefront copy. Automatic tax remains false as instructed; the business tax treatment still needs resolution before launch.
