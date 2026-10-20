# Manual supplier fulfillment and settlement ledger

Blank working template; no supplier identities, rates, customer data, or actual orders are included. Copy the template below into a private document outside this repository. Do not fill this tracked file with real records. No automatic supplier messages, payments, refunds, or inventory tracking are implemented.

Stripe is the payment authority. Immutable payment/recovery files are evidence, not the fulfillment ledger. Recovery never marks an order shipped or settled. A recovered order starts on HOLD until a person reconciles it against this independent ledger and Stripe's current refund/dispute state.

## Approved customer shipping policy

Suppliers ship directly to customers. Charge $10 standard shipping once per customer order below $120 in merchandise, or $0 at $120 or more, for all 50 US states, DC, Puerto Rico (PR) and Guam (GU); AS, MP, VI and UM are excluded (hosted address checks pending). Multiple supplier sub-orders do not add customer shipping fees. AbilityMade pays suppliers’ shipping fees, recorded separately under agreed payment timing; do not copy the customer shipping fee onto every supplier payable. State-based customer rates are cancelled.

## Private order review register — one row per Checkout Session

| Session reference (unique) | Internal order reference | Payment verified UTC | Financial state | Recovered? | Review state (HOLD/APPROVED) | Reviewer / approval UTC | Reason / evidence reference |
| --- | --- | --- | --- | --- | --- | --- | --- |

Use the same Session reference on all supplier sub-orders. Check for an existing entry before adding anything. A missing ledger is not evidence that an order has never shipped. Hold all reconstructed orders if fulfillment history cannot be established. Never put secrets or full Stripe payloads here.

## Fulfillment — one row per supplier product allocation

| Allocation ID (unique) | Session reference | Supplier sub-order ID | Supplier ID | Product ID | Quantity | Historical customer unit cents | Customer payment UTC | Fulfillment state | Supplier notified UTC | Reviewer |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

States: HOLD, APPROVED, SENT_TO_SUPPLIER, PART_SHIPPED, SHIPPED, CANCELLED. Multiple suppliers require separate sub-order IDs. Allocation quantities across suppliers must equal purchased quantities; cancelled/refunded items require explicit review. Verify prices from the historical paid record, not today's catalog. Only the relevant supplier receives its items and necessary delivery information through an approved private channel. Keep delivery addresses and customer email in the access-controlled order system, not this general ledger template.

## Packages — one row per package and allocation

| Package ID | Allocation ID | Quantity shipped | Carrier | Tracking reference | Shipped UTC | Evidence reference |
| --- | --- | --- | --- | --- | --- | --- |

Allow multiple packages per sub-order. Total shipped quantity cannot exceed allocated quantity. Share tracking only privately; it can reveal personal delivery information. Record a shipment correction as an auditable amendment rather than erasing history.

## Monthly settlement entries — one row per shipped allocation or adjustment

| Entry ID (unique) | Allocation ID | Supplier ID | Settlement month | Currency | Shipped quantity | Agreed supplier unit cents | Base payable cents | Shipping reimbursement cents | Signed adjustment cents | Adjustment/refund reference | Net payable cents | State | Approved by / UTC | Payment batch ID |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

Use integer cents and USD initially. Base payable = eligible shipped quantity × agreed supplier unit cents. Net payable = base payable + shipping reimbursement + signed adjustment. Negative adjustments reduce the payable. Do not treat customer retail price as the supplier rate. Supplier agreements and settlement dates must be confirmed before any entry is approved. Do not pay a negative net amount automatically; carry it for human review under the agreement.

Proposed policy, pending supplier agreement: only shipped items qualify; pre-settlement refunds reduce current payables and later refunds become separately linked adjustments. Disputed, pending-refund, incomplete, or unmatched items stay on HOLD. Refunds remain manual through Stripe Dashboard. A single refund must not be deducted twice: assign a unique adjustment ID and allocate its amount across entries explicitly.

States: HOLD, DRAFT, APPROVED, PAID. Never modify a PAID row to erase a refund or correction; append a signed adjustment referencing the original entry. Before approval reconcile allocation totals, shipment evidence, previous statements, refunds, disputes, and currency. Record reviewer and time.

## Manual payment batches

| Batch ID (unique) | Supplier ID | Period | Approved entry IDs | Total cents | Approved by / UTC | Paid UTC | Non-sensitive bank/payment reference | Reconciled by / UTC |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

One settlement entry may belong to only one paid batch. Compare totals with the actual bank transaction before marking PAID. Do not store bank account details. An ambiguous bank outcome stays on HOLD until reconciled; never retry blindly.

## Example calculation (synthetic only)

Two shipped items × 1,200 supplier cents + 500 shipping cents − 300 reviewed adjustment cents = 2,600 cents ($26) payable. This is an arithmetic illustration, not a supplier agreement.

## Durability and access

The operational ledger cannot be reconstructed from Stripe. Before production, choose an existing private document location with restricted access and version history, plus a separately recoverable copy after every shipment or settlement change. Test retrieval of an earlier version. Do not depend solely on Railway's order volume or a public repository. No external document or backup is created by this template; storage choice and operational recovery remain launch requirements. Avoid adding subscriptions until existing resources are assessed.

## Owner decisions: coordination, cancellation and damage review

AbilityMade collects customer payments through Stripe, coordinates orders and pays suppliers’ shipping fees; suppliers dispatch directly. Customer shipping remains one $10 fee below $120 or free at $120+, including multiple suppliers. Approved scope is all 50 states, DC, Puerto Rico (PR) and Guam (GU); AS, MP, VI and UM are excluded, but hosted destination testing remains a launch requirement (see CUSTOMER_POLICIES_DRAFT.md). Do not treat supplier cost as the customer shipping charge or assume free customer shipping means no supplier cost.

No voluntary cancellation after purchase. Preserve legally required cancellation/refund rights, including shipment-delay remedies. Cancelling an unpaid Checkout Session is distinct from cancelling a purchased order. For arrival damage, request photos privately, record an evidence reference and review decision, and issue a justified refund manually through Stripe consistent with consumer rights. Do not put photos, addresses or customer correspondence in this ledger. Ordinary return periods, refund-processing deadlines and support-response targets remain pending approval.

### Supplier shipping payments — separate from merchandise settlement

| Shipping payment ID (unique) | Session reference | Supplier sub-order ID | Supplier ID | Package ID | Destination region (state/territory only) | Quote/invoice reference | Approved shipping cents | Actual shipping cents | Currency | Payment state (HOLD/APPROVED/PAID) | Approved by / UTC | Paid UTC | Non-sensitive payment reference | Settlement entry or exclusion reference | Reconciled by / UTC |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

Link every supplier shipping payment to its package/sub-order, shipment tracking and fulfillment state in the existing tables. Payment does not prove dispatch: mark SHIPPED only on shipment evidence. Record advance payments separately from shipped-item merchandise payables. Payment timing and approval limits must be agreed; no automated transfer is authorized. Aggregate customer shipping once per order, supplier costs per actual shipment. Split a single invoice explicitly if it covers multiple packages; never count the full invoice twice.

If shipping is paid separately, exclude it from later supplier settlement reimbursement and link the exclusion to this payment ID. If paid through a monthly batch, link the same amount/ID once to that batch rather than paying again. Preserve PAID history; append credits/adjustments for label cancellations, carrier refunds or errors. Resolve ambiguous transfers before retrying. Record actual quote-versus-cost variance, especially Alaska/Hawaii/territories, and investigate insufficient margin before accepting commitments; do not impose an unapproved customer surcharge.
