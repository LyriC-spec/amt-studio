import React, { useEffect, useRef, useState } from 'react';
import { Eye, Keyboard, LockKeyhole, Maximize2, Monitor, MousePointer2, RefreshCw, Unplug } from 'lucide-react';
import { AMTDesktop, DataProcessor } from '@device-management-toolkit/ui-toolkit/core';
import {KvmKeyboard,keyPacket} from './kvm-keyboard.mjs';
import {usePreferences,keyboardOptions} from './preferences.jsx';

function toBytes(text) { return Uint8Array.from(text, char => char.charCodeAt(0)); }
function binaryText(bytes) { let result = ''; for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192)); return result; }
function pointerPacket(x, y, buttons) { const bytes = new Uint8Array(6); bytes[0] = 5; bytes[1] = buttons; const view = new DataView(bytes.buffer); view.setUint16(2, x); view.setUint16(4, y); return bytes; }

export function Kvm({ session, active, onClose }) {
  const {keyboardLayout,setKeyboardLayout}=usePreferences();
  const canvas = useRef(null), surface = useRef(null), controller = useRef(null);
  const keyboard=useRef(null);
  const pendingStop=useRef(Promise.resolve({ok:true}));
  if(!keyboard.current)keyboard.current=new KvmKeyboard(bytes=>controller.current?.sendBytes(bytes));
  const [keyboardHint,setKeyboardHint]=useState('');
  const [status, setStatus] = useState('connecting'), [error, setError] = useState('');
  const [size, setSize] = useState(null), [inputEnabled, setInputEnabled] = useState(false), [focused, setFocused] = useState(false);
  const [generation, setGeneration] = useState(0), [received, setReceived] = useState(0);
  const [colorDepth, setColorDepth] = useState(16);
  const pointer = useRef({ x: 0, y: 0 }), pointerUsed = useRef(false);
  const inputAllowed = active && inputEnabled && status === 'connected';
  function releaseInput() {
    keyboard.current.release();
    const c = controller.current;
    if (pointerUsed.current) c?.sendBytes(pointerPacket(pointer.current.x, pointer.current.y, 0)); pointerUsed.current = false;
    setFocused(false);
  }
  useEffect(() => {
    if (!inputAllowed) releaseInput();
    else canvas.current?.focus();
    const release = () => releaseInput(); window.addEventListener('blur', release);
    return () => window.removeEventListener('blur', release);
  }, [inputAllowed]);
  useEffect(()=>{releaseInput();setKeyboardHint('')},[keyboardLayout]);
  useEffect(() => {
    const sessionId = crypto.randomUUID(); let disposed = false, handshake = '', bytesReceived = 0, updateTimer;
    setStatus('connecting'); setError(''); setSize(null); setReceived(0); setInputEnabled(false);
    const desktop = new AMTDesktop(canvas.current.getContext('2d'));
    desktop.bpp = colorDepth / 8; desktop.useZRLE = true;
    const comm = { send: text => {
      window.amt.sendKvm(sessionId, toBytes(text));
      if (text.charCodeAt(0) === 2 && colorDepth === 16) window.amt.sendKvm(sessionId, new Uint8Array([0,0,0,0,16,16,0,1,0,31,0,63,0,31,11,5,0,0,0,0]));
    } };
    const processor = new DataProcessor(comm, desktop);
    const sendBytes = bytes => window.amt.sendKvm(sessionId, bytes);
    desktop.onSend = comm.send;
    desktop.onStateChange = state => { if (state === 3 && !disposed) setStatus('connected'); };
    desktop.updateScreenDimensions = (width, height) => { if (!disposed) setSize({ width, height }); };
    desktop.onScreenSizeChange = desktop.updateScreenDimensions;
    desktop.onScreenResize = desktop.updateScreenDimensions;
    desktop.onKvmData = () => {};
    desktop.onProcessData = data => processor.processData(data);
    controller.current = { sendBytes, refresh: () => { const bytes = new Uint8Array(10); bytes[0] = 3; const v = new DataView(bytes.buffer); v.setUint16(6, canvas.current.width); v.setUint16(8, canvas.current.height); sendBytes(bytes); }, release: releaseInput };
    const receive = data => {
      // The toolkit assumes complete security negotiation frames. Buffer them explicitly
      // because TCP/IPC can split any field at an arbitrary byte boundary.
      if (desktop.state >= 4) { processor.processData(data); return; }
      handshake += data;
      while (desktop.state < 4) {
        const state = desktop.state;
        let needed = state === 0 ? 12 : state === 1 ? (handshake.length ? 1 + handshake.charCodeAt(0) : 1) : state === 2 ? 4 : 24;
        if (handshake.length < needed) return;
        if (state === 0 && !/^RFB \d{3}\.\d{3}\n/.test(handshake.slice(0, 12))) throw new Error('Das Gerät sendet keine gültige RFB-Begrüßung.');
        if (state === 1 && !handshake.slice(1, needed).includes('\x01')) throw new Error('RFB bietet nach AMT-Anmeldung keinen unterstützten Sicherheitsmodus.');
        if (state === 3) {
          const nameLength = ((handshake.charCodeAt(20) << 24) >>> 0) + (handshake.charCodeAt(21) << 16) + (handshake.charCodeAt(22) << 8) + handshake.charCodeAt(23);
          if (nameLength > 4096) throw new Error('Ungültiger RFB-Servername.');
          needed = 24 + nameLength; if (handshake.length < needed) return;
          const width = handshake.charCodeAt(0) * 256 + handshake.charCodeAt(1), height = handshake.charCodeAt(2) * 256 + handshake.charCodeAt(3);
          if (!width || !height || width > 8192 || height > 8192 || width * height > 16777216) throw new Error('Nicht unterstützte KVM-Auflösung.');
        }
        processor.processData(handshake.slice(0, needed)); handshake = handshake.slice(needed);
      }
      if (handshake) { processor.processData(handshake); handshake = ''; }
    };
    const unsubscribe = window.amt.onKvm(event => {
      if (event.sessionId !== sessionId || disposed) return;
      if (event.type === 'ready') { desktop.start(); setStatus('negotiating'); }
      else if (event.type === 'data') {
        try { bytesReceived += event.data.length; receive(binaryText(event.data)); }
        catch (error) { setError(error.message); setStatus('error'); void window.amt.stopKvm(sessionId); }
      } else if (event.type === 'error') { setError(event.message); setStatus('error'); }
      else if (event.type === 'closed') setStatus(old => old === 'error' ? old : 'closed');
    });
    updateTimer = setInterval(() => { if (!disposed) setReceived(bytesReceived); }, 1000);
    // Reconnect and quality changes must wait for the previous server-side stop.
    // A slow start may also finish after unmount; its cleanup must run afterwards.
    const started = pendingStop.current.then(result => {
      if (disposed) return;
      if (result?.ok === false) throw new Error(result.error || 'Die vorherige Sitzung konnte nicht beendet werden.');
      return window.amt.startKvm(session.device.id, sessionId);
    }).then(result => { if (result && !result.ok && !disposed) { setError(result.error); setStatus('error'); } })
      .catch(error => { if (!disposed) { setError(error.message); setStatus('error'); } });
    return () => { releaseInput(); disposed = true; unsubscribe(); clearInterval(updateTimer); pendingStop.current = started.then(() => window.amt.stopKvm(sessionId)).catch(error => ({ok:false,error:error.message})); controller.current = null; };
  }, [session.id, generation, colorDepth]);
  function onKey(e, down) {
    if (!inputAllowed) return;
    if (e.ctrlKey && e.altKey && e.shiftKey) { e.preventDefault(); releaseInput(); setInputEnabled(false); canvas.current.blur(); return; }
    e.preventDefault(); e.stopPropagation();
    if(keyboard.current.handle(e,down,keyboardLayout))setKeyboardHint('');
    else if(down)setKeyboardHint('Diese Taste ist in der gewählten Belegung nicht verfügbar. Bei Bedarf „Tastenpositionen unverändert“ wählen.');
  }
  function onPointer(e) {
    if (!inputAllowed) return;
    e.preventDefault(); const rect = canvas.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(canvas.current.width - 1, Math.floor((e.clientX - rect.left) * canvas.current.width / rect.width)));
    const y = Math.max(0, Math.min(canvas.current.height - 1, Math.floor((e.clientY - rect.top) * canvas.current.height / rect.height)));
    const mask = (e.buttons & 1) | ((e.buttons & 4) >> 1) | ((e.buttons & 2) << 1);
    pointer.current = { x, y }; pointerUsed.current = true; controller.current.sendBytes(pointerPacket(x, y, mask));
    if (e.type === 'pointerdown') { canvas.current.focus(); canvas.current.setPointerCapture(e.pointerId); }
  }
  function specialKeys() {
    if (!inputAllowed) return;
    for (const code of [0xffe3, 0xffe9, 0xffff]) controller.current.sendBytes(keyPacket(code, true));
    for (const code of [0xffff, 0xffe9, 0xffe3]) controller.current.sendBytes(keyPacket(code, false));
  }
  const labels = { connecting: 'AMT-Verbindung wird aufgebaut …', negotiating: 'Bildübertragung wird gestartet …', connected: 'Verbunden', error: 'Verbindung fehlgeschlagen', closed: 'Sitzung beendet' };
  const inputHint = inputEnabled ? 'Strg + Alt + Umschalt löst die Eingabe.' : session.device.permissions&&!session.device.permissions.includes('control') ? 'Nur ansehen: Dein Konto hat keine Steuerungsrechte.' : 'Nur ansehen. Hier klicken, um Tastatur und Maus freizugeben.';
  return <section className="kvm-panel amt-panel" style={{ display: active ? 'flex' : 'none' }} ref={surface}>
    <div className="kvm-toolbar compact-toolbar"><div className="console-identity"><span className={`tiny-dot ${status === 'connected' ? 'green' : ''}`} /><strong>{session.device.host}</strong><span className="kvm-status-text">{labels[status]}</span></div><div className="console-controls">
      <select className="quality-select" aria-label="Farbtiefe" title="Bildqualität: Ein Wechsel der Farbtiefe verbindet die Sitzung neu." value={colorDepth} onChange={e => setColorDepth(Number(e.target.value))}><option value={16}>16 Bit · Farbe</option><option value={8}>8 Bit · Sparsam</option></select>
      <label className="keyboard-select" title="Tastaturbelegung des Zielgeräts"><Keyboard size={15}/><select aria-label="KVM-Tastaturbelegung" value={keyboardLayout} onChange={e=>setKeyboardLayout(e.target.value)}>{keyboardOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <button className={inputEnabled ? 'input-enabled' : ''} title={inputHint} onClick={() => { releaseInput(); setInputEnabled(!inputEnabled); }} disabled={status !== 'connected'||(session.device.permissions&&!session.device.permissions.includes('control'))}>{inputEnabled ? <MousePointer2 size={16} /> : <Eye size={16} />}{inputEnabled ? 'Steuerung beenden' : 'Tastatur & Maus aktivieren'}</button><button title="Strg + Alt + Entf senden" onClick={specialKeys} disabled={!inputAllowed}><Keyboard size={16} /><span>Strg Alt Entf</span></button><button title="Bild neu anfordern" onClick={() => controller.current?.refresh()} disabled={status !== 'connected'}><RefreshCw size={16} /></button><button title="Vollbild" onClick={() => document.fullscreenElement ? document.exitFullscreen() : surface.current.requestFullscreen()}><Maximize2 size={17} /></button><button title="Verbindung trennen" onClick={onClose}><Unplug size={17} /></button>
    </div></div>
    {keyboardHint&&<div className="kvm-input-hint" role="status">{keyboardHint}</div>}<div className={`kvm-surface ${inputAllowed ? 'input-ready' : ''}`}>
      <canvas ref={canvas} tabIndex={inputAllowed ? 0 : -1} aria-label={`Remote-Bildschirm ${session.device.name}`} width={1280} height={720} style={{ visibility: status === 'connected' ? 'visible' : 'hidden' }} onKeyDown={e => onKey(e, true)} onKeyUp={e => onKey(e, false)} onPointerDown={onPointer} onPointerUp={onPointer} onPointerMove={onPointer} onPointerCancel={releaseInput} onContextMenu={e => e.preventDefault()} onFocus={() => setFocused(true)} onBlur={releaseInput} onWheel={e => { if (!inputAllowed) return; const { x, y } = pointer.current; controller.current.sendBytes(pointerPacket(x, y, e.deltaY < 0 ? 8 : 16)); controller.current.sendBytes(pointerPacket(x, y, 0)); }} />
      {status !== 'connected' && <div className="kvm-overlay"><Monitor size={38} /><h2>{labels[status]}</h2><p>{error || (status === 'closed' ? 'Du kannst die Verbindung erneut öffnen.' : 'Authentifizierung und Bildübertragung über Intel AMT.')}</p>{['error','closed'].includes(status) && <button className="button primary" onClick={() => setGeneration(g => g + 1)}><RefreshCw size={16} />Erneut verbinden</button>}</div>}
    </div><div className="kvm-footer"><span><LockKeyhole size={13} />TLS · AMT Redirection</span><span>{size ? `${size.width} × ${size.height}` : 'Auflösung wird ermittelt'}<i />{(received / 1024).toFixed(0)} KB empfangen<i />{inputEnabled ? focused ? 'Tastatur am Remote-Gerät' : 'Zum Steuern ins Bild klicken' : 'Eingabe gesperrt · Nur ansehen'}</span></div>
  </section>;
}
