#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';

const EXPECTED_SENDER = 'abilitymade@gmail.com';
const COMPOSE_SCOPE = 'https://www.googleapis.com/auth/gmail.compose';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const OAUTH_SCOPES = [COMPOSE_SCOPE, SHEETS_SCOPE];
const DEFAULT_SOURCE = path.resolve(process.cwd(), '..', 'AbilityMade_Wisconsin_Partnership_Emails.md');
const DEFAULT_CREDENTIALS = path.resolve(process.cwd(), 'gmail-credentials.json');
const DEFAULT_TOKEN = path.resolve(process.cwd(), 'gmail-token.json');
const DEFAULT_LOG = path.resolve(process.cwd(), '.abilitymade-email-log.json');
const VALID_STATUSES = new Set(['not prepared', 'drafted', 'sent', 'failed']);

function usage() {
  return `Usage:
  node scripts/email-outreach.js dry-run [--file PATH] [--log PATH] [--expected-count NUMBER]
  node scripts/email-outreach.js authorize [--credentials PATH] [--token PATH]
  node scripts/email-outreach.js draft --confirm-drafts [--file PATH] [--log PATH] [--credentials PATH] [--token PATH] [--expected-count NUMBER]
  node scripts/email-outreach.js queue-dry-run --spreadsheet-id ID [--sheet-name NAME]
  node scripts/email-outreach.js queue-import --spreadsheet-id ID --file PATH --expected-count NUMBER --record-prefix PREFIX --confirm-import [--sheet-name NAME]
  node scripts/email-outreach.js queue-draft --spreadsheet-id ID --confirm-drafts [--sheet-name NAME]
  node scripts/email-outreach.js queue-send-preflight --spreadsheet-id ID --expected-send-count NUMBER [--sheet-name NAME]
  node scripts/email-outreach.js queue-send --spreadsheet-id ID --confirm-send --expected-send-count NUMBER [--sheet-name NAME]
  node scripts/email-outreach.js queue-mark-failed --spreadsheet-id ID --record-id ID --failure-reason TEXT --confirm-failure [--sheet-name NAME]

Safety: queue-send sends only previously created drafts after a full content-hash preflight.`;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, file: DEFAULT_SOURCE, credentials: DEFAULT_CREDENTIALS, token: DEFAULT_TOKEN, log: DEFAULT_LOG, expectedCount: null, expectedSendCount: null, spreadsheetId: null, sheetName: 'Outreach Queue', recordPrefix: 'WI', confirmDrafts: false, confirmImport: false, confirmSend: false, confirmFailure: false, recordId: null, failureReason: null };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--confirm-drafts') options.confirmDrafts = true;
    else if (arg === '--confirm-import') options.confirmImport = true;
    else if (arg === '--confirm-send') options.confirmSend = true;
    else if (arg === '--confirm-failure') options.confirmFailure = true;
    else if (['--file', '--credentials', '--token', '--log', '--expected-count', '--expected-send-count', '--spreadsheet-id', '--sheet-name', '--record-prefix', '--record-id', '--failure-reason'].includes(arg)) {
      const value = rest[index + 1];
      if (!value) throw new Error(`Missing value for ${arg}`);
      if (arg === '--expected-count') {
        options.expectedCount = Number(value);
        if (!Number.isInteger(options.expectedCount) || options.expectedCount < 1) throw new Error('--expected-count must be a positive integer');
      } else if (arg === '--expected-send-count') {
        options.expectedSendCount = Number(value);
        if (!Number.isInteger(options.expectedSendCount) || options.expectedSendCount < 1) throw new Error('--expected-send-count must be a positive integer');
      } else if (arg === '--spreadsheet-id') options.spreadsheetId = value.trim();
      else if (arg === '--sheet-name') options.sheetName = value;
      else if (arg === '--record-prefix') {
        options.recordPrefix = value.trim().toUpperCase();
        if (!/^[A-Z]{2,8}$/.test(options.recordPrefix)) throw new Error('--record-prefix must contain 2 to 8 ASCII letters');
      }
      else if (arg === '--record-id') options.recordId = value.trim();
      else if (arg === '--failure-reason') options.failureReason = value.trim();
      else options[arg.slice(2)] = path.resolve(value);
      index += 1;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function parseField(block, name, required = true) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`^\\*\\*${escaped}:\\*\\* (.+?)(?: {2})?$`, 'm'));
  if (!match && required) throw new Error(`Missing ${name}`);
  return match?.[1] ?? null;
}

