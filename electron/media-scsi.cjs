// Corrections to the toolkit's removable-media responses. Images contain one
// data track; all addresses derive from the image, never a fixed floppy/CD size.
function configureMediaScsi(ider) {
  const processor = ider.dataProcessor;
  const medium = dev => dev === 0xa0 ? ider.floppy : dev === 0xb0 ? ider.cdrom : null;
  const blockSize = dev => dev === 0xa0 ? 512 : 2048;
  const fail = (dev, sense, asc) => ider.sendCommandEndResponse(false, sense, dev, asc, 0);
  const reply = (dev, cdb, feature, data) => {
    const allocation = Buffer.from(cdb, 'latin1').readUInt16BE(7);
    if (!allocation) return ider.sendCommandEndResponse(true, 0, dev, 0, 0);
    ider.sendDataToHost(dev, true, data.subarray(0, allocation).toString('latin1'), feature & 1);
  };

  processor.handleTestUnitReady = dev => {
    if (!medium(dev)) return fail(dev, 2, 0x3a);
    const ready = dev === 0xa0 ? 'floppyReady' : 'cdromReady';
    if (!ider[ready]) {
      ider[ready] = true;
      return fail(dev, 6, 0x28); // UNIT ATTENTION: medium changed.
    }
    ider.sendCommandEndResponse(true, 0, dev, 0, 0);
  };
  processor.handleWrite6 = processor.handleWrite10 = dev => fail(dev, 7, 0x27);
  const modeSense10 = processor.handleModeSense10.bind(processor);
  processor.handleModeSense10 = (dev, cdb, feature) => {
    if (!medium(dev)) return fail(dev, 2, 0x3a);
    const allocation = Buffer.from(cdb, 'latin1').readUInt16BE(7);
    if (!allocation) return ider.sendCommandEndResponse(true, 0, dev, 0, 0);
    // Retain the toolkit's capability pages, but bound its synchronous reply and
    // advertise the write protection that is enforced for every medium.
    const sendData = ider.sendDataToHost;
    ider.sendDataToHost = (_dev, _done, text) => {
      const data = Buffer.from(text, 'latin1');
      data[3] |= 0x80;
      return sendData.call(ider, dev, true, data.subarray(0, allocation).toString('latin1'), feature & 1);
    };
    try { return modeSense10(dev, cdb, feature); }
    finally { ider.sendDataToHost = sendData; }
  };
  // The toolkit dispatch drops the CDB for READ DISC INFORMATION. Keep it so
  // Linux's length-only probe and the following full probe both honor allocation.
  const dispatch = processor.handleSCSI.bind(processor);
  processor.handleSCSI = (op, dev, cdb, feature, flags) => {
    if (![0x51, 0x52].includes(op)) return dispatch(op, dev, cdb, feature, flags);
    if (dev !== 0xb0) return fail(dev, 5, 0x20);
    if (!ider.cdrom) return fail(dev, 2, 0x3a);
    if (op === 0x52) {
      const command = Buffer.from(cdb, 'latin1');
      const addressType = command[1] & 3, address = command.readUInt32BE(2);
      const sectors = Math.floor(ider.cdrom.size / 2048);
      if (addressType === 3 || (addressType === 0 ? address >= sectors : address !== 1)) return fail(dev, 5, 0x24);
      const data = Buffer.alloc(36);
      data.writeUInt16BE(34);
      data[2] = data[3] = 1; // Track/session 1.
      data[5] = 4; data[6] = 1; // Data track, Mode 1, neither blank nor writable.
      data[7] = 2; // Last recorded address valid; next writable address invalid.
      data.writeUInt32BE(sectors, 24);
      data.writeUInt32BE(sectors - 1, 28);
      return reply(dev, cdb, feature, data);
    }
    if (cdb.charCodeAt(1) & 7) return fail(dev, 5, 0x24);
    const data = Buffer.alloc(34);
    data.writeUInt16BE(32);
    data[2] = 0x0e; // Finalized read-only disc; last session complete.
    data[3] = data[4] = data[5] = data[6] = 1; // One session and one data track.
    data[7] = 0x20; // Unrestricted use; no disc ID/barcode is claimed.
    reply(dev, cdb, feature, data);
  };
  processor.handleReadCapacity = (dev, feature) => {
    const image = medium(dev);
    if (!image) return fail(dev, 2, 0x3a);
    const data = Buffer.alloc(8);
    data.writeUInt32BE(Math.floor(image.size / blockSize(dev)) - 1);
    data.writeUInt32BE(blockSize(dev), 4);
    ider.sendDataToHost(dev, true, data.toString('latin1'), feature & 1);
  };
  processor.handleReadFormatCapacities = (dev, cdb, feature) => {
    const image = medium(dev);
    if (!image) return fail(dev, 2, 0x3a);
    const data = Buffer.alloc(12);
    data[3] = 8;
    data.writeUInt32BE(Math.floor(image.size / blockSize(dev)), 4);
    data[8] = 2; // Formatted media, current capacity descriptor.
    data.writeUIntBE(blockSize(dev), 9, 3);
    reply(dev, cdb, feature, data);
  };
  processor.handleReadTOC = (dev, cdb, feature) => {
    if (dev !== 0xb0) return fail(dev, 5, 0x20);
    if (!ider.cdrom) return fail(dev, 2, 0x3a);
    const command = Buffer.from(cdb, 'latin1');
    const format = (command[2] & 0x0f) || (command[9] >> 6);
    const track = command[6], msf = Boolean(command[1] & 2);
    if (format > 1 || (format === 0 && ![0, 1, 0xaa].includes(track))) return fail(dev, 5, 0x24);
    const tracks = format === 1 ? [1] : track === 0xaa ? [0xaa] : [1, 0xaa];
    const data = Buffer.alloc(4 + tracks.length * 8);
    data.writeUInt16BE(data.length - 2);
    data[2] = data[3] = 1;
    tracks.forEach((number, index) => {
      const start = 4 + index * 8;
      const lba = number === 0xaa ? Math.floor(ider.cdrom.size / 2048) : 0;
      data[start + 1] = 0x14; // ADR 1, data track.
      data[start + 2] = number;
      if (msf) {
        const frames = lba + 150;
        // Legacy MSF minutes occupy one byte, including for DVD-sized images.
        // Do not reject Linux's probe; full capacity remains available via LBA.
        data[start + 5] = Math.floor(frames / 4500) % 256;
        data[start + 6] = Math.floor(frames / 75) % 60;
        data[start + 7] = frames % 75;
      } else data.writeUInt32BE(lba, start + 4);
    });
    reply(dev, cdb, feature, data);
  };
}

module.exports = { configureMediaScsi };
