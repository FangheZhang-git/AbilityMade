# AbilityMade Gmail Draft Automation

This local-only CLI parses finalized outreach Markdown or a Google Sheets approval queue, validates it, records status, and can create Gmail drafts. It has no send command and never sends email.

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

## Google Sheets approval queue

The queue uses these explicit states: `Editing`, `Approved for draft`, `Drafted`, `Approved to send`, `Sent`, `Failed`, and `Do not contact`. This version acts only on `Approved for draft`; it rejects send-state rows.

After authorization, validate the live queue without creating drafts or writing to the sheet:

```sh
npm run outreach:queue-dry-run -- --spreadsheet-id YOUR_SPREADSHEET_ID
```

Only after reviewing the exact rows and explicitly approving draft creation:

```sh
npm run outreach:queue-draft -- --spreadsheet-id YOUR_SPREADSHEET_ID --confirm-drafts
```

ChatGPT may populate or edit rows, but only the human-controlled Status cell authorizes an action. After a draft is created, inspect it in Gmail. Sending remains deliberately unimplemented until the draft workflow has been tested and the user explicitly requests the second phase.
