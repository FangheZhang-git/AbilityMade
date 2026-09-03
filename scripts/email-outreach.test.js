import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRawMessage, parseCampaign, parseQueueValues, parseRawMessage, queueContentHash, validateCampaign, validateQueue } from './email-outreach.js';

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

test('rejects duplicate queue recipients', () => {
  const rows = parseQueueValues([queueHeader,
    ['WI-001','Editing','One','hello@example.org','Subject','Body','','','','','','','','DUPLICATE'],
    ['WI-002','Editing','Two','HELLO@example.org','Subject','Body','','','','','','','','DUPLICATE'],
  ]);
  assert.throws(() => validateQueue(rows), /duplicate recipient/);
});

test('validates send-state rows when a Draft ID exists', () => {
  const rows = parseQueueValues([queueHeader, ['WI-001','Approved to send','Example Org','hello@example.org','Subject','Body','','draft-1','','','','','','OK']]);
  assert.doesNotThrow(() => validateQueue(rows));
});
