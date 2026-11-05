const { EventEmitter } = require('node:events');
const { randomBytes } = require('node:crypto');
const { hash } = require('./digest.cjs');
const { connectTls } = require('./security.cjs');

function field(value) {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > 255) throw new Error('AMT-Anmeldefeld ist zu lang.');
  return Buffer.concat([Buffer.from([bytes.length]), bytes]);
}
function authPacket(payload, type = 4) {
  const head = Buffer.from([0x13, 0, 0, 0, type, 0, 0, 0, 0]);
  head.writeUInt32LE(payload.length, 5);
  return Buffer.concat([head, payload]);
}
class Redirection extends EventEmitter {
  constructor(device, password, protocol = 'kvm') {
    super(); this.device = device; this.password = password; this.buffer = Buffer.alloc(0); this.stage = 'opening'; this.socket = null; this.closed = false;
    if (!['kvm','sol','media'].includes(protocol)) throw new Error('Unbekanntes Redirection-Protokoll.');
    this.protocol = protocol; this.sequence = 1;
  }
  async start() {
    try {
      this.socket = await connectTls(this.device, this.device.redirectionPort);
      if (this.closed) { this.socket.destroy(); return; }
      this.socket.on('data', data => { try { this.feed(data); } catch (error) { this.fail(error); } });
      this.socket.on('error', error => this.fail(error));
      this.socket.on('close', () => this.close());
      this.timer = setTimeout(() => this.fail(new Error('Zeitüberschreitung bei der KVM-Anmeldung. Prüfe, ob eine Zustimmung am Gerät erforderlich ist.')), 20000);
      this.write(Buffer.concat([Buffer.from([0x10, this.protocol === 'kvm' ? 1 : 0, 0, 0]), Buffer.from({kvm:'KVMR',sol:'SOL ',media:'IDER'}[this.protocol])]));
    } catch (error) { this.fail(error); }
  }
  write(data) { if (!this.closed) this.socket?.write(data); }
  send(data) {
    if (!['streaming','sol-stream'].includes(this.stage) || this.closed) return;
    if (data.byteLength > 1024 * 1024) throw new Error('KVM-Nachricht ist zu groß.');
    if (this.protocol === 'sol') {
      for (let offset = 0; offset < data.byteLength; offset += 4096) { const part = Buffer.from(data).subarray(offset, offset + 4096); const head = this.serialHeader(0x28, 10); head.writeUInt16LE(part.length,8); this.write(Buffer.concat([head,part])); }
    } else this.write(Buffer.from(data));
  }
  serialHeader(command, length = 8) { const head = Buffer.alloc(length); head[0] = command; head.writeUInt32LE(this.sequence++ >>> 0,4); return head; }
  ready(stage = 'streaming') { this.stage = stage; clearTimeout(this.timer); this.emit('ready'); }
  feed(data) {
    if (this.closed) return;
    if (this.stage === 'streaming') { this.emit('data', data); return; }
    this.buffer = Buffer.concat([this.buffer, data]);
    if (this.buffer.length > 1048576) throw new Error('Ungültige AMT-Antwort.');
    while (this.buffer.length) {
      const b = this.buffer; let size;
      if (b[0] === 0x11 && this.stage === 'opening') {
        if (b.length < 4) return;
        if (b[1] !== 0) throw new Error(b[1] === 2 ? 'KVM ist bereits durch eine andere Sitzung belegt.' : b[1] === 3 ? 'Das Gerät unterstützt KVM nicht oder KVM ist deaktiviert.' : `KVM-Start abgelehnt (${b[1]}).`);
        if (b.length < 13) return;
        size = 13 + b[12]; if (b.length < size) return;
        this.stage = 'auth-methods'; this.write(authPacket(Buffer.alloc(0), 0));
      } else if (b[0] === 0x14 && ['auth-methods','challenge','auth-result'].includes(this.stage)) {
        if (b.length < 9) return;
        const length = b.readUInt32LE(5); if (length > 8192) throw new Error('Ungültige AMT-Authentisierung.');
        size = 9 + length; if (b.length < size) return;
        const status = b[1], type = b[4], payload = b.subarray(9, size);
        if (this.stage === 'auth-methods' && type === 0) {
          if (status !== 0 || !payload.includes(4)) throw new Error('KVM benötigt Digest-Authentisierung mit Nonce.');
          this.stage = 'challenge';
          this.write(authPacket(Buffer.concat([field(this.device.username), field(''), field(''), field('/RedirectionService'), field(''), field(''), field(''), field('')])));
        } else if (this.stage === 'challenge' && type === 4 && status === 1) {
          let offset = 0;
          const read = () => { if (offset >= payload.length) throw new Error('Unvollständige Digest-Challenge.'); const len = payload[offset++]; if (offset + len > payload.length) throw new Error('Unvollständige Digest-Challenge.'); const value = payload.subarray(offset, offset + len).toString('utf8'); offset += len; return value; };
          const realm = read(), nonce = read(), offeredQop = read();
          if (!offeredQop.split(',').map(x => x.trim()).includes('auth')) throw new Error('KVM-Digest benötigt qop=auth.');
          const qop = 'auth', nc = '00000001', cnonce = randomBytes(16).toString('hex'), uri = '/RedirectionService';
          const md5 = value => hash('md5', value);
          const response = md5(`${md5(`${this.device.username}:${realm}:${this.password}`)}:${nonce}:${nc}:${cnonce}:${qop}:${md5(`POST:${uri}`)}`);
          this.password = undefined; this.stage = 'auth-result';
          this.write(authPacket(Buffer.concat([this.device.username, realm, nonce, uri, cnonce, nc, response, qop].map(field))));
        } else if (this.stage === 'auth-result' && type === 4 && status === 0) {
          if (this.protocol === 'kvm') { this.stage = 'kvm-start'; this.write(Buffer.from([0x40, 0, 0, 0, 0, 0, 0, 0])); }
          else if (this.protocol === 'media') {
            const rest = b.subarray(size); this.buffer = Buffer.alloc(0); this.ready(); if (rest.length) this.emit('data',rest); return;
          } else {
            this.stage = 'sol-settings'; const settings = this.serialHeader(0x20,24);
            [10000,100,0,10000,100,0].forEach((value,i)=>settings.writeUInt16LE(value,8+i*2)); this.write(settings);
          }
        } else throw new Error('KVM-Anmeldung abgelehnt. Kennwort, KVM-Rechte und Zustimmungseinstellungen prüfen.');
      } else if (b[0] === 0x41 && this.stage === 'kvm-start') {
        if (b.length < 8) return;
        if (b[1] !== 0) throw new Error(`KVM-Freigabe abgelehnt (${b[1]}).`);
        this.ready();
        const rest = b.subarray(8); this.buffer = Buffer.alloc(0);
        if (rest.length) this.emit('data', rest);
        return;
      } else if (b[0] === 0x21 && this.stage === 'sol-settings') {
        if (b.length < 23) return; size = 23;
        const start = this.serialHeader(0x27,14); start[10]=0x1b; this.write(start); this.ready('sol-stream');
        this.keepAlive = setInterval(()=>this.write(this.serialHeader(0x2b)),2000); this.keepAlive.unref?.();
      } else if (this.stage === 'sol-stream' && [0x29,0x2a,0x2b].includes(b[0])) {
        if (b[0]===0x2b) size=8;
        else { if(b.length<10)return; size=b[0]===0x2a?10+b.readUInt16LE(8):10; }
        if(b.length<size)return;
        if(b[0]===0x2a)this.emit('data',b.subarray(10,size));
      } else throw new Error(`Unerwartete AMT-Antwort im Schritt ${this.stage}.`);
      this.buffer = this.buffer.subarray(size);
    }
  }
  fail(error) { if (this.closed) return; this.emit('failure', error); this.close(); }
  close() {
    if (this.closed) return;
    this.closed = true; this.password = undefined; clearTimeout(this.timer); clearInterval(this.keepAlive); this.socket?.destroy(); this.buffer = Buffer.alloc(0); this.emit('closed');
  }
}
module.exports = { Redirection, field, authPacket };
