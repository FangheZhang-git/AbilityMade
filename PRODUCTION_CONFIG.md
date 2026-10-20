# Production configuration — prepared, not applied

Owner confirmed Stripe Payments/Payouts activation and Truist connection on October 20, 2026. No account credentials were read. Passing local tests is not authorization to deploy or enable live payments.

| Variable | Intended production value |
| --- | --- |
| PUBLIC_SITE_URL | https://abilitymade.net |
| PAYMENT_ENVIRONMENT | production (keep stable for recovery) |
| ORDER_DATA_DIR | /data/orders on a production-only persistent volume mounted at /data |
| SHIPPING_FLAT_RATE_CENTS | 1000 |
| STRIPE_AUTOMATIC_TAX | false, per owner instruction |
| STRIPE_LIVE_ENABLED | false during preparation; true only after explicit launch approval |
| STRIPE_SECRET_KEY | Owner enters the correct AbilityMade live-mode secret directly in Railway; never in Git, commands, reports or chat |
| STRIPE_WEBHOOK_SECRET | Owner enters the separate live endpoint signing secret directly in Railway; never reuse the sandbox secret |

Preserve existing production Resend settings without printing or copying them. No publishable key or STRIPE_PRICE_* variables are needed by this hosted Checkout implementation. Do not delete older variables as part of this procedure.

## Live webhook, only when separately authorized

Create a separate live-mode snapshot event destination at https://abilitymade.net/api/stripe-webhook for checkout.session.completed and checkout.session.async_payment_succeeded. The HTTP API is pinned to 2025-06-30.basil. Prefer that event version if available; otherwise validate the actual chosen snapshot version in Sandbox before launch. Do not change the working sandbox destination. The webhook accepts raw signed bodies; a redirect is never proof of payment. Secret entry is an owner-controlled step.

## Review outcome and launch gates

Local review covers server-priced catalog items, $10/free order-wide shipping, US/PR/GU collection, raw-body signature verification with timestamp tolerance, atomic immutable order publication, provider-verified public status without customer data, historical-price recovery, and administrator-only reconstruction into private directories. Existing sandbox records remain untouched. Public verification and webhook API budgets are separate and bounded. Retry protection is not a cross-device duplicate-purchase guarantee.

Manual fulfillment is a documented procedure and blank ledger template, not an implemented supplier-management application. Before launch, assign an operator, product-to-supplier mappings, agreed settlement rates, notification channel, shipment tracking procedure, and an access-controlled operational ledger with recoverable history. Stripe cannot reconstruct shipments or settlements. Review fresh payment/refund/dispute state before every dispatch and settlement; no automatic refunds or supplier transfers exist.

Minimum remaining validation, with separate execution/cost approval:

1. Restart/deploy staging manually only when authorized, with automatic deployment still disabled and SHIPPING_FLAT_RATE_CENTS=1000. Prove original order hashes survive. No staging resource changes are authorized by this document.
2. In hosted Sandbox Checkout, test English below-$120 ($10) and Chinese exactly-$120 (free) carts; include a mixed-product order. Verify US address restrictions, zero automatic tax, successful 3-D Secure, decline, cancellation, refresh/back navigation and concurrent-tab retry behavior. No new payments are authorized yet.
3. Verify the chosen snapshot event version delivers successfully, forged signatures fail, replay produces no duplicate order, and private data is not publicly served. Recover both historical purchases and a new schema-2 payment via discovery/dry-run and reconstruction into a separate empty private directory; reconcile totals/items and preserve original records.
4. Resolve tax treatment while keeping automatic tax false; approve customer shipping/return/privacy/support policies. Establish the operational ledger and test recovery of its history. Do not interpret nonprofit status or disabled automatic tax as proof no tax is due.
5. Obtain explicit production release and cost approval. Confirm dedicated persistent volume, single replica, credential separation, live endpoint, storage permissions and rollback procedure before enabling checkout. Volume availability and costs have not been checked or changed in this review.

Deploy the selected reviewed revision only under explicit approval; merging main is not authorized. Retain the previous revision and volume. If launch checks fail, disable new live Checkout (STRIPE_LIVE_ENABLED=false) through an approved configuration deployment while keeping webhook processing and order records available for already-completed payments. Do not roll back to code that loses the webhook handler. A real live purchase or refund requires separate authorization.

Do not make a new paid service, monitoring subscription, backup purchase or tax feature activation part of this configuration implicitly. Staging stays offline until testing is approved.

## October 20 owner policy update — supersedes conflicting earlier policy proposals

Shipping scope approved: all 50 states, DC, Puerto Rico (PR) and Guam (GU); AS, MP, VI and UM are excluded; one $10 fee below $120/free at $120+. AbilityMade collects payment through Stripe, coordinates fulfillment and pays supplier shipping; suppliers ship directly. No voluntary cancellation after purchase, except applicable-law rights including delays. Arrival damage: photos requested, human assessment, justified manual refund consistent with consumer rights. Return periods and service-response timeframes remain unapproved. Use CUSTOMER_POLICIES_DRAFT.md and FULFILLMENT_LEDGER.md for current details.

Checkout now requests exactly US, PR and GU; recovery accepts those countries and does not require a separate state for PR/GU. AS, MP, VI and UM are excluded. Hosted Sandbox tests remain required: US (including AK/HI/DC), PR and GU, and attempts to select excluded countries or enter excluded territories under US. Local mocks and documented country options do not prove hosted address validation. A post-payment recovery rejection cannot prevent a charge; if an excluded destination can pass hosted Checkout, resolve it before launch. Keep Automatic Tax false; supplier costs/delivery estimates and legal/tax obligations remain unresolved.
