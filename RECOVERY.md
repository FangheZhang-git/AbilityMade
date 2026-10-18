# Stripe order recovery

## Scope and trust

Stripe is the payment authority. `order-*.json` files are immutable payment snapshots,
not fulfillment instructions. `requiresHumanReview: true` means a human must check the
separate operational ledger before dispatch or settlement. Recovery never writes that
ledger, sends messages, creates payments, or refunds anything. Existing order files,
including older embedded operational fields, are never overwritten.

Schema 2 adds store, schema version, stable environment, catalog SHA-256 revision,
language and order reference to Checkout Session and PaymentIntent metadata; each
inline Product also receives the AbilityMade product ID and matching metadata.
Historical prices and labels come from Stripe line items, not today's catalog.

The only legacy exception is the two reviewed staging Session IDs in recovery.js,
with exact Stripe Product IDs, names, prices, quantities and basket totals. It is
sandbox/staging only. Other missing/ambiguous metadata fails closed. No general
name-based mapping is allowed. These identifiers are not API credentials.

## Verification and public status

Verification retrieves the Session, PaymentIntent, all refund/dispute pages, and
(for reconstruction) every line-item page. It checks store/environment/mode,
reference, currency, received amount, item mappings, totals, and required US shipping
and contact fields. Inconsistent or incomplete data produces no new paid record.
Each paginated collection is bounded at 20 pages; exceeding that bound is an explicit
failure, never silent truncation. New orders require metadata schema 2.

The public status route returns only a financial status. It never returns customer
fields, writes orders, or treats a missing file as unpaid. Stripe failures yield an
unavailable response. Status requests share a 30-second cache (including failures),
30 uncached verifications per minute, a 200-entry cache bound, and a 60 requests/IP/minute
HTTP limit. The verifier caps Stripe GETs at 120/minute per process. Signed webhook
reconstruction has a separate 120/minute budget, isolated from public status traffic. These in-memory
limits assume the current single replica; they reset after restart. No additional
paid rate-limit service is required. Status freshness is up to 30 seconds.

Paid means the original payment succeeded. Current financial states are paid,
partially_refunded, refunded, refund_pending, disputed, or pending. Refunds and disputes
are read from Stripe on verification, not inferred from historical files. A lost or
open dispute requires review. No automatic refunds. Stored financialStatusAtRecovery
is explicitly a point-in-time value, not an always-current ledger. There is no new
background reconciliation scheduler or refund/dispute webhook subscription in this change.
Before fulfillment, use fresh verification plus the separate operational ledger.

## Administrator procedure

There is no recovery HTTP endpoint. Access requires an authorized shell and the
appropriate existing Stripe credential in that process's environment. Never paste
credentials into arguments, logs, source, or chat. Do not use this procedure until
staging execution and its small potential usage costs are approved.

1. Verify the code revision, Stripe account/mode, and environment. Discover Session IDs from Stripe even when all local files are lost:

   `node scripts/recover-orders.cjs --environment staging --discover --from START_UNIX_SECONDS --to END_UNIX_SECONDS`

   Use a fixed UTC start-inclusive/end-exclusive window from the store's launch to a
   recorded recovery cutoff. This reads paginated Checkout Sessions, not short-lived
   Events. Output contains only Session IDs, counts and the window. It writes nothing.
   Review candidate IDs before passing them to recovery. Unknown schema or mappings
   still fail reconstruction. Missing store/environment metadata is separately flagged
   in reviewSessionIds; never silently declare these reconciled. Explicit other stores
   and environments are excluded. scanComplete means pagination completed, NOT that
   every payment has been recovered. If the 2,000-session bound is reached or an API
   call fails, the scan fails without partial output: split into adjacent smaller
   windows and rerun. Reconcile discovered/review IDs against written records and the
   Stripe Dashboard; re-scan overlapping windows after delayed payments settle.
   Historical orders outside the selected dates are not covered. Do not rely on a
   scan alone to authorize fulfillment. Metadata deleted in Stripe needs human review.
   At most 20 explicit IDs per recovery invocation; use smaller batches for orders
   with unusually many refund/dispute pages. CLI failure never means unpaid.
2. Pre-create a **new empty private directory**, mode 0700, outside the repository and
   separate from `/data/orders`. Pass its canonical absolute path (resolve macOS `/tmp`
   symlinks). A nonempty, world/group-accessible, or symlinked target is rejected.
3. Dry-run (default; no records written):

   `node scripts/recover-orders.cjs --environment staging --target /ABSOLUTE/PRIVATE/EMPTY/DIRECTORY --session SESSION_ID --session SECOND_SESSION_ID`

4. Inspect the sanitized count summary. Exit 0 and complete=true mean all specified
   sessions reconstructed successfully. Any failed session makes exit status nonzero.
   Diagnose with one explicit ID at a time; never dump provider errors or payloads.
5. After review, repeat with `--write-reviewed` to write into that same still-empty
   directory. Output remains counts only. If a batch partially succeeds, retain that
   directory for review; do not treat it as complete or blindly retry into it. Use a
   new empty target for another attempt. Publication into the application's storage
   is a separate reviewed operation, not performed by this command.
6. Verify counts, private permissions and expected payment totals without printing
   customer records. Compare repeated recoveries semantically: `recoveredAt` changes
   between independent targets. Original recordedAt/eventId cannot be recreated and
   are intentionally not fabricated. Checkout snapshots need not be recreated: schema
   2 webhooks and allowlisted legacy recovery do not depend on them.

The environment namespace defaults to PAYMENT_ENVIRONMENT, then Railway's environment
name, then local. Set it deliberately before future checkout use; renaming it later
can make earlier sessions unrecognized. Production writes need separate review; the
CLI also checks test/live key mode against staging/production without displaying it.

## Validation and launch limitations

`npm test` uses synthetic provider fixtures and new OS temporary directories only.
It covers both historical basket shapes, complete pagination, immutable/concurrent
writes, unavailable providers, unpaid sessions, mismatched metadata, refunds/disputes,
status caching and limits, and public private-file blocking. No test calls Stripe.

A live staging dry run against the existing two sandbox Sessions is still required.
A future schema-2 Checkout needs a separately authorized staging test to validate
actual Stripe metadata persistence and API response shapes. Existing orders and the
production site must remain untouched. Fulfillment/settlement history still needs an
independent protected ledger and recovery policy; this change does not implement it.
