import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRawMessage, parseArgs, parseCampaign, parseQueueValues, parseRawMessage, queueContentHash, selectDraftCandidates, selectSendCandidates, validateCampaign, validateQueue } from './email-outreach.js';

const sample = `# Campaign

## 1. Example Org

**Organization:** Example Org  
**Recipient:** hello@example.org  
**Subject:** Partnership Request

### Body

Dear Example Team,

Exact body.  
Signature
`;

test('parses fields and preserves the body exactly', () => {
  const [entry] = parseCampaign(sample);
  assert.equal(entry.organization, 'Example Org');
  assert.equal(entry.recipient, 'hello@example.org');
  assert.equal(entry.subject, 'Partnership Request');
  assert.equal(entry.body, 'Dear Example Team,\n\nExact body.  \nSignature');
  validateCampaign([entry], 1);
});

test('accepts a Body heading without a blank line and preserves the body', () => {
  const compact = sample.replace('### Body\n\nDear', '### Body\nDear');
  const [entry] = parseCampaign(compact);
  assert.equal(entry.body, 'Dear Example Team,\n\nExact body.  \nSignature');
});

test('normalizes plain and escaped Markdown mailto links in bodies', () => {
  for (const mailto of ['mailto:', 'mailto\\:']) {
    const linked = sample.replace('Signature', `Email: [abilitymade@gmail.com](${mailto}abilitymade@gmail.com)`);
    const [entry] = parseCampaign(linked);
    assert.match(entry.body, /Email: abilitymade@gmail\.com$/);
  }
});

test('accepts Hotel as the organization field for buyer outreach', () => {
  const hotelSample = sample.replace('**Organization:** Example Org', '**Hotel:** Example Org');
  const [entry] = parseCampaign(hotelSample);
  assert.equal(entry.organization, 'Example Org');
});

test('accepts Outlet or Shopping Mall Name as the organization field', () => {
  const outletSample = sample.replace('**Organization:** Example Org', '**Outlet or Shopping Mall Name:** Example Org');
  const entries = parseCampaign(outletSample);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].organization, 'Example Org');
});

test('accepts Properties Covered for a consolidated outreach entry', () => {
  const consolidated = sample.replace('**Organization:** Example Org', '**Properties Covered:** Center A; Center B');
  const [entry] = parseCampaign(consolidated);
  assert.equal(entry.organization, 'Example Org');
});

test('rejects duplicate primary recipients case-insensitively', () => {
  const entries = parseCampaign(`${sample}\n\n## 2. Other Org\n\n**Organization:** Other Org  \n**Recipient:** HELLO@example.org  \n**Subject:** Other\n\n### Body\n\nDear Other Team,`);
  assert.throws(() => validateCampaign(entries, 2), /Duplicate recipient/);
});

test('MIME output contains the exact UTF-8 body', () => {
  const entry = parseCampaign(sample)[0];
  const mime = Buffer.from(buildRawMessage(entry), 'base64url').toString('utf8');
  const encodedBody = mime.split('\r\n\r\n')[1].replace(/\r\n/g, '');
  assert.equal(Buffer.from(encodedBody, 'base64').toString('utf8'), entry.body);
  assert.match(mime, /^To: hello@example\.org\r\n/);
});

test('MIME round trip preserves recipient, subject, and body for send preflight', () => {
  const entry = parseCampaign(sample)[0];
  assert.deepEqual(parseRawMessage(buildRawMessage(entry)), {
    recipient: entry.recipient,
    subject: entry.subject,
    body: entry.body,
  });
});

const queueHeader = ['Record ID','Status','Organization','Recipient','Subject','Body','Source URLs','Draft ID','Approved Content Hash','Draft Content Hash','Result','Updated At','Error','Duplicate Check'];

test('parses and validates an editing queue row', () => {
  const rows = parseQueueValues([queueHeader, ['WI-001','Editing','Example Org','hello@example.org','Subject','Dear team,','','','','','','','','OK']]);
  validateQueue(rows);
  assert.equal(rows[0].sheetRow, 2);
  assert.equal(queueContentHash(rows[0]).length, 64);
});

test('accepts the OUTLET record prefix and rejects malformed outlet IDs', () => {
  const valid = parseQueueValues([queueHeader, ['OUTLET-001','Editing','Example Org','hello@example.org','Subject','Body','','','','','','','','OK']]);
  assert.doesNotThrow(() => validateQueue(valid));
  for (const malformed of ['OUTLET-01', 'OUTLET-0001', 'outlet-001', 'OUTLET_001']) {
    const rows = parseQueueValues([queueHeader, [malformed,'Editing','Example Org','hello@example.org','Subject','Body','','','','','','','','OK']]);
    assert.throws(() => validateQueue(rows), /malformed Record ID/);
  }
});

