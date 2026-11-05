const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class BrowserAccess {
  constructor(identity, { secure, publicOrigin, staticDirectory }) {
    this.identity = identity;
    this.secure = Boolean(secure);
    this.origin = publicOrigin ? new URL(publicOrigin).origin : null;
    this.root = path.resolve(staticDirectory);
    this.cookieName = secure ? '__Host-amt-session' : 'amt-session';
    this.csrfKey = crypto.randomBytes(32);
  }
  expectedOrigin(req) { return this.origin || `${this.secure ? 'https' : 'http'}://${req.headers.host}`; }
  checkOrigin(req, required = false) {
    if ((required && !req.headers.origin) || (req.headers.origin && req.headers.origin !== this.expectedOrigin(req))) {
      throw Object.assign(new Error('Zugriff von dieser Website ist nicht erlaubt.'), { status: 403 });
    }
  }
  cookie(req) {
    const item = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(this.cookieName + '='));
    return item?.slice(this.cookieName.length + 1);
  }
  token(req) {
    const auth = req.headers.authorization;
    const token = auth ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(auth)?.[1] : this.cookie(req);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw Object.assign(new Error('Bitte anmelden.'), { status: 401 });
    return token;
  }
  csrf(token) { return crypto.createHmac('sha256', this.csrfKey).update(token).digest('hex'); }
  authenticate(req, mutate = false) {
    const token = this.token(req);
    let user;
    try { user = this.identity.authenticate(token); } catch (error) { error.status = 401; throw error; }
    if (!req.headers.authorization && mutate) {
      this.checkOrigin(req, true);
      const expected = this.csrf(token), actual = String(req.headers['x-amt-csrf'] || '');
      if (actual.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
        throw Object.assign(new Error('Die Sitzungsprüfung ist fehlgeschlagen. Bitte die Seite neu laden.'), { status: 403 });
      }
    }
    return { token, user };
  }
  setCookie(res, token) {
    res.setHeader('Set-Cookie', `${this.cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict${this.secure ? '; Secure' : ''}${token ? '; Max-Age=28800' : '; Max-Age=0'}`);
  }
  client(req, url) {
    if (req.headers.authorization) return '';
    const id = req.headers['x-amt-client'] || url?.searchParams.get('client');
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Ungültige Browser-Sitzung. Bitte neu laden.');
    return '/' + id;
  }
  headers(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  }
  async static(req, res, url) {
    if (!['GET', 'HEAD'].includes(req.method)) return false;
    const pathname = decodeURIComponent(url.pathname);
    if (pathname !== '/' && pathname !== '/index.html' && !/^\/assets\/[a-zA-Z0-9_.-]+$/.test(pathname)) return false;
    const file = path.join(this.root, pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store');
    res.setHeader('Content-Length', fs.statSync(file).size);
    res.writeHead(200);
    if (req.method === 'HEAD') res.end(); else { const stream = fs.createReadStream(file); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res); }
    return true;
  }
}
module.exports = { BrowserAccess };
