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
    // MSF has only one byte for minutes. Large DVD images require LBA mode.
    if (msf && tracks.includes(0xaa) && Math.floor(ider.cdrom.size / 2048) + 150 >= 256 * 4500) return fail(dev, 5, 0x24);
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
        data[start + 5] = Math.floor(frames / 4500);
        data[start + 6] = Math.floor(frames / 75) % 60;
        data[start + 7] = frames % 75;
      } else data.writeUInt32BE(lba, start + 4);
    });
    reply(dev, cdb, feature, data);
  };
}

module.exports = { configureMediaScsi };
