# Stripe Checkout local readiness

Staging remains offline. No deployment, Stripe API call, real payment, secret access, or new service is required by these local changes.

## Local verification

Run `npm test` on Node 20+. Synthetic Stripe responses cover declined/payment-method-required, authentication-required, processing, cancelled, successful authentication, mismatched paid Session/PaymentIntent, recovery, refunds/disputes, provider failure, signature verification, and idempotency. Browser-script tests cover double clicks, shared cross-language retries, cancellation, verified cart cleanup, modified carts, stale paid tabs, and deliberate repeat confirmation.

These tests verify application behavior around Stripe states; they do not run Stripe's hosted card form or an actual 3-D Secure challenge. Native browser QA and final Sandbox tests remain necessary.

## Cart safeguards and limitations

The browser stores a non-secret Session reference and a shared request ID, serializing Checkout submission with Web Locks. It uses the first attempt's language for retries, so changing storefront language cannot change the idempotency key for that attempt. The server still determines prices and verifies payment independently. A verified success clears only the matching submitted cart, once. Other tabs refresh cart state on storage events and page restoration. Changed carts are retained. Repeating an identical paid cart requires explicit confirmation.

Storage-disabled or Web-Locks-unavailable browsers fail safely instead of launching an unprotected Checkout. An unresolved attempt older than 23 hours asks the customer to contact support rather than silently creating a new charge. Staff must verify Stripe before helping retry. Local storage is not payment evidence. Clearing browser storage, using another device, changing a cart, or not returning from Stripe can bypass these convenience safeguards; they do not guarantee one purchase per person. Server/webhook idempotency protects the same Session, not distinct intentional purchases. Test mobile Safari/Chrome, desktop Chrome, multi-tab use, back navigation, and both languages before release.

## Launch gates — still open

1. Approve a final testing budget before restarting staging. Deploy the reviewed commit only with approval; preserve automatic deployment being disabled. Run recovery discovery, dry-run, and reconstruction into a separate empty private directory against the two historical sandbox payments; compare exact amounts/items and preserve original files.
2. Test the new metadata on a separately authorized sandbox purchase, hosted decline and 3-D Secure flows, cancellation, signed webhook delivery, duplicate delivery, status confirmation, and recovery. Simulated tests alone do not establish hosted Stripe behavior or webhook API-version compatibility.
3. Confirm production shipping policy with suppliers: US coverage (including territories/AK/HI), final fee below $120, free-shipping threshold, split-supplier package costs, carrier charges, delivery windows, returns and lost-package responsibility. The $7 setting remains provisional sandbox-only; do not treat it as an approved production fee.
4. Resolve sales-tax obligations with a qualified adviser, including relevant registrations, product/shipping treatment and any nonprofit-specific facts. Choose collection settings only after that decision. Automatic tax is currently disabled for sandbox only; this is not a production exemption decision. Recheck service fees before enabling paid tax features. No tax settings were changed.
5. Confirm supplier IDs, product-to-supplier assignments, settlement rates, settlement dates, and the proposed shipped-items/refund-adjustment policy. Establish the private operational ledger and recoverable history described in FULFILLMENT_LEDGER.md. Human review is required before fulfillment, particularly after recovery.
6. Confirm customer-facing shipping, cancellation, return/refund, privacy, and contact policies in both languages. Decide whether confirmation relies on the verified return page plus Stripe receipts or an approved email implementation; do not promise email delivery until configured and tested.
7. Review production secret separation, live-mode activation, webhook event/version configuration, persistent storage, single-replica operation, permissions, access to recovery tools, reconciliation cadence, and a rollback procedure. Review order retention and protection of operational records. No production credentials are accessed during local tests.
8. Explicitly approve the final production diff, deployment, live settings and ongoing hosting/payment costs. Never enable live Checkout as part of a recovery test. Launch is not approved by passing the local suite.

No production launch is recommended until these gates are resolved. Stripe payment history supports reconstruction of payment records; it does not replace supplier fulfillment and settlement history.
