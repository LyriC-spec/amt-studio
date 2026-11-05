import React from 'react';
import {Settings2,Trash2,Monitor,RefreshCw,ShieldCheck,ArrowUpRight} from 'lucide-react';
export function JetDetails({device,info,user,onEdit,onRemove,onConnect,onInspect,onTrust}){
 return <><div className="details-top"><span>JETKVM</span><div><button className="button device-edit-button" title="Gerät bearbeiten" aria-label="Gerät bearbeiten" disabled={device.permissions&&!device.permissions.includes('manage')} onClick={onEdit}><Settings2 size={15}/>Bearbeiten</button><button className="icon-button" title="Gerät entfernen" aria-label="Gerät entfernen" onClick={onRemove}><Trash2 size={18}/></button></div></div>
 <div className="device-illustration"><div className="device-glow"/><Monitor size={80}/><span className="illustration-chip">JetKVM · HDMI + USB</span></div>
 <div className="detail-name"><h2>{device.name}</h2><span>{device.host}</span></div>
 <div className="detail-status"><span className={`badge ${info.state}`}><i/>{({online:'Erreichbar',cached:'Gespeichert',checking:'Wird geprüft',error:'Prüfen'})[info.state]||'Nicht geprüft'}</span><span>{info.checkedAt?new Date(info.checkedAt).toLocaleString('de-DE'):'Noch nicht geprüft'}</span></div>
 <button className="button primary wide" disabled={user?.role!=='admin'} onClick={onConnect}><Monitor size={16}/>KVM öffnen<ArrowUpRight size={16}/></button>
 <div className="detail-actions"><button className="button" disabled={info.state==='checking'} onClick={onInspect}><RefreshCw size={16}/>Prüfen</button></div>
 {info.error&&<div className="inline-error">{info.error}</div>}
 <div className="detail-grid"><span>Gerätetyp</span><strong>JetKVM</strong><span>Verbindung</span><strong>{device.jetProtocol?.toUpperCase()} · Port {device.jetPort}</strong><span>Kennwort</span><strong>{device.hasPassword?'Hinterlegt':'Nicht hinterlegt'}</strong><span>Gruppe</span><strong>{device.group}</strong></div>
 {device.jetProtocol==='https'&&<div className="certificate-card"><ShieldCheck size={19}/><div><strong>{device.fingerprint?'Zertifikat gespeichert':'TLS-Zertifikat'}</strong><span>{device.fingerprint?'SHA-256-Fingerabdruck hinterlegt':'Eigene Zertifikate hier bestätigen'}</span></div><button title="Zertifikat prüfen" onClick={onTrust}><ArrowUpRight size={16}/></button></div>}
 <p className="jet-detail-note">Bild, Tastatur und Maus über WebRTC im LAN oder VPN. Der Browser benötigt eine direkte Verbindung zum JetKVM. Die Konsole ist Administratoren vorbehalten.</p>
 <p className="jet-detail-note">In der Konsole findest du „Medien“ für ISO-/IMG-Dateien und „ATX“ für die angeschlossene ATX-Platine. SOL und AMT-Startoptionen gehören zu Intel-AMT-Geräten.</p>
 </>;
}
