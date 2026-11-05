const test = require('node:test');
const assert = require('node:assert/strict');
const { authorization, parseChallenge } = require('../electron/digest.cjs');
const { validateDevice, checkPin, tlsOptions } = require('../electron/security.cjs');
const { Redirection, field } = require('../electron/redirection.cjs');
const { Wsman, envelope } = require('../electron/wsman.cjs');
const device = { id: '12345678-1234-1234-1234-123456789abc', name: 'Test', host: '127.0.0.1', username: 'admin', managementPort: 16993, redirectionPort: 16995 };

test('HTTP Digest matches the RFC 2617 reference vector', () => {
  const header = authorization('Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"', 'Mufasa', 'Circle Of Life', { method: 'GET', uri: '/dir/index.html', cnonce: '0a4f113b', nonceCount: 1 });
  assert.match(header, /response="6629fae49393a05397450978507c4ef1"/);
  assert.match(header, /qop=auth, nc=00000001/);
});
test('Digest refuses unsupported authentication and algorithms', () => {
  assert.throws(() => parseChallenge('Basic realm="x"'));
  assert.throws(() => authorization('Digest realm="r", nonce="n", algorithm="SHA-1"', 'u','p'));
  assert.throws(() => authorization('Digest realm="r", nonce="n", qop="auth-int"', 'u','p'));
  assert.match(authorization('Digest realm="r", nonce="n", algorithm="SHA-256", qop="auth"', 'u', 'p'), /response="[a-f0-9]{64}"/);
});
test('Device validation rejects URLs, paths and control characters', () => {
  for (const host of ['https://example.com','192.0.2.5/wsman','127.0.0.1:16993','host\r\nInjected: true','-host']) assert.throws(() => validateDevice({ ...device, host }));
  assert.equal(validateDevice({ ...device, host: '[::1]' }).host, '::1');
  assert.equal(validateDevice({ ...device, managementPort: 80 }).managementPort, 16993);
  assert.equal(validateDevice({ ...device, fingerprint: 'untrusted-input' }).fingerprint, undefined);
});
test('Certificate pins enforce identity and validity dates', () => {
  const cert = { fingerprint256: 'ab'.repeat(32), valid_from: '2022-01-01', valid_to: '2037-01-01' };
  checkPin(cert, 'AB:'.repeat(31) + 'AB');
  assert.throws(() => checkPin(cert, 'cd'.repeat(32)), /Zertifikat/);
  assert.throws(() => checkPin({ ...cert, valid_to: '2020-01-01' }, cert.fingerprint256), /gültig/);
  assert.equal(tlsOptions(device, 16993).rejectUnauthorized, true);
  assert.equal(tlsOptions({ ...device, fingerprint: cert.fingerprint256 }, 16993).rejectUnauthorized, false);
  assert.equal(tlsOptions(device, 16993).minVersion, 'TLSv1.2');
  assert.notEqual(tlsOptions(device, 16993).secureOptions, tlsOptions({ ...device, legacyConnect: true }, 16993).secureOptions);
});
function authReply(type, status, payload) { const head = Buffer.from([0x14,status,0,0,type,0,0,0,0]); head.writeUInt32LE(payload.length, 5); return Buffer.concat([head,payload]); }
test('KVM handshake accepts arbitrary TCP fragmentation and coalesced first framebuffer bytes', () => {
  const session = new Redirection(device, 'test-only-password');
  const sent = [], events = [];
  session.socket = { write: data => sent.push(Buffer.from(data)), destroy() {} };
  session.on('ready', () => events.push('ready')); session.on('data', data => events.push(data.toString()));
  const feed = data => { for (const byte of data) session.feed(Buffer.from([byte])); };
  feed(Buffer.from([0x11,0,0,0,0,0,0,0,0,0,0,0,0]));
  assert.equal(session.stage, 'auth-methods'); assert.equal(sent[0][4], 0);
  feed(authReply(0,0,Buffer.from([1,4])));
  assert.equal(session.stage, 'challenge');
  feed(authReply(4,1,Buffer.concat(['realm','nonce','auth'].map(field))));
  assert.equal(session.stage, 'auth-result'); assert.equal(session.password, undefined);
  assert.equal(sent[2][4], 4); assert.equal(sent[2].readUInt32LE(5), sent[2].length - 9);
  assert.ok(!sent[2].includes(Buffer.from('test-only-password')));
  feed(authReply(4,0,Buffer.alloc(0))); assert.equal(session.stage, 'kvm-start');
  session.feed(Buffer.concat([Buffer.from([0x41,0,0,0,0,0,0,0]),Buffer.from('RFB 003.008\n')]));
  assert.deepEqual(events, ['ready','RFB 003.008\n']); assert.equal(session.stage,'streaming');
  session.close(); assert.equal(session.closed,true);
});
test('KVM rejects unsupported auth, oversized frames and unexpected transitions', () => {
  const s = new Redirection(device,'p'); s.socket = { write() {}, destroy() {} }; s.stage = 'auth-methods';
  assert.throws(() => s.feed(authReply(0,0,Buffer.from([1]))), /Digest/);
  const oversized = new Redirection(device,'p'); oversized.stage = 'challenge';
  const header = Buffer.from([0x14,1,0,0,4,0xff,0xff,0xff,0xff]);
  assert.throws(() => oversized.feed(header), /Authentisierung/);
  const wrong = new Redirection(device,'p'); assert.throws(() => wrong.feed(Buffer.from([0x41,0,0,0,0,0,0,0])), /Unerwartete/);
  assert.throws(() => field('x'.repeat(256)), /lang/);
});
test('SOAP encoder escapes user-controlled selectors and addresses', () => {
  const payload = envelope(device, 'CIM_ComputerSystem', 'urn:test', '<e:Enumerate/>', { Name: '<not-a-tag>&"' });
  assert.match(payload, /&lt;not-a-tag&gt;&amp;&quot;/);
  assert.ok(!payload.includes('<not-a-tag>'));
});
test('WS-Management retries Digest once and follows enumeration contexts', async () => {
  const requests = [];
  const responses = [
    { status: 401, challenge: 'Digest realm="r", nonce="n", qop="auth"', body: '' },
    { status: 200, body: '<Envelope><Body><EnumerateResponse><EnumerationContext>abc&amp;def</EnumerationContext></EnumerateResponse></Body></Envelope>' },
    { status: 200, body: '<Envelope><Body><PullResponse><Items><AMT_GeneralSettings><HostName>lab</HostName></AMT_GeneralSettings></Items><EndOfSequence/></PullResponse></Body></Envelope>' },
  ];
  const ws = new Wsman(device, 'password', async (_device, payload, auth) => { requests.push({ payload, auth }); return responses.shift(); });
  try {
    assert.deepEqual(await ws.enumerate('AMT_GeneralSettings'), [{ HostName: 'lab' }]);
    assert.equal(requests[0].auth, undefined); assert.match(requests[1].auth, /^Digest /);
    assert.equal(requests.length, 3);
    assert.match(requests[2].payload, /<e:EnumerationContext>abc&amp;def<\/e:EnumerationContext>/);
    assert.ok(requests.every(r => !r.payload.includes('password')));
  } finally { ws.close(); }
});
test('WS-Management propagates SOAP faults and refuses XML entity declarations', async () => {
  for (const [body, expected] of [
    ['<Envelope><Body><Fault><Reason><Text xml:lang="en">Access denied</Text></Reason></Fault></Body></Envelope>', /Access denied/],
    ['<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>', /Unzulässige/],
  ]) {
    const ws = new Wsman(device,'p', async () => ({ status:200, body }));
    try { await assert.rejects(ws.enumerate('AMT_GeneralSettings'), expected); } finally { ws.close(); }
  }
});
test('Power commands use a strict allowlist and report device rejection', async () => {
  const calls = [];
  const ws = new Wsman(device, 'p', async (_d, payload) => { calls.push(payload); return { status:200, body:'<Response><ReturnValue>2</ReturnValue></Response>' }; });
  try {
    await assert.rejects(ws.power('delete'), /Unzulässige/); assert.equal(calls.length,0);
    await assert.rejects(ws.power('off'), /abgelehnt/); assert.match(calls[0], /<p:PowerState>8<\/p:PowerState>/);
  } finally { ws.close(); }
});
