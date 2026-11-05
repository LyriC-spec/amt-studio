const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

async function media(t, { kind = 'iso', size = 8192, mode = 'now', marker, usbCompatibility = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amt-media-compat-'));
  const file = path.join(dir, 'image.' + kind);
  const fd = fs.openSync(file, 'w');
  fs.ftruncateSync(fd, size);
  if (marker) fs.writeSync(fd, marker.data, 0, marker.data.length, marker.offset);
  fs.closeSync(fd);
  const worker = new Worker(path.join(__dirname, '../electron/media-worker.cjs'), {
    workerData: { file, size, kind, mode, usbCompatibility }
  });
  t.after(async () => { await worker.terminate(); fs.rmSync(dir, { recursive: true, force: true }); });
  const messages = [];
  let failure;
  worker.on('error', e => { failure = e; });
  worker.on('message', m => {
    if (m.type === 'send') {
      m.data = Buffer.from(m.data);
      worker.postMessage({ type: 'ack', id: m.id });
    }
    messages.push(m);
  });
  async function next(predicate, timeout = 5000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      const index = messages.findIndex(predicate);
      if (index >= 0) return messages.splice(index, 1)[0];
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('Missing media response');
  }
  const packet = async command => (await next(m => m.type === 'send' && m.data[0] === command)).data;
  let seq = 0;
  function send(data) { data.writeUInt32LE(seq++, 4); worker.postMessage({ type: 'data', data }); }
  function scsi(command, { dev = kind === 'iso' ? 0xb0 : 0xa0, allocation = 0, track = 0, format = 0, msf = false, lba = 0, count = 0, addressType = 1, dataType = 0 } = {}) {
    const b = Buffer.alloc(28);
    b[0] = 0x50; b[14] = dev & 0x10; b[16] = command;
    if (command === 0x28) { b.writeUInt32BE(lba, 18); b.writeUInt16BE(count, 23); }
    else if (command === 0x52) { b[17] = addressType; b.writeUInt32BE(lba, 18); b.writeUInt16BE(allocation, 23); }
    else { b[17] = msf ? 2 : 0; b[18] = format; b[22] = track; b.writeUInt16BE(allocation, 23); }
    if (command === 0x51) b[17] = dataType;
    send(b);
  }
  await packet(0x40);
  const open = Buffer.alloc(30);
  open[0] = 0x41; open.writeUInt16LE(8192, 16); open.writeUInt16LE(8192, 18);
  send(open);
  const features = await packet(0x48);
  return { scsi, send, packet, next, features };
}

test('Media activation uses next-boot flags rather than graceful activation', async t => {
  const m = await media(t, { mode: 'nextboot' });
  assert.equal(m.features.readUInt32LE(9), 0x09);
});

test('Optical TOC honors lead-out selection, allocation length and MSF addressing', async t => {
  const m = await media(t);
  m.scsi(0x43, { track: 0xaa, allocation: 12 });
  const leadout = (await m.packet(0x54)).subarray(34);
  assert.equal(leadout.length, 12);
  assert.equal(leadout[6], 0xaa);
  assert.equal(leadout.readUInt32BE(8), 4);
  m.scsi(0x43, { allocation: 4 });
  assert.deepEqual((await m.packet(0x54)).subarray(34), Buffer.from([0, 18, 1, 1]));
  m.scsi(0x43, { allocation: 20, msf: true });
  const toc = (await m.packet(0x54)).subarray(34);
  assert.deepEqual(toc.subarray(8, 12), Buffer.from([0, 0, 2, 0]));
  assert.deepEqual(toc.subarray(16, 20), Buffer.from([0, 0, 2, 4]));
  m.scsi(0x43, { allocation: 12, format: 1 });
  assert.equal((await m.packet(0x54)).subarray(34).length, 12);
  m.scsi(0x43, { allocation: 12, format: 2 });
  assert.equal((await m.packet(0x51))[29], 0x24);
  m.scsi(0x43, { allocation: 12, track: 2 });
  assert.equal((await m.packet(0x51))[29], 0x24);
  m.scsi(0x43, { allocation: 0 });
  assert.equal((await m.packet(0x51))[20], 0xc5);
});

for (const kind of ['iso', 'img']) test(`Format capacity describes the actual ${kind} image and respects allocation`, async t => {
  const m = await media(t, { kind });
  m.scsi(0x23, { allocation: 12 });
  const data = (await m.packet(0x54)).subarray(34);
  assert.equal(data.readUInt32BE(4), kind === 'iso' ? 4 : 16);
  assert.equal(data[8], 2);
  assert.equal(data.readUIntBE(9, 3), kind === 'iso' ? 2048 : 512);
  m.scsi(0x23, { allocation: 4 });
  assert.equal((await m.packet(0x54)).subarray(34).length, 4);
});

test('Missing media and insertion report check condition before becoming ready', async t => {
  const m = await media(t);
  m.scsi(0, { dev: 0xa0 });
  const absent = await m.packet(0x51);
  assert.equal(absent[20], 0x87); assert.equal(absent[28], 2); assert.equal(absent[29], 0x3a);
  m.scsi(0);
  const inserted = await m.packet(0x51);
  assert.equal(inserted[20], 0x87); assert.equal(inserted[28], 6); assert.equal(inserted[29], 0x28);
  m.scsi(0);
  assert.equal((await m.packet(0x51))[20], 0xc5);
});

test('Large ISO reads across 2 GiB and at the final sector preserve exact data', async t => {
  const offset = 2 ** 31 - 2048, data = Buffer.alloc(6 * 2048);
  for (let i = 0; i < data.length; i++) data[i] = i % 251;
  const m = await media(t, { size: offset + data.length, marker: { offset, data } });
  m.scsi(0x28, { lba: offset / 2048, count: 6 });
  const first = await m.packet(0x54), last = await m.packet(0x54);
  assert.equal(first[3] & 2, 0); assert.equal(last[3] & 2, 2);
  assert.deepEqual(Buffer.concat([first.subarray(34), last.subarray(34)]), data);
  m.scsi(0x25);
  assert.equal((await m.packet(0x54)).readUInt32BE(34), (offset + data.length) / 2048 - 1);
});

test('Firmware media errors are observable and bounded without stopping the stream', async t => {
  const m = await media(t);
  m.scsi(0x25);
  await m.packet(0x54);
  for (let i = 0; i < 6; i++) {
    const error = Buffer.alloc(11); error[0] = 0x4a; error[8] = 3;
    m.send(error);
  }
  for (let i = 1; i <= 5; i++) {
    const diagnostic = await m.next(message => message.type === 'diagnostic');
    assert.deepEqual(diagnostic, { type: 'diagnostic', code: 3, lastOpcode: 0x25, bytesRead: 0, protocolErrors: i });
  }
  m.scsi(0x28, { lba: 0, count: 1 });
  assert.equal((await m.packet(0x54)).subarray(34).length, 2048);
});

test('Linux optical probing gets disc information, including its two-byte length probe', async t => {
  const m = await media(t);
  m.scsi(0x51, { allocation: 2 });
  assert.deepEqual((await m.packet(0x54)).subarray(34), Buffer.from([0, 32]));
  m.scsi(0x51, { allocation: 34 });
  const info = (await m.packet(0x54)).subarray(34);
  assert.equal(info.length, 34);
  assert.equal(info[2] & 0x1f, 0x0e); // Finalized, complete session, not erasable.
  assert.deepEqual([...info.subarray(3, 7)], [1, 1, 1, 1]);
  m.scsi(0x51, { allocation: 0 });
  assert.equal((await m.packet(0x51))[20], 0xc5);
  m.scsi(0x51, { allocation: 34, dataType: 1 });
  assert.equal((await m.packet(0x51))[29], 0x24);
});

test('Track information reports the complete read-only image to Linux size probes', async t => {
  const sectors = 1500000;
  const m = await media(t, { size: sectors * 2048 });
  m.scsi(0x52, { allocation: 8, lba: 1 });
  const header = (await m.packet(0x54)).subarray(34);
  assert.equal(header.length, 8);
  assert.equal(header.readUInt16BE(0), 34);
  assert.deepEqual([...header.subarray(2)], [1, 1, 0, 4, 1, 2]);
  m.scsi(0x52, { allocation: 32, lba: 1 });
  const track = (await m.packet(0x54)).subarray(34);
  assert.equal(track.length, 32);
  assert.equal(track.readUInt32BE(8), 0);
  assert.equal(track.readUInt32BE(24), sectors);
  assert.equal(track.readUInt32BE(28), sectors - 1);
  m.scsi(0x52, { allocation: 36, addressType: 0, lba: sectors - 1 });
  assert.equal((await m.packet(0x54)).subarray(34).length, 36);
  m.scsi(0x52, { allocation: 36, lba: 2 });
  assert.equal((await m.packet(0x51))[29], 0x24);
  m.scsi(0x52, { allocation: 36, addressType: 0, lba: sectors });
  assert.equal((await m.packet(0x51))[29], 0x24);
});

test('Optical information rejects an absent disc or an incompatible drive', async t => {
  const m = await media(t, { kind: 'img' });
  for (const op of [0x51, 0x52]) {
    m.scsi(op, { dev: 0xb0, allocation: 36, lba: 1 });
    const absent = await m.packet(0x51);
    assert.equal(absent[28], 2); assert.equal(absent[29], 0x3a);
    m.scsi(op, { dev: 0xa0, allocation: 36, lba: 1 });
    assert.equal((await m.packet(0x51))[29], 0x20);
  }
});

test('DVD-size ISO accepts the Linux MSF lead-out probe while preserving full LBA capacity', async t => {
  const sectors = 1500000;
  const m = await media(t, { size: sectors * 2048 });
  m.scsi(0x43, { allocation: 12, track: 0xaa, msf: true });
  const toc = (await m.packet(0x54)).subarray(34);
  assert.equal(toc.length, 12);
  assert.equal(toc[6], 0xaa);
  assert.deepEqual([...toc.subarray(8)], [0, 77, 22, 0]);
  m.scsi(0x43, { allocation: 12, track: 0xaa });
  assert.equal((await m.packet(0x54)).readUInt32BE(42), sectors);
  m.scsi(0x25);
  assert.equal((await m.packet(0x54)).readUInt32BE(34), sectors - 1);
});

test('Idle media sends a protocol ping and continues reading after the firmware pong', async t => {
  const m = await media(t);
  const ping = await m.next(message => message.type === 'send' && message.data[0] === 0x44, 15000);
  assert.equal(ping.data.length, 8);
  const pong = Buffer.alloc(8); pong[0] = 0x45;
  m.send(pong);
  m.scsi(0x28, { lba: 0, count: 1 });
  assert.equal((await m.packet(0x54)).subarray(34).length, 2048);
});

test('USB-R companion reads only zeroes, bounds reads and rejects writes without exposing ISO bytes', async t => {
  const iso = Buffer.alloc(2048, 0x6b);
  const m = await media(t, { usbCompatibility: true, marker: { offset: 0, data: iso } });
  m.scsi(0x25, { dev: 0xa0 });
  const capacity = (await m.packet(0x54)).subarray(34);
  assert.equal(capacity.readUInt32BE(0), 2879); assert.equal(capacity.readUInt32BE(4), 512);
  m.scsi(0x28, { dev: 0xa0, lba: 0, count: 20 });
  assert.deepEqual((await m.packet(0x54)).subarray(34), Buffer.alloc(8192));
  assert.deepEqual((await m.packet(0x54)).subarray(34), Buffer.alloc(2048));
  m.scsi(0x28, { dev: 0xa0, lba: 2879, count: 1 });
  assert.deepEqual((await m.packet(0x54)).subarray(34), Buffer.alloc(512));
  m.scsi(0x28, { dev: 0xa0, lba: 2880, count: 1 });
  assert.equal((await m.packet(0x51))[29], 0x21);
  m.scsi(0x2a, { dev: 0xa0 });
  const denied = await m.packet(0x51);
  assert.equal(denied[28], 7); assert.equal(denied[29], 0x27);
  m.scsi(0x28, { lba: 0, count: 1 });
  assert.deepEqual((await m.packet(0x54)).subarray(34), iso);
});

test('Mode sense bounds short Linux probes and marks virtual media write protected', async t => {
  const m = await media(t, { usbCompatibility: true });
  for (const dev of [0xa0, 0xb0]) {
    for (const allocation of [4, 8]) {
      m.scsi(0x5a, { dev, allocation, format: 0x3f });
      const data = (await m.packet(0x54)).subarray(34);
      assert.equal(data.length, allocation);
      assert.equal(data[3] & 0x80, 0x80);
    }
    m.scsi(0x5a, { dev, allocation: 0, format: 0x3f });
    assert.equal((await m.packet(0x51))[20], 0xc5);
  }
  m.scsi(0x28, { lba: 0, count: 1 });
  assert.equal((await m.packet(0x54)).subarray(34).length, 2048);
});
