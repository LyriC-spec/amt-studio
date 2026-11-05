const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

async function media(t, { kind = 'iso', size = 8192, mode = 'now', marker } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amt-media-compat-'));
  const file = path.join(dir, 'image.' + kind);
  const fd = fs.openSync(file, 'w');
  fs.ftruncateSync(fd, size);
  if (marker) fs.writeSync(fd, marker.data, 0, marker.data.length, marker.offset);
  fs.closeSync(fd);
  const worker = new Worker(path.join(__dirname, '../electron/media-worker.cjs'), {
    workerData: { file, size, kind, mode }
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
  async function next(predicate) {
    const deadline = Date.now() + 5000;
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
  function scsi(command, { dev = kind === 'iso' ? 0xb0 : 0xa0, allocation = 0, track = 0, format = 0, msf = false, lba = 0, count = 0 } = {}) {
    const b = Buffer.alloc(28);
    b[0] = 0x50; b[14] = dev & 0x10; b[16] = command;
    if (command === 0x28) { b.writeUInt32BE(lba, 18); b.writeUInt16BE(count, 23); }
    else { b[17] = msf ? 2 : 0; b[18] = format; b[22] = track; b.writeUInt16BE(allocation, 23); }
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
