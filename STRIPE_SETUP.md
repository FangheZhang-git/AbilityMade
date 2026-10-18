# AbilityMade Stripe Checkout setup

The local implementation replaces purchase-request checkout with Stripe-hosted Checkout. It uses USD prices from `data/products.json`, US shipping addresses, free standard shipping at a merchandise subtotal of $120, and a configurable flat rate below $120. The rate is not yet decided. The organization has an activated Stripe account and a Truist Community Checking Account for Nonprofit Organization; its payout connection has not been verified.

## Configuration

Set these privately in Railway service Variables. Never paste secret values into chat or source files.

| Variable | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe sandbox secret key initially; live secret key only at launch |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the matching sandbox/live webhook endpoint |
| `PUBLIC_SITE_URL` | `https://abilitymade.net` in production; your staging URL during testing |
| `ORDER_DATA_DIR` | `/data/orders` on a Railway persistent volume mounted at `/data` |
| `SHIPPING_FLAT_RATE_CENTS` | Owner-approved US flat rate below $120, in cents |
| `STRIPE_AUTOMATIC_TAX` | Explicit `true` or `false`; configure tax registrations/product tax settings in Stripe if enabled |
| `STRIPE_LIVE_ENABLED` | Keep `false` during testing; `true` permits live-key session creation |

Use a separate Railway environment, Stripe sandbox, and volume for test orders. Railway's ordinary application filesystem is ephemeral. Mount a volume before allowing payments, keep a single service replica, configure backups, and test that an order survives a restart/redeploy. The application refuses storage inside the public repository. In a Railway environment, it also requires the order directory to be on `RAILWAY_VOLUME_MOUNT_PATH`. Mounting the volume, configuring backups, and verifying persistence remain deployment prerequisites.

The app creates private immutable `checkout-<reference>.json` snapshots and `order-<session-hash>.json` paid records, using fsync and atomic publication to handle concurrent webhook retries. Do not delete these files as routine cleanup. They contain customer information. Backups require the same access restrictions. No customer data is returned by the public status endpoint.

## Stripe configuration and verification

1. Verify AbilityMade's legal business details and Truist payout connection in Stripe. Configure business contact/support information and receipt settings. Do not put account/routing numbers in the website.
2. In the sandbox, add an event destination for `https://YOUR-STAGING-HOST/api/stripe-webhook`. Select snapshot events `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Use API version `2025-06-30.basil` to match the pinned API requests. Store its signing secret in Railway.
3. Select the payment methods you want in Stripe's Dashboard. The integration allows Stripe to select eligible methods; delayed methods are not treated as paid until a successful payment event arrives. Disable delayed methods if they are not wanted for the launch.
4. Set the variables above, including a test shipping amount and an explicit tax choice. Test values are not business-policy approval. Deploy the staged changes in Railway.
5. Use Stripe's documented test payment methods to complete an English and Chinese order. Check the item prices, US address collection, shipping below $120 and free shipping at/above $120, tax behavior, cancellation, and payment confirmation page.
6. Confirm the signed webhook returns 200 and produces exactly one private paid order with correct items, shipping address, totals, and payment reference. Replay the event and restart/redeploy the service to verify there is still one order and its status persists. A success redirect alone must never establish payment.
7. Confirm shipping costs, destinations (currently US including US territories supported by Stripe's US address form), returns/refunds, sales-tax treatment, and manual supplier fulfillment responsibilities before live launch. If only the contiguous US is supported, additional state/territory restrictions are required before launch.
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
- The same browser payment attempt uses an idempotency key on retries. A changed cart creates a new attempt. The cart is retained on cancellation and after payment so changes made in another tab are not erased; customers should review it before another purchase.
- Unsigned, tampered, or stale webhooks are rejected. Unpaid events do not create paid orders. Storage failures return non-2xx so Stripe can retry; monitor failed webhook deliveries in Stripe and retry after correcting the storage issue.
- The confirmation page polls the persisted webhook result and never declares success just from URL parameters. If confirmation is delayed it asks the customer not to pay again.
- Immutable paid records represent the original payment, not the current refund/dispute state. Review Stripe before manual fulfillment and maintain manual refund/settlement records.

References: [Stripe Checkout API](https://docs.stripe.com/api/checkout/sessions/create), [Stripe webhook verification](https://docs.stripe.com/events/manage-webhook-endpoints), [Railway volumes](https://docs.railway.com/volumes), [Railway backups](https://docs.railway.com/volumes/backups).
