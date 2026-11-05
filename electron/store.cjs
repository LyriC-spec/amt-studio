const fs = require('node:fs');
const path = require('node:path');
const { validateDevice } = require('./security.cjs');
class Store {
  constructor(directory, safeStorage) {
    this.directory = directory; this.safeStorage = safeStorage; this.sessionPasswords = new Map(); this.file = path.join(directory, 'devices.json');
    this.devices = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : [];
  }
  encryptionAvailable() { return this.safeStorage.isEncryptionAvailable() && (!this.safeStorage.getSelectedStorageBackend || this.safeStorage.getSelectedStorageBackend() !== 'basic_text'); }
  list() { return this.devices.map(({ encryptedPassword, ...d }) => ({ ...d, hasPassword: Boolean(encryptedPassword || this.sessionPasswords.has(d.id)) })); }
  get(id) { const d = this.devices.find(d => d.id === id); if (!d) throw new Error('Gerät nicht gefunden.'); return d; }
  save(input) {
    const valid = validateDevice(input), old = this.devices.find(d => d.id === valid.id);
    const sameIdentity = old && old.host === valid.host && old.username === valid.username && (old.kind || 'amt') === valid.kind && old.jetProtocol === valid.jetProtocol && old.jetPort === valid.jetPort;
    const record = { ...valid, groupId:input.groupId||old?.groupId, ...(sameIdentity ? { fingerprint: old.fingerprint, encryptedPassword: old.encryptedPassword, lastInspection: old.lastInspection } : {}) };
    if (!sameIdentity) this.sessionPasswords.delete(valid.id);
    if (input.password) {
      if (typeof input.password !== 'string' || input.password.length > 256) throw new Error('Kennwort ist ungültig.');
      if (input.remember && this.encryptionAvailable()) { record.encryptedPassword = this.safeStorage.encryptString(input.password).toString('base64'); this.sessionPasswords.delete(valid.id); }
      else { record.encryptedPassword = undefined; this.sessionPasswords.set(valid.id, input.password); }
    }
    this.devices = this.devices.filter(d => d.id !== record.id).concat(record); this.persist(); return this.list();
  }
  remove(id) { this.devices = this.devices.filter(d => d.id !== id); this.sessionPasswords.delete(id); this.persist(); return this.list(); }
  trust(id, fingerprint) { const device = this.get(id); if (device.fingerprint !== fingerprint) delete device.lastInspection; device.fingerprint = fingerprint; this.persist(); }
  recordInspection(device, fingerprint, info) {
    if (this.get(device.id) !== device || device.fingerprint !== fingerprint)
      throw new Error('Das Gerät wurde inzwischen geändert. Bitte erneut prüfen.');
    const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : undefined;
    // Only display metadata from a successful authenticated read, never raw SOAP or secrets.
    device.lastInspection = {
      hostName: text(info.hostName, 160), firmware: text(info.firmware, 80),
      powerState: text(info.powerState, 16),
      kvm: { EnabledByMEBx: ['true', 'false'].includes(info.kvm?.EnabledByMEBx) ? info.kvm.EnabledByMEBx : undefined },
      checkedAt: new Date().toISOString(),
    };
    this.persist();
    return device.lastInspection;
  }
  async password(id) {
    const device = this.get(id);
    if (this.sessionPasswords.has(id)) return this.sessionPasswords.get(id);
    if (device.encryptedPassword) return this.safeStorage.decryptString(Buffer.from(device.encryptedPassword, 'base64'));
    throw new Error('Bitte das Kennwort in den Gerätedetails hinterlegen.');
  }
  persist() { fs.mkdirSync(this.directory, { recursive: true }); const temp = this.file + '.tmp'; fs.writeFileSync(temp, JSON.stringify(this.devices, null, 2), { mode: 0o600 }); fs.renameSync(temp, this.file); }
}
module.exports = { Store };