export function parseCampaign(markdown) {
  if (typeof markdown !== 'string' || markdown.length === 0) throw new Error('Source file is empty');
  const headingPattern = /^## (\d+)\. (.+)$/gm;
  const headings = [...markdown.matchAll(headingPattern)];
  if (headings.length === 0) throw new Error('No numbered organization entries found');
  return headings.map((heading, index) => {
    const blockStart = heading.index;
    const blockEnd = headings[index + 1]?.index ?? markdown.length;
    const block = markdown.slice(blockStart, blockEnd).replace(/\n---\s*$/, '');
    const bodyMarker = /\n### Body[ \t]*\n(?:\n)?/;
    const bodyMatch = bodyMarker.exec(block);
    if (!bodyMatch) throw new Error(`Missing Body section in entry ${heading[1]}`);
    const body = block.slice(bodyMatch.index + bodyMatch[0].length).replace(/\n+$/, '');
    const entry = {
      number: Number(heading[1]),
      organization: parseField(block, 'Organization'),
      recipient: parseField(block, 'Recipient'),
      alternativeRecipient: parseField(block, 'Alternative Recipient', false),
      subject: parseField(block, 'Subject'),
      body,
    };
    if (entry.organization !== heading[2]) throw new Error(`Heading/Organization mismatch in entry ${entry.number}`);
    return entry;
  });
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validateCampaign(entries, expectedCount = null) {
  const errors = [];
  const recipientOwners = new Map();
  if (expectedCount !== null && entries.length !== expectedCount) errors.push(`Expected ${expectedCount} entries, found ${entries.length}`);
  entries.forEach((entry, index) => {
    if (entry.number !== index + 1) errors.push(`Entry numbering is not sequential at ${entry.number}`);
    for (const field of ['organization', 'recipient', 'subject', 'body']) {
      if (!entry[field]?.trim()) errors.push(`Entry ${entry.number} has an empty ${field}`);
    }
    if (!isEmail(entry.recipient)) errors.push(`Entry ${entry.number} has an invalid recipient: ${entry.recipient}`);
    if (entry.alternativeRecipient && !isEmail(entry.alternativeRecipient)) errors.push(`Entry ${entry.number} has an invalid alternative recipient`);
    if (/\r/.test(entry.body)) errors.push(`Entry ${entry.number} contains unsupported CR line endings`);
    if (/^(To|Cc|Bcc|Subject):/mi.test(entry.body)) errors.push(`Entry ${entry.number} body contains an unsafe mail header-like line`);
    const normalized = entry.recipient.toLowerCase();
    if (recipientOwners.has(normalized)) errors.push(`Duplicate recipient ${entry.recipient} in entries ${recipientOwners.get(normalized)} and ${entry.number}`);
    else recipientOwners.set(normalized, entry.number);
  });
  if (errors.length) throw new Error(`Campaign validation failed:\n- ${errors.join('\n- ')}`);
}

const QUEUE_HEADERS = [
  'Record ID', 'Status', 'Organization', 'Recipient', 'Subject', 'Body', 'Source URLs',
  'Draft ID', 'Approved Content Hash', 'Draft Content Hash', 'Result', 'Updated At', 'Error', 'Duplicate Check',
];
const QUEUE_STATUSES = new Set(['Editing', 'Approved for draft', 'Drafted', 'Approved to send', 'Sent', 'Failed', 'Do not contact']);

export function parseQueueValues(values) {
  if (!Array.isArray(values) || values.length < 1) throw new Error('Queue has no header row');
  const headers = values[0];
  if (headers.length < QUEUE_HEADERS.length || QUEUE_HEADERS.some((header, index) => headers[index] !== header)) {
    throw new Error(`Queue headers must exactly match: ${QUEUE_HEADERS.join(', ')}`);
  }
  return values.slice(1).map((row, index) => {
    const padded = [...row, ...Array(Math.max(0, QUEUE_HEADERS.length - row.length)).fill('')];
    return {
      sheetRow: index + 2,
      recordId: String(padded[0] ?? '').trim(),
      status: String(padded[1] ?? '').trim(),
      organization: String(padded[2] ?? ''),
      recipient: String(padded[3] ?? ''),
      subject: String(padded[4] ?? ''),
      body: String(padded[5] ?? ''),
      sourceUrls: String(padded[6] ?? ''),
      draftId: String(padded[7] ?? ''),
      approvedContentHash: String(padded[8] ?? ''),
      draftContentHash: String(padded[9] ?? ''),
      result: String(padded[10] ?? ''),
      updatedAt: String(padded[11] ?? ''),
      error: String(padded[12] ?? ''),
      duplicateCheck: String(padded[13] ?? ''),
    };
  }).filter((row) => row.recordId || row.organization || row.recipient || row.subject || row.body);
}

export function validateQueue(rows) {
  const errors = [];
  const recordIds = new Map();
  const recipients = new Map();
  for (const row of rows) {
    if (!row.recordId) errors.push(`Row ${row.sheetRow}: missing Record ID`);
    else if (recordIds.has(row.recordId)) errors.push(`Rows ${recordIds.get(row.recordId)} and ${row.sheetRow}: duplicate Record ID ${row.recordId}`);
    else recordIds.set(row.recordId, row.sheetRow);
    if (!QUEUE_STATUSES.has(row.status)) errors.push(`Row ${row.sheetRow}: invalid Status ${JSON.stringify(row.status)}`);
    for (const field of ['organization', 'recipient', 'subject', 'body']) {
      if (!row[field]?.trim()) errors.push(`Row ${row.sheetRow}: empty ${field}`);
    }
    if (!isEmail(row.recipient)) errors.push(`Row ${row.sheetRow}: invalid recipient ${row.recipient}`);
    const normalized = row.recipient.toLowerCase();
    if (recipients.has(normalized)) errors.push(`Rows ${recipients.get(normalized)} and ${row.sheetRow}: duplicate recipient ${row.recipient}`);
    else recipients.set(normalized, row.sheetRow);
    if (row.duplicateCheck && row.duplicateCheck !== 'OK') errors.push(`Row ${row.sheetRow}: duplicate check is ${row.duplicateCheck}`);
    if (['Drafted', 'Approved to send', 'Sent'].includes(row.status) && !row.draftId) errors.push(`Row ${row.sheetRow}: ${row.status} status requires Draft ID`);
  }
  if (errors.length) throw new Error(`Queue validation failed:\n- ${errors.join('\n- ')}`);
}

export function queueContentHash(row) {
  return createHash('sha256').update(`${row.recipient.toLowerCase()}\0${row.subject}\0${row.body}`).digest('hex');
}

function entryKey(entry) {
  return createHash('sha256').update(`${entry.recipient.toLowerCase()}\0${entry.subject}\0${entry.body}`).digest('hex');
}

function firstLine(body) {
  return body.split('\n')[0];
}

function printSummary(entries) {
  console.log(`Validated ${entries.length} entries; no duplicate primary recipients found.\n`);
  entries.forEach((entry) => {
    console.log(`${entry.number}. ${entry.organization}`);
    console.log(`   Recipient: ${entry.recipient}`);
    console.log(`   Subject: ${entry.subject}`);
    console.log(`   First line: ${firstLine(entry.body)}`);
  });
}

async function readJson(file, fallback = null) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT' && fallback !== null) return fallback;
    throw error;
  }
}

