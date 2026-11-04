# AbilityMade Gmail Draft Automation

This local-only CLI parses finalized outreach Markdown or a Google Sheets approval queue, validates it, records status, creates Gmail drafts, and can send only after a second human approval and an exact-draft preflight.

## Google setup

1. Create or select a Google Cloud project.
2. Enable the Gmail API and Google Sheets API.
3. Configure Google Auth Platform. For a personal Gmail account, choose an External audience, keep the app in Testing, and add `abilitymade@gmail.com` as a test user.
4. Add the scopes `https://www.googleapis.com/auth/gmail.compose` and `https://www.googleapis.com/auth/spreadsheets`.
5. Create an OAuth client with application type **Desktop app**.
6. Download its JSON file and save it in this repository as `gmail-credentials.json`. This and the generated `gmail-token.json` are ignored by Git.
7. Run `npm run outreach:authorize`. Open the printed URL and sign in specifically as `abilitymade@gmail.com`.

Testing-mode OAuth grants for external apps can expire after seven days, so authorization may need to be repeated while the app remains in Testing.

## Commands

Dry-run with the default source file located next to this repository:

```sh
npm run outreach:dry-run
```

Use a future state file in the same format:

```sh
node scripts/email-outreach.js dry-run --file /absolute/path/to/emails.md --expected-count 12
```

Only after reviewing the dry-run and explicitly approving draft creation:

```sh
npm run outreach:draft -- --confirm-drafts
```

The draft command verifies the authenticated Gmail address, refuses recipients already marked `drafted` or `sent`, creates one draft at a time, and saves `.abilitymade-email-log.json` after each result. The four supported statuses are `not prepared`, `drafted`, `sent`, and `failed`; this draft-only version never sets `sent` itself.

## Google Sheets approval queues

There are three independent queues:

- `--queue supplier`: supplier/artisan outreach.
- `--queue hotel`: hotel, exhibition-host, and institutional-buyer outreach.
- `--queue outlet`: outlet shopping mall and outlet center outreach, stored in [AbilityMade Outlet Shopping Mall Outreach Approval Queue](https://docs.google.com/spreadsheets/d/1YXXayb0KyttQgfKsyTS28045TfNlUgGb-58NE2vI6iQ/edit).

Duplicate detection is intentionally scoped to the selected sheet only. It does not compare recipients across the supplier, hotel, and outlet queues. Historical rows remain in their queue's duplicate check, including `Sent`, `Failed`, and `Do not contact` rows. A known shared recipient may appear on multiple property-specific records only after explicit human confirmation; every matching row must carry `APPROVED SHARED RECIPIENT` in Duplicate Check or validation still blocks the queue.

Outlet records use `OUTLET-001`, `OUTLET-002`, and so forth. `--queue outlet` defaults imports and replacements to the `OUTLET` prefix; an explicit `--record-prefix OUTLET` is still recommended in reviewed command logs.

Before any drafts exist, a corrected source can replace a contiguous campaign only when every matching record is still `Editing` and has no approval hash or draft ID:

```sh
node scripts/email-outreach.js queue-replace --queue hotel --file /absolute/path/to/corrected.md --expected-count 20 --record-prefix GA --confirm-replace
```

The queue uses these explicit states: `Editing`, `Approved for draft`, `Drafted`, `Approved to send`, `Sent`, `Failed`, and `Do not contact`. Status colors are visual indicators only and never run the CLI. Any recipient, subject, or body change after approval invalidates the approval hash.

After authorization, validate the live queue without creating drafts or writing to the sheet:

```sh
npm run outreach:queue-dry-run -- --queue hotel
```

Only after reviewing the exact rows and explicitly approving draft creation:

```sh
npm run outreach:queue-draft -- --queue hotel --confirm-drafts
```

ChatGPT may populate or edit rows, but only the human-controlled Status cell authorizes an action. After a draft is created, inspect it in Gmail. Sending additionally requires `Approved to send`, a successful preflight, the expected count, and the explicit `--confirm-send` flag.

## Exact human-review workflow

1. Treat the supplied Markdown as finalized data. Preserve recipients, subjects, body text, punctuation, greetings, organization-specific wording, and any included signature exactly; do not generate missing content or add a Gmail signature.
2. Parse locally and run `dry-run` with the actual expected count. Review each record ID, organization, recipient, subject, and first body line.
3. Read the selected live queue through `A1:N1000`, verify its full history and queue-local duplicates, then import only valid new rows as `Editing`. For outlet batches, use `--queue outlet --record-prefix OUTLET`.
4. Stop for human review. Create drafts only after the exact intended rows are `Approved for draft` and the user separately requests draft creation for those exact IDs. Run `queue-dry-run` immediately before `queue-draft` and verify the eligible IDs, not just their count.
5. After the user inspects the Gmail drafts, require those exact rows to be `Approved to send` plus a separate explicit send instruction naming the intended IDs.
6. Run `queue-send-preflight` with the expected count. Verify the authenticated sender is `abilitymade@gmail.com`, the exact eligible IDs, and each live draft's recipient, subject, body, and content hash.
7. Only after preflight passes, run `queue-send` with `--confirm-send`, then re-read the selected queue and verify every successful row is `Sent`. Never resend a historical `Sent` row.
8. Gmail acceptance is not proof of final delivery. Record a confirmed later delivery failure with `queue-mark-failed`; never guess a replacement address or retry automatically.
