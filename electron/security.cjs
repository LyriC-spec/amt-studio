const tls = require('node:tls');
const net = require('node:net');
const crypto = require('node:crypto');

function cleanText(value, name, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) throw new Error(`${name} ist ungültig.`);
  return value.trim();
}
function validateDevice(input) {
  const kind = input.kind || 'amt';
  if (!['amt', 'jetkvm'].includes(kind)) throw new Error('Unbekannter Gerätetyp.');
  const jetProtocol = input.jetProtocol || 'http';
  const jetPort = Number(input.jetPort || (jetProtocol === 'https' ? 443 : 80));
  if (kind === 'jetkvm' && (!['http','https'].includes(jetProtocol) || !Number.isInteger(jetPort) || jetPort < 1 || jetPort > 65535)) throw new Error('Ungültige JetKVM-Verbindung.');
  const host = cleanText(input.host, 'Adresse', 253).replace(/^\[|\]$/g, '');
  if (!net.isIP(host) && !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host)) throw new Error('Bitte eine IP-Adresse oder einen Hostnamen ohne Protokoll und Pfad eingeben.');
  return {
    id: typeof input.id === 'string' && /^[a-f0-9-]{36}$/.test(input.id) ? input.id : crypto.randomUUID(),
    name: cleanText(input.name, 'Gerätename'), host,
    kind, username: kind === 'jetkvm' ? 'local' : cleanText(input.username, 'Benutzername', 64),
    group: cleanText(input.group || 'Meine Geräte', 'Gruppe', 80),
    legacyConnect: input.legacyConnect === true,
    managementPort: kind === 'jetkvm' ? jetPort : 16993, redirectionPort: 16995,
    ...(kind === 'jetkvm' ? {jetProtocol, jetPort} : {}),
  };
}
function normalizeFingerprint(value) { return String(value || '').replace(/:/g, '').toLowerCase(); }
function checkPin(cert, expected) {
  const actual = normalizeFingerprint(cert.fingerprint256);
  const pin = normalizeFingerprint(expected);
  if (!/^[a-f0-9]{64}$/.test(pin) || actual !== pin) throw new Error('Das Zertifikat stimmt nicht mit dem gespeicherten SHA-256-Fingerabdruck überein. Verbindung abgebrochen.');
  const now = Date.now();
  if (!Number.isFinite(Date.parse(cert.valid_from)) || !Number.isFinite(Date.parse(cert.valid_to)) || now < Date.parse(cert.valid_from) || now > Date.parse(cert.valid_to)) throw new Error('Das AMT-Zertifikat ist noch nicht oder nicht mehr gültig.');
}
function tlsOptions(device, port) {
  return { host: device.host, port, servername: net.isIP(device.host) ? undefined : device.host, minVersion: 'TLSv1.2', rejectUnauthorized: !device.fingerprint, secureOptions: crypto.constants.SSL_OP_NO_RENEGOTIATION | (device.legacyConnect ? crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT : 0) };
}
function connectTls(device, port) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(tlsOptions(device, port));
    socket.disableRenegotiation();
    const timer = setTimeout(() => socket.destroy(new Error('Zeitüberschreitung: AMT antwortet nicht.')), 10000);
    socket.once('error', error => { clearTimeout(timer); reject(error); });
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      try { if (device.fingerprint) checkPin(socket.getPeerCertificate(), device.fingerprint); resolve(socket); }
      catch (error) { socket.destroy(); reject(error); }
    });
  });
}
// Discovery sends no credentials or AMT commands. Trust is granted separately in a native dialog.
function inspectCertificate(device) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ ...tlsOptions(device, device.managementPort), rejectUnauthorized: false });
    socket.disableRenegotiation();
    const timer = setTimeout(() => socket.destroy(new Error('AMT-TLS-Port nicht erreichbar.')), 10000);
    socket.once('error', error => { clearTimeout(timer); reject(error); });
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      const cert = socket.getPeerCertificate();
      const result = { fingerprint: cert.fingerprint256, subject: cert.subject?.CN || device.host, issuer: cert.issuer?.CN || 'Unbekannt', validFrom: cert.valid_from, validTo: cert.valid_to, authorized: socket.authorized };
      socket.destroy();
      if (!result.fingerprint) reject(new Error('Kein prüfbares Zertifikat empfangen.')); else resolve(result);
    });
  });
}
function friendlyError(error) {
  const code = error.code || '';
  if (code === 'ERR_SSL_UNSAFE_LEGACY_RENEGOTIATION_DISABLED') return { message: 'Die AMT-Firmware benötigt den TLS-Kompatibilitätsmodus. Aktiviere ihn für dieses Gerät in den Verbindungsdetails.', code: 'LEGACY_TLS' };
  if (['DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID'].includes(code)) return { message: 'AMT-Zertifikat konnte nicht bestätigt werden. Prüfe das Zertifikat in den Gerätedetails.', code: 'CERTIFICATE' };
  if (code === 'ECONNREFUSED') return { message: 'AMT-TLS-Port lehnt die Verbindung ab. Prüfe AMT-Aktivierung, TLS und Netzwerkanschluss.', code };
  if (['ENOTFOUND','EHOSTUNREACH','ENETUNREACH','ETIMEDOUT'].includes(code)) return { message: 'Gerät nicht erreichbar. Prüfe Adresse, Netzwerk oder VPN.', code };
  return { message: error.message || 'Verbindung fehlgeschlagen.', code };
}
module.exports = { validateDevice, checkPin, connectTls, tlsOptions, inspectCertificate, friendlyError };