async function loadLog(file) {
  const log = await readJson(file, { version: 1, entries: {} });
  if (log.version !== 1 || typeof log.entries !== 'object' || !log.entries) throw new Error(`Invalid log file: ${file}`);
  for (const item of Object.values(log.entries)) {
    if (!VALID_STATUSES.has(item.status)) throw new Error(`Invalid status in log: ${item.status}`);
  }
  return log;
}

async function saveLog(file, log) {
  await writeFile(file, `${JSON.stringify(log, null, 2)}\n`, { mode: 0o600 });
}

function syncLog(log, entries, sourceHash) {
  for (const entry of entries) {
    const recipient = entry.recipient.toLowerCase();
    const existing = log.entries[recipient];
    if (existing && existing.contentHash !== entryKey(entry) && ['drafted', 'sent'].includes(existing.status)) {
      throw new Error(`Finalized content changed for previously ${existing.status} recipient ${entry.recipient}`);
    }
    log.entries[recipient] = {
      organization: entry.organization,
      recipient: entry.recipient,
      subject: entry.subject,
      contentHash: entryKey(entry),
      sourceHash,
      status: existing?.status ?? 'not prepared',
      draftId: existing?.draftId ?? null,
      updatedAt: existing?.updatedAt ?? null,
      error: existing?.error ?? null,
    };
  }
}

