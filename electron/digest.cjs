const { createHash, randomBytes } = require('node:crypto');
const hash = (algorithm, value) => createHash(algorithm).update(value).digest('hex');
function parseChallenge(header) {
  if (!header || !/^Digest\s/i.test(header)) throw new Error('Das Gerät bietet keine unterstützte Digest-Anmeldung an.');
  const fields = {};
  for (const match of header.slice(7).matchAll(/([a-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^,\s]+))/gi)) fields[match[1].toLowerCase()] = (match[2] ?? match[3]).replace(/\\(.)/g, '$1');
  if (!fields.realm || !fields.nonce) throw new Error('Unvollständige Digest-Anfrage.');
  return fields;
}
function authorization(challenge, username, password, { method = 'POST', uri = '/wsman', nonceCount = 1, cnonce = randomBytes(16).toString('hex') } = {}) {
  const f = typeof challenge === 'string' ? parseChallenge(challenge) : challenge;
  const algorithm = (f.algorithm || 'MD5').toUpperCase();
  if (!['MD5','MD5-SESS','SHA-256','SHA-256-SESS'].includes(algorithm)) throw new Error('Digest-Algorithmus nicht unterstützt.');
  const alg = algorithm.startsWith('SHA-256') ? 'sha256' : 'md5';
  const h = value => hash(alg, value);
  const qop = f.qop ? f.qop.split(',').map(x => x.trim()).find(x => x === 'auth') : null;
  if (f.qop && !qop) throw new Error('Digest-Anmeldung benötigt qop=auth.');
  const nc = nonceCount.toString(16).padStart(8, '0');
  let ha1 = h(`${username}:${f.realm}:${password}`);
  if (algorithm.endsWith('-SESS')) ha1 = h(`${ha1}:${f.nonce}:${cnonce}`);
  const response = h(`${ha1}:${f.nonce}:${qop ? `${nc}:${cnonce}:${qop}:` : ''}${h(`${method}:${uri}`)}`);
  const quote = value => '"' + String(value).replace(/["\\]/g, '\\$&') + '"';
  const parts = [`username=${quote(username)}`, `realm=${quote(f.realm)}`, `nonce=${quote(f.nonce)}`, `uri=${quote(uri)}`, `response=${quote(response)}`, `algorithm=${algorithm}`];
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce=${quote(cnonce)}`);
  else if (algorithm.endsWith('-SESS')) parts.push(`cnonce=${quote(cnonce)}`);
  if (f.opaque) parts.push(`opaque=${quote(f.opaque)}`);
  return 'Digest ' + parts.join(', ');
}
module.exports = { parseChallenge, authorization, hash };