test('rejects duplicate queue recipients', () => {
  const rows = parseQueueValues([queueHeader,
    ['WI-001','Editing','One','hello@example.org','Subject','Body','','','','','','','','DUPLICATE'],
    ['WI-002','Editing','Two','HELLO@example.org','Subject','Body','','','','','','','','DUPLICATE'],
  ]);
  assert.throws(() => validateQueue(rows), /duplicate recipient/);
});

test('allows an explicitly approved shared recipient only when every matching row is marked', () => {
  const approved = parseQueueValues([queueHeader,
    ['OUTLET-008','Editing','The Forum Peachtree Corners','john@example.org','Subject','Forum body','','','','','','','','APPROVED SHARED RECIPIENT'],
    ['OUTLET-009','Editing','Avalon','JOHN@example.org','Subject','Avalon body','','','','','','','','APPROVED SHARED RECIPIENT'],
  ]);
  assert.doesNotThrow(() => validateQueue(approved));
  approved[1].duplicateCheck = 'OK';
  assert.throws(() => validateQueue(approved), /duplicate recipient/);
});

test('validates send-state rows when a Draft ID exists', () => {
  const rows = parseQueueValues([queueHeader, ['WI-001','Approved to send','Example Org','hello@example.org','Subject','Body','','draft-1','','','','','','OK']]);
  assert.doesNotThrow(() => validateQueue(rows));
});

test('selects supplier, hotel, and outlet queues without cross-sheet coupling', () => {
  assert.equal(parseArgs(['queue-dry-run', '--queue', 'supplier']).spreadsheetId, '1sB1NgOgOp81m0z8HOopqilvA8I6srG-mht_2DZsm6cY');
  assert.equal(parseArgs(['queue-dry-run', '--queue', 'hotel']).spreadsheetId, '1nTVu5rgIYW4bdnAuNGqdngUGRpO7RKCqXwNZCWukbA0');
  const outlet = parseArgs(['queue-dry-run', '--queue', 'outlet']);
  assert.equal(outlet.spreadsheetId, '1YXXayb0KyttQgfKsyTS28045TfNlUgGb-58NE2vI6iQ');
  assert.equal(outlet.recordPrefix, 'OUTLET');
  assert.throws(() => parseArgs(['queue-dry-run', '--queue', 'hotel', '--spreadsheet-id', 'other']), /either --queue or --spreadsheet-id/);
});

test('queue duplicate detection is local to the values loaded for one selected sheet', () => {
  const outletRows = parseQueueValues([queueHeader, ['OUTLET-001','Editing','Outlet','same@example.org','Subject','Body','','','','','','','','OK']]);
  const hotelRows = parseQueueValues([queueHeader, ['GA-001','Sent','Hotel','same@example.org','Subject','Body','','draft-1','','','','','','OK']]);
  assert.doesNotThrow(() => validateQueue(outletRows));
  assert.doesNotThrow(() => validateQueue(hotelRows));
});

test('draft selection requires confirmation and the exact approval state', () => {
  const rows = parseQueueValues([queueHeader,
    ['OUTLET-001','Approved for draft','One','one@example.org','Subject','Body','','','','','','','','OK'],
    ['OUTLET-002','Editing','Two','two@example.org','Subject','Body','','','','','','','','OK'],
  ]);
  assert.throws(() => selectDraftCandidates(rows, false), /--confirm-drafts/);
  assert.deepEqual(selectDraftCandidates(rows, true).map((row) => row.recordId), ['OUTLET-001']);
});

test('send selection requires approval, exact count, and excludes Sent rows', () => {
  const hash = queueContentHash({ recipient: 'one@example.org', subject: 'Subject', body: 'Body' });
  const rows = parseQueueValues([queueHeader,
    ['OUTLET-001','Approved to send','One','one@example.org','Subject','Body','','draft-1',hash,hash,'','','','OK'],
    ['OUTLET-002','Sent','Two','two@example.org','Subject','Body','','draft-2',hash,hash,'','','','OK'],
  ]);
  assert.deepEqual(selectSendCandidates(rows, 1).map((row) => row.recordId), ['OUTLET-001']);
  assert.throws(() => selectSendCandidates(rows, 2), /found 1/);
  assert.throws(() => selectSendCandidates(rows, null), /--expected-send-count/);
});

test('requires explicit confirmation for corrected queue replacements', () => {
  const options = parseArgs(['queue-replace', '--queue', 'hotel', '--record-start', '41', '--approved-shared-recipient', 'Shared@Example.org', '--confirm-replace']);
  assert.equal(options.confirmReplace, true);
  assert.equal(options.recordStart, 41);
  assert.deepEqual(options.approvedSharedRecipients, ['shared@example.org']);
});