function clientConfig(credentials) {
  const config = credentials.installed;
  if (!config?.client_id || !config?.client_secret) throw new Error('OAuth credentials must be for a Google Desktop app');
  return config;
}

async function authorize(credentialsPath, tokenPath) {
  const credentials = clientConfig(await readJson(credentialsPath));
  const state = randomBytes(24).toString('hex');
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const redirectUri = `http://127.0.0.1:${address.port}`;
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.search = new URLSearchParams({ client_id: credentials.client_id, redirect_uri: redirectUri, response_type: 'code', scope: OAUTH_SCOPES.join(' '), access_type: 'offline', prompt: 'consent', state }).toString();
  console.log('Open this URL in a browser, sign in specifically as abilitymade@gmail.com, and approve access:\n');
  console.log(authUrl.toString());
  const code = await new Promise((resolve, reject) => {
    server.on('request', (request, response) => {
      const callback = new URL(request.url, redirectUri);
      if (callback.searchParams.get('state') !== state) {
        response.writeHead(400).end('Invalid OAuth state. You may close this window.');
        reject(new Error('OAuth state mismatch'));
      } else if (callback.searchParams.get('error')) {
        response.writeHead(400).end('Authorization was not completed. You may close this window.');
        reject(new Error(`OAuth error: ${callback.searchParams.get('error')}`));
      } else {
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('AbilityMade Gmail authorization complete. You may close this window.');
        resolve(callback.searchParams.get('code'));
      }
      server.close();
    });
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: credentials.client_id, client_secret: credentials.client_secret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  });
  if (!response.ok) throw new Error(`OAuth token exchange failed (${response.status})`);
  const token = await response.json();
  if (!token.refresh_token) throw new Error('Google did not return a refresh token; revoke the app grant and authorize again');
  await writeFile(tokenPath, `${JSON.stringify({ refresh_token: token.refresh_token, scope: token.scope, token_type: token.token_type }, null, 2)}\n`, { mode: 0o600 });
  console.log(`Authorization token stored locally at ${tokenPath}`);
}

async function accessToken(credentialsPath, tokenPath) {
  const credentials = clientConfig(await readJson(credentialsPath));
  const token = await readJson(tokenPath);
  if (!token.refresh_token) throw new Error('Token file has no refresh token; run authorize');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: credentials.client_id, client_secret: credentials.client_secret, refresh_token: token.refresh_token, grant_type: 'refresh_token' }),
  });
  if (!response.ok) throw new Error(`OAuth token refresh failed (${response.status})`);
  return (await response.json()).access_token;
}

async function gmailRequest(accessTokenValue, endpoint, options = {}) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${endpoint}`, {
    ...options,
    headers: { Authorization: `Bearer ${accessTokenValue}`, 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) throw new Error(`Gmail API ${endpoint} failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  return response.json();
}

async function sheetsRequest(accessTokenValue, spreadsheetId, endpoint, options = {}) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/${endpoint}`, {
    ...options,
    headers: { Authorization: `Bearer ${accessTokenValue}`, 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) throw new Error(`Google Sheets API failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  return response.json();
}

function quoteSheetName(name) {
  return `'${name.replaceAll("'", "''")}'`;
}

async function loadQueue(options, token) {
  if (!options.spreadsheetId) throw new Error('Queue commands require --spreadsheet-id');
  const range = `${quoteSheetName(options.sheetName)}!A1:N101`;
  const data = await sheetsRequest(token, options.spreadsheetId, `values/${encodeURIComponent(range)}?majorDimension=ROWS`);
  const rows = parseQueueValues(data.values ?? []);
  validateQueue(rows);
  return rows;
}

