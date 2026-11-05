import React,{useEffect,useRef,useState} from 'react';
import {Disc3,Power,RefreshCw,Upload,X,Trash2,Unplug} from 'lucide-react';
import {confirmAction,uploadJetMedia} from './browser-client.js';
import {mediaFilename,mediaUrl} from './jetkvm-rpc.mjs';
import './jetkvm-tools.css';
const bytes=n=>{if(!Number.isFinite(n))return 'Unbekannt';return n>=1024**3?`${(n/1024**3).toFixed(2)} GiB`:n>=1024**2?`${(n/1024**2).toFixed(1)} MiB`:`${n} Byte`};
async function confirm(options){if(document.fullscreenElement)await document.exitFullscreen();return confirmAction(options)}
export function JetTools({client,sessionId,device,panel,onClose}){
 const [files,setFiles]=useState([]),[space,setSpace]=useState(null),[mounted,setMounted]=useState(null),[extension,setExtension]=useState(null),[atx,setAtx]=useState(null),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[uploading,setUploading]=useState(false),[progress,setProgress]=useState(0);
 const [file,setFile]=useState(null),[name,setName]=useState(''),[url,setUrl]=useState(''),[mode,setMode]=useState('CDROM');
 const current=useRef(client),transfer=useRef(),fileInput=useRef();current.current=client;
 const ready=!!client&&!client.closed&&client.channel.readyState==='open',disabled=busy||uploading||!ready;
 const facts={Gerät:device.name,Adresse:device.host};
 async function refresh(rpc=client){
  if(!rpc||rpc.closed)return;
  const reads=await Promise.allSettled([rpc.request('getVirtualMediaState'),rpc.request('listStorageFiles'),rpc.request('getStorageSpace'),rpc.request('getActiveExtension')]);
  if(current.current!==rpc||rpc.closed)return;
  if(reads[0].status==='fulfilled'){setMounted(reads[0].value);setLoaded(true)}
  if(reads[1].status==='fulfilled')setFiles(Array.isArray(reads[1].value?.files)?reads[1].value.files:[]);
  if(reads[2].status==='fulfilled')setSpace(reads[2].value);
  if(reads[3].status==='fulfilled'){setExtension(reads[3].value);if(reads[3].value==='atx-power'){try{const state=await rpc.request('getATXState');if(current.current===rpc&&!rpc.closed)setAtx(state)}catch(e){if(current.current===rpc)setError(e.message)}}else setAtx(null)}
  const failures=reads.filter(r=>r.status==='rejected');if(failures.length)setError(failures.map(r=>r.reason.message).join(' · '));
 }
 useEffect(()=>{setLoaded(false);setFiles([]);setSpace(null);setMounted(null);setExtension(null);setAtx(null);setError('');setNotice('');setBusy(false);setUploading(false);return()=>{transfer.current?.abort()}},[client]);
 useEffect(()=>{if(!ready||!panel)return;let stopped=false,running=false;const update=async()=>{if(stopped||running)return;running=true;try{await refresh(client)}finally{running=false}};void update();const timer=setInterval(()=>{if(!document.hidden)void update()},5000);const unsub=client.subscribe(message=>{if(message.method==='atxState')setAtx(message.params)});return()=>{stopped=true;clearInterval(timer);unsub()}},[client,panel,ready]);
 async function run(fn){if(disabled)return;const rpc=client;setBusy(true);setError('');setNotice('');try{await fn(rpc);if(current.current===rpc&&!rpc.closed)await refresh(rpc)}catch(e){if(current.current===rpc)setError(e.message)}finally{if(current.current===rpc)setBusy(false)}}
 async function mount(source){await run(async rpc=>{
  const params=source==='url'?{url:mediaUrl(url.trim()),mode}:{filename:mediaFilename(source),mode};
  const state=await rpc.request('getVirtualMediaState');if(state)throw new Error('Zuerst das aktuell verbundene Medium auswerfen.');
  if(!await confirm({title:'Virtuelles Medium verbinden?',detail:'Das Abbild erscheint am angeschlossenen Rechner als USB-Laufwerk. Beim Wechsel zwischen CD/DVD und Disk kann JetKVM die USB-Verbindung kurz neu aufbauen. Ein Neustart wird nicht ausgelöst.',facts:{...facts,Medium:params.filename||params.url,Modus:mode==='CDROM'?'CD/DVD':'Disk'},confirm:'Medium verbinden'}))return;
  await rpc.request(source==='url'?'mountWithHTTP':'mountWithStorage',params,45000);if(current.current===rpc)setNotice('Medium verbunden.');
 })}
 async function unmount(){await run(async rpc=>{if(!await confirm({title:'Medium auswerfen?',detail:'Beende vorher laufende Zugriffe auf das virtuelle Laufwerk.',facts,confirm:'Auswerfen'}))return;await rpc.request('unmountImage',{},30000);setNotice('Medium ausgeworfen.')})}
 async function remove(filename){await run(async rpc=>{const state=await rpc.request('getVirtualMediaState');if(state?.filename===filename)throw new Error('Ein verbundenes Medium muss zuerst ausgeworfen werden.');if(!await confirm({title:'Datei vom JetKVM löschen?',detail:'Die Datei wird aus dem Speicher dieses JetKVM entfernt.',facts:{...facts,Datei:filename},danger:true,confirm:'Datei löschen'}))return;await rpc.request('deleteStorageFile',{filename});setNotice('Datei gelöscht.')})}
 async function power(action){await run(async rpc=>{
  if(await rpc.request('getActiveExtension')!=='atx-power')throw new Error('Die ATX-Erweiterung ist nicht ausgewählt.');
  const options={'power-short':{title:'Power-Taste kurz drücken?',detail:'Entspricht einem kurzen Druck auf die Power-Taste. Je nach Zustand und Betriebssystem wird der Rechner eingeschaltet, heruntergefahren oder in den Ruhezustand versetzt.',confirm:'Power-Taste drücken'},'power-long':{title:'Power-Taste 5 Sekunden halten?',detail:'Kann den Rechner hart ausschalten. Nicht gespeicherte Daten können verloren gehen.',confirm:'5 Sekunden drücken',danger:true},reset:{title:'Reset-Taste drücken?',detail:'Der Rechner wird ohne geordnetes Herunterfahren neu gestartet. Nicht gespeicherte Daten können verloren gehen.',confirm:'Reset ausführen',danger:true}};
  if(!await confirm({...options[action],facts}))return;await rpc.request('setATXPowerAction',{action});setNotice('JetKVM hat den Tastendruck ausgeführt.');
 })}
 async function activateAtx(){await run(async rpc=>{const active=await rpc.request('getActiveExtension');if(!await confirm({title:'ATX-Erweiterung auswählen?',detail:'Nur fortfahren, wenn eine ATX-Platine angeschlossen und verkabelt ist. Die bisher ausgewählte Erweiterung wird dadurch deaktiviert.',facts:{...facts,'Bisherige Erweiterung':active||'Keine'},confirm:'ATX auswählen'}))return;await rpc.request('setActiveExtension',{extensionId:'atx-power'});setNotice('ATX-Erweiterung ausgewählt.')})}
 async function upload(){
  if(disabled||!file)return;const rpc=client,abort=new AbortController();transfer.current=abort;setUploading(true);setError('');setNotice('');setProgress(0);
  try{
   const filename=mediaFilename(name.trim());if(file.size<512||file.size>64*1024**3)throw new Error('Bitte ein ISO-/IMG-Abbild zwischen 512 Byte und 64 GiB wählen.');
   const existing=await rpc.request('listStorageFiles');if(existing?.files?.some(f=>f.filename===filename||f.filename===filename+'.incomplete'))throw new Error('Dieser Dateiname existiert bereits. Wähle einen anderen Namen oder lösche die vorhandene unvollständige Datei.');
   const storage=await rpc.request('getStorageSpace');if(storage.bytesFree<file.size)throw new Error('Auf dem JetKVM ist nicht genügend Speicher frei.');
   if(abort.signal.aborted)throw new Error('Upload abgebrochen.');const prepared=await rpc.request('startStorageFileUpload',{filename,size:file.size});
   if(prepared.alreadyUploadedBytes!==0||!/^upload_[a-f0-9-]{36}$/.test(prepared.dataChannel||''))throw new Error('JetKVM meldet einen vorhandenen oder ungültigen Upload. Unvollständige Datei prüfen.');
   await uploadJetMedia(sessionId,prepared.dataChannel,file,{signal:abort.signal,onProgress:loaded=>{if(current.current===rpc)setProgress(Math.min(100,Math.round(loaded/file.size*100)))}});
   let saved=false;for(let attempt=0;attempt<5;attempt++){if(abort.signal.aborted)throw new Error('Upload abgebrochen.');const result=await rpc.request('listStorageFiles');if(result.files?.some(f=>f.filename===filename&&f.size===file.size)){saved=true;break}await new Promise(resolve=>setTimeout(resolve,250))}if(!saved)throw new Error('Upload wurde übertragen, aber die vollständige Datei ist noch nicht bestätigt. Bitte aktualisieren.');
   if(current.current===rpc){setNotice('Datei auf JetKVM gespeichert. Sie wurde noch nicht als Laufwerk verbunden.');setFile(null);setName('');if(fileInput.current)fileInput.current.value='';await refresh(rpc)}
  }catch(e){if(current.current===rpc)setError(e.message)}finally{if(current.current===rpc)setUploading(false);if(transfer.current===abort)transfer.current=null}
 }
 return <section className="jet-tools" aria-label={panel==='atx'?'JetKVM ATX-Steuerung':'JetKVM Medien'} style={{display:panel?'block':'none'}}>
  <div className="jet-tools-heading"><strong>{panel==='atx'?<><Power size={17}/>ATX-Steuerung</>:<><Disc3 size={17}/>Virtuelle Medien</>}</strong><div><button className="icon-button" title="JetKVM-Funktionen aktualisieren" disabled={disabled} onClick={()=>run(()=>Promise.resolve())}><RefreshCw size={16}/></button><button className="icon-button" title="Werkzeuge schließen" onClick={onClose}><X size={16}/></button></div></div>
  {!ready&&<p className="jet-tool-note">Verbinde die JetKVM-Konsole, um diese Funktionen zu verwenden.</p>}
  {error&&<div className="inline-error" role="alert">{error}</div>}{notice&&<p className="jet-tool-notice" role="status">{notice}</p>}
  {panel==='atx'?<>
   <div className="jet-atx-status"><span>Erweiterung <strong>{extension===null?'Wird geprüft …':extension==='atx-power'?'ATX ausgewählt':extension||'Keine'}</strong></span>{extension==='atx-power'&&<><span><i className={atx?.power?'lit':''}/>Power-LED: {atx===null?'Unbekannt':atx.power?'An':'Aus'}</span><span><i className={atx?.hdd?'lit':''}/>Laufwerks-LED: {atx===null?'Unbekannt':atx.hdd?'An':'Aus'}</span></>}</div>
   {extension==='atx-power'?<><div className="jet-tool-actions"><button className="button" disabled={disabled} onClick={()=>power('power-short')}>Power-Taste kurz</button><button className="button" disabled={disabled} onClick={()=>power('power-long')}>Power-Taste 5 s</button><button className="button" disabled={disabled} onClick={()=>power('reset')}>Reset-Taste</button></div><p className="jet-tool-note">Die Anzeigen entsprechen den verkabelten LEDs. Eine dunkle LED bestätigt nicht, dass der Rechner ausgeschaltet ist. Vor jedem Tastendruck folgt eine Bestätigung.</p></>:<><p className="jet-tool-note">Für diese Funktion ist eine angeschlossene JetKVM-ATX-Platine nötig.</p><button className="button" disabled={disabled||extension===null} onClick={activateAtx}>ATX-Erweiterung auswählen</button></>}
  </>:<>
   <div className="jet-media-status"><div><strong>{!loaded?'Medienstatus wird geprüft …':mounted?'Medium verbunden':'Kein Medium verbunden'}</strong>{mounted&&<span>{mounted.filename||mounted.url||mounted.source} · {mounted.mode==='CDROM'?'CD/DVD':'Disk'} · {bytes(mounted.size)}</span>}</div>{mounted&&<button className="button" disabled={disabled} onClick={unmount}><Unplug size={15}/>Auswerfen</button>}<small>{space?`${bytes(space.bytesFree)} frei auf JetKVM`:'Speicher wird geprüft …'}</small></div>
   <div className="jet-media-grid"><div><label className="jet-mode">Laufwerkstyp<select aria-label="JetKVM-Laufwerkstyp" value={mode} onChange={e=>setMode(e.target.value)} disabled={disabled}><option value="CDROM">CD/DVD · ISO</option><option value="Disk">Disk · IMG</option></select></label>
    <div className="jet-file-list">{files.length?files.map(f=><div className="jet-file" key={f.filename}><div><strong>{f.filename}</strong><small>{bytes(f.size)}{f.filename.endsWith('.incomplete')?' · Unvollständig':''}</small></div><button className="button" disabled={disabled||!loaded||!!mounted||!/^.+\.(iso|img)$/i.test(f.filename)} onClick={()=>mount(f.filename)}>Verbinden</button><button className="icon-button" title={`Datei ${f.filename} löschen`} disabled={disabled||!loaded||mounted?.filename===f.filename} onClick={()=>remove(f.filename)}><Trash2 size={16}/></button></div>):<p className="jet-tool-note">Noch keine Dateien auf diesem JetKVM.</p>}</div>
   </div><div className="jet-media-sources"><form onSubmit={e=>{e.preventDefault();void upload()}}><label>Datei vom Computer<input ref={fileInput} aria-label="JetKVM-Mediendatei" type="file" accept=".iso,.img" disabled={disabled} onChange={e=>{setFile(e.target.files?.[0]||null);setName(e.target.files?.[0]?.name||'')}}/></label>{file&&<label>Dateiname auf JetKVM<input aria-label="Dateiname auf JetKVM" value={name} maxLength={180} disabled={disabled} onChange={e=>setName(e.target.value)}/></label>}<div className="jet-tool-actions"><button type="submit" className="button" disabled={disabled||!file}><Upload size={15}/>Auf JetKVM hochladen</button>{uploading&&<button type="button" className="button" onClick={()=>transfer.current?.abort()}>Upload abbrechen</button>}</div>{uploading&&<div className="jet-upload-progress" role="status"><progress value={progress} max={100}/><span>{progress===100?'Übertragen · JetKVM speichert …':`${progress} % übertragen`}</span></div>}</form>
    <form onSubmit={e=>{e.preventDefault();void mount('url')}}><label>Medien-URL<input aria-label="JetKVM-Medien-URL" type="url" required placeholder="https://server.example/rescue.iso" value={url} onChange={e=>setUrl(e.target.value)} disabled={disabled}/></label><button className="button" disabled={disabled||!!mounted||!loaded||!url.trim()}>URL verbinden</button><p className="jet-tool-note">Das JetKVM liest direkt von dieser Adresse. Der Webserver muss HTTP-Range-Anfragen unterstützen.</p></form>
   </div></div>
   <p className="jet-tool-note">Dieser Speicher liegt auf dem JetKVM. Die AMT-Medienbibliothek bleibt separat. Ein verbundenes Medium bleibt auch nach dem Schließen der Konsole verbunden.</p>
  </>}
 </section>;
}
