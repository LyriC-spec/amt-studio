// Same-origin browser client. The session credential stays in an HttpOnly cookie.
const listeners = new Set();
let csrf = '', socket, currentUser, confirmHandler, uploadRequest;
const clientId = crypto.randomUUID();
const emit = event => listeners.forEach(listener => listener(event));
const headers = () => ({ 'X-AMT-Browser': '1', 'X-AMT-Client': clientId, ...(csrf ? { 'X-AMT-CSRF': csrf } : {}) });
const cancelled = () => ({ ok: true, data: { cancelled: true } });
export const isBrowser = !window.amt && /^https?:$/.test(location.protocol);
export function setConfirmationHandler(handler) { confirmHandler = handler; }
const ask = options => confirmHandler ? confirmHandler(options) : Promise.resolve(window.confirm(options.title + '\n\n' + options.detail));
export {ask as confirmAction};

// Upload directly through the teamserver to the selected JetKVM. Its cookie
// stays on the server; no mixed-content request or extra local file copy.
export function uploadJetMedia(sessionId,uploadId,file,{onProgress,signal}={}){
 return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();xhr.open('POST',`/api/jetkvm/upload?sessionId=${encodeURIComponent(sessionId)}&uploadId=${encodeURIComponent(uploadId)}`);
  for(const [key,value]of Object.entries(headers()))xhr.setRequestHeader(key,value);xhr.setRequestHeader('Content-Type','application/octet-stream');
  const abort=()=>xhr.abort(),cleanup=()=>signal?.removeEventListener('abort',abort);
  xhr.upload.onprogress=e=>onProgress?.(e.loaded);
  xhr.onload=()=>{cleanup();try{const result=JSON.parse(xhr.responseText);if(xhr.status===401)emit({type:'authenticationLost'});if(!result.ok)reject(new Error(result.error));else resolve(result.data)}catch{reject(new Error('Uploadantwort konnte nicht gelesen werden.'))}};
  xhr.onerror=()=>{cleanup();reject(new Error('Die Übertragung zum JetKVM wurde unterbrochen.'))};xhr.onabort=()=>{cleanup();reject(new Error('Upload abgebrochen. Eine unvollständige Datei kann im JetKVM-Speicher verbleiben.'))};
  if(signal?.aborted){reject(new Error('Upload abgebrochen.'));return}signal?.addEventListener('abort',abort,{once:true});xhr.send(file);
 });
}