function printQueueSummary(rows) {
  console.log(`Validated ${rows.length} populated queue rows; no duplicate recipients found.\n`);
  for (const row of rows) console.log(`${row.recordId} | ${row.status} | ${row.organization} | ${row.recipient}`);
}

async function updateQueueRow(options, token, row, valuesByColumn) {
  const updates = Object.entries(valuesByColumn).map(([column, value]) => ({
    range: `${quoteSheetName(options.sheetName)}!${column}${row.sheetRow}`,
    values: [[value]],
  }));
  await sheetsRequest(token, options.spreadsheetId, 'values:batchUpdate', {
    method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: updates }),
  });
}

async function queueImport(options, rows, token) {
  if (!options.confirmImport) throw new Error('Queue import requires the explicit --confirm-import flag');
  if (!options.expectedCount) throw new Error('Queue import requires --expected-count');
  const markdown = await readFile(options.file, 'utf8');
  const entries = parseCampaign(markdown);
  validateCampaign(entries, options.expectedCount);

  const existingRecipients = new Map(rows.map((row) => [row.recipient.toLowerCase(), row.recordId]));
  for (const entry of entries) {
    const existing = existingRecipients.get(entry.recipient.toLowerCase());
    if (existing) throw new Error(`Refusing import: ${entry.recipient} already exists as ${existing}`);
  }
  const prefixPattern = new RegExp(`^${options.recordPrefix}-(\\d+)$`);
  const numericIds = rows.map((row) => prefixPattern.exec(row.recordId)?.[1]).filter(Boolean).map(Number);
  const nextNumber = numericIds.length ? Math.max(...numericIds) + 1 : 1;
  const firstRow = rows.length ? Math.max(...rows.map((row) => row.sheetRow)) + 1 : 2;
  const values = entries.map((entry, index) => {
    const sheetRow = firstRow + index;
    const recordId = `${options.recordPrefix}-${String(nextNumber + index).padStart(3, '0')}`;
    return [recordId, 'Editing', entry.organization, entry.recipient, entry.subject, entry.body, '', '', '', '', 'Imported for review; Gmail not called', new Date().toISOString(), '', `=IF(COUNTIF($D:$D,D${sheetRow})=1,"OK","DUPLICATE")`];
  });
  const range = `${quoteSheetName(options.sheetName)}!A${firstRow}:N${firstRow + values.length - 1}`;
  await sheetsRequest(token, options.spreadsheetId, 'values:batchUpdate', {
    method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: [{ range, values }] }),
  });
  console.log(`IMPORTED ${values.length} rows as ${values[0][0]} through ${values.at(-1)[0]}; all are Editing. Gmail was not called.`);
}

async function queueDraft(options, rows, token) {
  if (!options.confirmDrafts) throw new Error('Queue draft creation requires the explicit --confirm-drafts flag');
  const profile = await gmailRequest(token, 'profile');
  if (profile.emailAddress?.toLowerCase() !== EXPECTED_SENDER) throw new Error(`Refusing to create drafts: authenticated as ${profile.emailAddress}, expected ${EXPECTED_SENDER}`);
  const approved = rows.filter((row) => row.status === 'Approved for draft');
  if (approved.length === 0) return console.log('No rows are Approved for draft; no Gmail calls were made.');
  for (const row of approved) {
    if (row.draftId) throw new Error(`Row ${row.sheetRow} already has Draft ID ${row.draftId}`);
    const hash = queueContentHash(row);
    if (row.approvedContentHash && row.approvedContentHash !== hash) throw new Error(`Row ${row.sheetRow} content changed after approval; return it to Editing and approve again`);
    if (!row.approvedContentHash) {
      await updateQueueRow(options, token, row, { I: hash, L: new Date().toISOString() });
    }
    try {
      const draft = await gmailRequest(token, 'drafts', { method: 'POST', body: JSON.stringify({ message: { raw: buildRawMessage(row) } }) });
      await updateQueueRow(options, token, row, { B: 'Drafted', H: draft.id, J: hash, K: 'Draft created; inspect in Gmail', L: new Date().toISOString(), M: '' });
      console.log(`DRAFTED ${row.recordId}: ${row.recipient} (draft ${draft.id})`);
    } catch (error) {
      await updateQueueRow(options, token, row, { B: 'Failed', K: 'Draft creation failed', L: new Date().toISOString(), M: error.message });
      throw error;
    }
  }
}

function encodeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export function buildRawMessage(entry) {
  const encodedBody = Buffer.from(entry.body, 'utf8').toString('base64').match(/.{1,76}/g).join('\r\n');
  const mime = [`To: ${entry.recipient}`, `Subject: ${encodeHeader(entry.subject)}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encodedBody].join('\r\n');
  return Buffer.from(mime, 'utf8').toString('base64url');
}

function decodeMimeHeader(value) {
  return value.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, encoded) => Buffer.from(encoded, 'base64').toString('utf8'));
}

export function parseRawMessage(raw) {
  const mime = Buffer.from(raw, 'base64url').toString('utf8');
  const separator = mime.indexOf('\r\n\r\n');
  if (separator < 0) throw new Error('Draft MIME message has no header/body separator');
  const headerText = mime.slice(0, separator).replace(/\r\n[ \t]+/g, ' ');
  const headers = new Map(headerText.split('\r\n').map((line) => {
    const colon = line.indexOf(':');
    return colon < 0 ? [line.toLowerCase(), ''] : [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
  }));
  const transferEncoding = headers.get('content-transfer-encoding')?.toLowerCase();
  if (transferEncoding !== 'base64') throw new Error(`Unsupported draft transfer encoding: ${transferEncoding || 'missing'}`);
  return {
    recipient: headers.get('to') ?? '',
    subject: decodeMimeHeader(headers.get('subject') ?? ''),
    body: Buffer.from(mime.slice(separator + 4).replace(/\s/g, ''), 'base64').toString('utf8'),
  };
}

async function preflightQueueSend(options, rows, token) {
  if (!options.expectedSendCount) throw new Error('Queue sending requires --expected-send-count');
  const candidates = rows.filter((row) => row.status === 'Approved to send');
  if (candidates.length !== options.expectedSendCount) {
    throw new Error(`Refusing to send: expected ${options.expectedSendCount} Approved to send rows, found ${candidates.length}`);
  }
  const profile = await gmailRequest(token, 'profile');
  if (profile.emailAddress?.toLowerCase() !== EXPECTED_SENDER) throw new Error(`Refusing to send: authenticated as ${profile.emailAddress}, expected ${EXPECTED_SENDER}`);

  for (const row of candidates) {
    const expectedHash = queueContentHash(row);
    if (row.approvedContentHash !== expectedHash || row.draftContentHash !== expectedHash) {
      throw new Error(`Row ${row.sheetRow} content hashes do not match the current approved content`);
    }
    const draft = await gmailRequest(token, `drafts/${encodeURIComponent(row.draftId)}?format=raw`);
    const actual = parseRawMessage(draft.message?.raw ?? '');
    if (queueContentHash(actual) !== expectedHash) {
      throw new Error(`Draft ${row.recordId} no longer matches its approved recipient, subject, and body; nothing was sent`);
    }
  }
  return candidates;
}

async function queueSend(options, rows, token) {
  if (!options.confirmSend) throw new Error('Queue sending requires the explicit --confirm-send flag');
  const candidates = await preflightQueueSend(options, rows, token);
  console.log(`Preflight passed for ${candidates.length} drafts; beginning explicitly confirmed sends.`);

  for (const row of candidates) {
    try {
      const message = await gmailRequest(token, 'drafts/send', { method: 'POST', body: JSON.stringify({ id: row.draftId }) });
      await updateQueueRow(options, token, row, { B: 'Sent', K: `Sent via inspected Gmail draft (message ${message.id})`, L: new Date().toISOString(), M: '' });
      console.log(`SENT ${row.recordId}: ${row.recipient} (message ${message.id})`);
    } catch (error) {
      await updateQueueRow(options, token, row, { B: 'Failed', K: 'Send failed', L: new Date().toISOString(), M: error.message });
      throw error;
    }
  }
}

async function queueMarkFailed(options, rows, token) {
  if (!options.confirmFailure) throw new Error('Marking a delivery failure requires --confirm-failure');
  if (!options.recordId || !options.failureReason) throw new Error('Marking a delivery failure requires --record-id and --failure-reason');
  const matches = rows.filter((row) => row.recordId === options.recordId);
  if (matches.length !== 1) throw new Error(`Expected exactly one row for ${options.recordId}, found ${matches.length}`);
  const row = matches[0];
  if (row.status !== 'Sent') throw new Error(`Refusing failure update: ${row.recordId} is ${row.status}, expected Sent`);
  await updateQueueRow(options, token, row, {
    B: 'Failed',
    K: 'Delivery failed after Gmail accepted the send',
    L: new Date().toISOString(),
    M: options.failureReason,
  });
  console.log(`FAILED ${row.recordId}: ${row.recipient} — ${options.failureReason}`);
}

async function createDrafts(options, entries, log) {
  if (!options.confirmDrafts) throw new Error('Draft creation requires the explicit --confirm-drafts flag');
  const token = await accessToken(options.credentials, options.token);
  const profile = await gmailRequest(token, 'profile');
  if (profile.emailAddress?.toLowerCase() !== EXPECTED_SENDER) throw new Error(`Refusing to create drafts: authenticated as ${profile.emailAddress}, expected ${EXPECTED_SENDER}`);
  for (const entry of entries) {
    const key = entry.recipient.toLowerCase();
    const record = log.entries[key];
    if (['drafted', 'sent'].includes(record.status)) {
      console.log(`SKIP ${entry.organization}: already ${record.status}`);
      continue;
    }
    try {
      const draft = await gmailRequest(token, 'drafts', { method: 'POST', body: JSON.stringify({ message: { raw: buildRawMessage(entry) } }) });
      Object.assign(record, { status: 'drafted', draftId: draft.id, updatedAt: new Date().toISOString(), error: null });
      await saveLog(options.log, log);
      console.log(`DRAFTED ${entry.organization}: ${entry.recipient} (draft ${draft.id})`);
    } catch (error) {
      Object.assign(record, { status: 'failed', updatedAt: new Date().toISOString(), error: error.message });
      await saveLog(options.log, log);
      throw error;
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!['dry-run', 'authorize', 'draft', 'queue-dry-run', 'queue-import', 'queue-draft', 'queue-send-preflight', 'queue-send', 'queue-mark-failed'].includes(options.command)) throw new Error(usage());
  if (options.command === 'authorize') return authorize(options.credentials, options.token);
  if (['queue-dry-run', 'queue-import', 'queue-draft', 'queue-send-preflight', 'queue-send', 'queue-mark-failed'].includes(options.command)) {
    const token = await accessToken(options.credentials, options.token);
    const rows = await loadQueue(options, token);
    printQueueSummary(rows);
    if (options.command === 'queue-dry-run') return console.log('\nQUEUE DRY RUN: the sheet was read, but no Gmail API calls or sheet writes were made.');
    if (options.command === 'queue-import') return queueImport(options, rows, token);
    if (options.command === 'queue-draft') return queueDraft(options, rows, token);
    if (options.command === 'queue-mark-failed') return queueMarkFailed(options, rows, token);
    if (options.command === 'queue-send-preflight') {
      const candidates = await preflightQueueSend(options, rows, token);
      return console.log(`\nSEND PREFLIGHT PASSED: ${candidates.length} Gmail drafts match the approved queue exactly; nothing was sent.`);
    }
    return queueSend(options, rows, token);
  }
  const markdown = await readFile(options.file, 'utf8');
  const entries = parseCampaign(markdown);
  validateCampaign(entries, options.expectedCount);
  const sourceHash = createHash('sha256').update(markdown).digest('hex');
  const log = await loadLog(options.log);
  syncLog(log, entries, sourceHash);
  await saveLog(options.log, log);
  printSummary(entries);
  if (options.command === 'dry-run') {
    console.log(`\nDRY RUN: no Gmail API calls were made. Status log: ${options.log}`);
    return;
  }
  await createDrafts(options, entries, log);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => { console.error(`ERROR: ${error.message}`); process.exitCode = 1; });
}