async function request(route, payload, method = 'POST') {
  try {
    const response = await fetch(route, { method, credentials: 'same-origin', headers: { ...headers(), ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: JSON.stringify(payload || {}) } : {}) });
    if (response.status === 401) emit({ type: 'authenticationLost' });
    return await response.json();
  } catch { return { ok: false, error: 'Der Server ist nicht erreichbar. Bitte die Verbindung prüfen.' }; }
}
const raw = (action, payload) => request('/api/action', { action, payload });
function connectEvents() {
  return new Promise((resolve, reject) => {
    if (socket) { socket.onclose = null; socket.close(); }
    const url = new URL('/api/events', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('client', clientId);
    const ws = socket = new WebSocket(url);
    const timeout = setTimeout(() => { ws.close(); reject(new Error('Die Verbindung für Live-Sitzungen antwortet nicht.')); }, 12000);
    ws.onmessage = ({ data }) => {
      try {
        const event = JSON.parse(data);
        if (event.type === 'connected') { clearTimeout(timeout); resolve(); return; }
        if (event.data) event.data = Uint8Array.from(atob(event.data), c => c.charCodeAt(0));
        emit(event);
      } catch { ws.close(); }
    };
    ws.onclose = () => { clearTimeout(timeout); reject(new Error('Die Live-Verbindung wurde getrennt.')); emit({ type: 'teamDisconnected' }); };
    ws.onerror = () => { clearTimeout(timeout); reject(new Error('Die Live-Verbindung konnte nicht aufgebaut werden.')); };
  });
}
function chooseFile() {
  return new Promise(resolve => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.iso,.img'; input.hidden = true;
    const finish = file => { input.remove(); resolve(file); };
    input.addEventListener('change', () => finish(input.files?.[0]), { once: true });
    input.addEventListener('cancel', () => finish(null), { once: true });
    document.body.appendChild(input); input.click();
  });
}
async function upload(groupId, file) {
  if (!file) return cancelled();
  if (uploadRequest) return { ok: false, error: 'Es läuft bereits ein Upload.' };
  return new Promise(resolve => {
    const xhr = uploadRequest = new XMLHttpRequest();
    xhr.open('POST', `/api/media?groupId=${encodeURIComponent(groupId)}&name=${encodeURIComponent(file.name)}`);
    Object.entries(headers()).forEach(([key, value]) => xhr.setRequestHeader(key, value));
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = e => emit({ type: 'uploadProgress', name: file.name, loaded: e.loaded, total: e.total, percent: e.lengthComputable ? Math.round(e.loaded / e.total * 100) : 0 });
    const finish = value => { uploadRequest = null; emit({ type: 'uploadFinished' }); resolve(value); };
    xhr.onload = () => { try { if (xhr.status === 401) emit({ type: 'authenticationLost' }); finish(JSON.parse(xhr.responseText)); } catch { finish({ ok: false, error: 'Upload fehlgeschlagen.' }); } };
    xhr.onerror = () => finish({ ok: false, error: 'Der Upload wurde durch einen Verbindungsfehler unterbrochen.' });
    xhr.onabort = () => finish(cancelled());
    emit({ type: 'uploadProgress', name: file.name, loaded: 0, total: file.size, percent: 0 });
    xhr.send(file);
  });
}
async function action(name, payload = {}) {
  if (name === 'workspaceStatus') return { ok: true, data: { mode: 'team', address: location.origin, user: currentUser, browser: true } };
  if (name === 'teamLogout') return browserSession.logout();
  if (name === 'mediaAdd') return upload(payload.groupId, await chooseFile());
  if (name === 'trust') {
    const result = await raw('certificate', payload); if (!result.ok) return result;
    const cert = result.data;
    if (!await ask({ title: 'Gerätezertifikat bestätigen', detail: 'Vergleiche den Fingerabdruck mit einer vertrauenswürdigen Anzeige des Geräts.', fingerprint: cert.fingerprint, facts: { Inhaber: cert.subject, Aussteller: cert.issuer, 'Gültig bis': cert.validTo }, confirm: 'Fingerabdruck stimmt überein' })) return { ok: true, data: { trusted: false } };
    return raw('trust', { ...payload, fingerprint: cert.fingerprint });
  }
  if (['power', 'boot', 'redirectionSettings', 'startMedia'].includes(name)) {
    const result = await raw('list'); if (!result.ok) return result;
    const device = result.data.devices.find(d => d.id === payload.id); if (!device) return { ok: false, error: 'Gerät nicht gefunden.' };
    const power = { on: 'Gerät einschalten?', off: 'Gerät hart ausschalten?', restart: 'Gerät hart neu starten?' };
    const titles = { power: power[payload.action], boot: 'Einmalige Startoption speichern?', redirectionSettings: 'Umleitungsdienste aktivieren?', startMedia: 'Virtuelles Medium verbinden?' };
    const detail = name === 'power' && payload.action !== 'on' ? 'Das Betriebssystem wird nicht geordnet beendet. Nicht gespeicherte Daten können verloren gehen.' : name === 'boot' ? 'Die Vorgabe gilt für den nächsten einzelnen Start. Es wird kein Neustart ausgelöst.' : name === 'startMedia' ? 'Das Medium wird schreibgeschützt bereitgestellt. Die Browser-Sitzung muss während der Nutzung geöffnet bleiben.' : 'Die Änderung wird über Intel AMT am Gerät ausgeführt.';
    if (!await ask({ title: titles[name], detail, facts: { Gerät: device.name, Adresse: device.host }, danger: name === 'power' && payload.action !== 'on', confirm: 'Ausführen' })) return cancelled();
  }
  return raw(name, payload);
}
export const browserSession = {
  async restore() {
    const result = await request('/api/session', null, 'GET');
    if (!result.ok) throw new Error(result.error);
    if (result.data.authenticated) { csrf = result.data.csrf; currentUser = result.data.user; await connectEvents(); }
    return result.data;
  },
  async login({ username, password, token, setup }) {
    if (setup) { const created = await request('/api/setup', { username, password, token }); if (!created.ok) throw new Error(created.error); }
    const result = await request('/api/login', { username, password }); if (!result.ok) throw new Error(result.error);
    csrf = result.data.csrf; currentUser = result.data.user; await connectEvents(); return currentUser;
  },
  async logout() {
    uploadRequest?.abort(); const result = await request('/api/logout'); csrf = ''; currentUser = null;
    if (socket) { socket.onclose = null; socket.close(); socket = null; } emit({ type: 'authenticationLost' }); return result;
  },
};
if (isBrowser) window.amt = {
  browser: true, action, list: () => action('list'), save: input => action('save', input), remove: id => action('remove', { id }),
  inspect: id => action('inspect', { id }), trust: id => action('trust', { id }), power: (id, actionName) => action('power', { id, action: actionName }),
  startKvm: (id, sessionId) => action('startKvm', { id, sessionId }), stopKvm: sessionId => action('stopKvm', { sessionId }),
  sendKvm(sessionId, data) {
    if (socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 2 * 1024 * 1024) return;
    let text = ''; for (let start = 0; start < data.length; start += 8192) text += String.fromCharCode(...data.subarray(start, start + 8192));
    socket.send(JSON.stringify({ type: 'input', sessionId, data: btoa(text) }));
  },
  onKvm(callback) { listeners.add(callback); return () => listeners.delete(callback); }, cancelUpload: () => uploadRequest?.abort(),
};
