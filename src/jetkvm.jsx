import React,{useEffect,useRef,useState} from 'react';
import {Monitor,Eye,MousePointer2,Maximize2,Unplug,RefreshCw,Keyboard,Disc3,Power} from 'lucide-react';
import {usePreferences,keyboardOptions} from './preferences.jsx';
import {jetKeyboard,jetPointer} from './jetkvm-input.mjs';
import {JetRpc} from './jetkvm-rpc.mjs';
import {JetTools} from './jetkvm-tools.jsx';
import './jetkvm.css';

export function JetKvm({session,active,onClose}){
 const surface=useRef(),video=useRef(),connection=useRef(),hid=useRef(),rpc=useRef(),keys=useRef(),pointer=useRef({x:0,y:0,used:false}),enabled=useRef(false);
 const [status,setStatus]=useState('connecting'),[error,setError]=useState(''),[input,setInput]=useState(false),[generation,setGeneration]=useState(0),[size,setSize]=useState(''),[version,setVersion]=useState('');
 const {keyboardLayout,setKeyboardLayout}=usePreferences();
 const [toolsClient,setToolsClient]=useState(null),[transportId,setTransportId]=useState(''),[toolPanel,setToolPanel]=useState(null);
 const send=bytes=>{if(hid.current?.readyState==='open'&&hid.current.bufferedAmount<65536)hid.current.send(bytes)};
 const release=()=>{keys.current?.release();if(pointer.current.used){send(jetPointer(pointer.current.x,pointer.current.y,0));pointer.current.used=false}};
 useEffect(()=>{enabled.current=input&&active&&status==='connected';if(!enabled.current)release();else video.current?.focus()},[input,active,status]);
 useEffect(()=>{release()},[keyboardLayout]);
 useEffect(()=>{const blur=()=>release();window.addEventListener('blur',blur);return()=>window.removeEventListener('blur',blur)},[]);
 useEffect(()=>{
  let disposed=false,ended=false,started=false,queue=Promise.resolve(),candidates=[];const id=crypto.randomUUID();let pc,timer,keepalive,jetRpc;
  setTransportId(id);setToolsClient(null);
  setStatus('connecting');setError('');setInput(false);setSize('');setVersion('');
  const signal=(type,data)=>window.amt.sendKvm(id,new TextEncoder().encode(JSON.stringify({type,data})));
  const stop=()=>{ended=true;enabled.current=false;release();clearTimeout(timer);clearInterval(keepalive);jetRpc?.close();pc?.close();if(!disposed)setToolsClient(null);if(video.current)video.current.srcObject=null;void window.amt.action('stopSession',{sessionId:id})};
  const fail=message=>{if(disposed)return;setError(message);setStatus('error');stop()};
  async function receive(message){
   if(disposed||ended)return;
   if(message.type==='other-session-connected'){fail('Eine andere Verbindung hat die JetKVM-Sitzung übernommen.');return}
   if(message.type==='device-metadata'&&!started){
    started=true;setVersion(String(message.data?.deviceVersion||''));
    pc=new RTCPeerConnection({iceServers:[]});connection.current=pc;
    const transceiver=pc.addTransceiver('video',{direction:'recvonly'});
    const codecs=RTCRtpReceiver.getCapabilities?.('video')?.codecs.filter(c=>c.mimeType!=='video/H265');if(codecs?.length)transceiver.setCodecPreferences?.(codecs);
    hid.current=pc.createDataChannel('hidrpc',{ordered:true});rpc.current=pc.createDataChannel('rpc',{ordered:true});
    jetRpc=new JetRpc(rpc.current);rpc.current.onopen=()=>{if(!disposed&&!ended)setToolsClient(jetRpc)};rpc.current.addEventListener('close',()=>{if(!disposed)setToolsClient(null)});
    hid.current.onopen=()=>send(new Uint8Array([1,1]));
    rpc.current.onmessage=event=>{try{const message=JSON.parse(event.data);if(message.method==='otherSessionConnected')fail('Eine andere Verbindung hat die JetKVM-Sitzung übernommen.')}catch{}};
    keys.current=jetKeyboard(send);
    // Keep pressed keys alive on firmware that supports the v1 keepalive report.
    keepalive=setInterval(()=>{if(enabled.current&&keys.current?.pressed.size)send(new Uint8Array([9]))},1000);
    pc.onicecandidate=({candidate})=>{if(candidate&&!disposed)signal('new-ice-candidate',candidate.toJSON())};
    pc.ontrack=({track})=>{if(!disposed&&video.current){video.current.srcObject=new MediaStream([track]);void video.current.play().catch(()=>{})}};
    pc.onconnectionstatechange=()=>{if(disposed)return;if(pc.connectionState==='connected'){clearTimeout(timer);setStatus('connected')}else if(['failed','disconnected'].includes(pc.connectionState))fail('Die direkte WebRTC-Verbindung wurde unterbrochen. Browser und JetKVM müssen über LAN oder VPN erreichbar sein.')};
    await pc.setLocalDescription(await pc.createOffer());if(!disposed&&!ended)signal('offer',{sd:btoa(JSON.stringify(pc.localDescription))});
   }else if(message.type==='answer'&&pc){
    await pc.setRemoteDescription(JSON.parse(atob(message.data)));for(const c of candidates)await pc.addIceCandidate(c);candidates=[];
   }else if(message.type==='new-ice-candidate'&&pc){if(pc.remoteDescription)await pc.addIceCandidate(message.data);else candidates.push(message.data)}
  }
  const unsubscribe=window.amt.onKvm(event=>{if(event.sessionId!==id||disposed)return;if(event.type==='jetSignal')queue=queue.then(()=>receive(event.signal)).catch(()=>fail('Die JetKVM-WebRTC-Aushandlung ist fehlgeschlagen.'));else if(event.type==='error')fail(event.message);else if(event.type==='closed'){stop();setStatus(s=>s==='error'?s:'closed')}});
  timer=setTimeout(()=>fail('Keine Bildverbindung. Prüfe die direkte UDP-Erreichbarkeit des JetKVM über LAN oder VPN.'),25000);
  void window.amt.action('startJetKvm',{id:session.device.id,sessionId:id}).then(result=>{if(!result.ok)fail(result.error);else if(disposed)void window.amt.action('stopSession',{sessionId:id})});
  return()=>{disposed=true;unsubscribe();stop();hid.current=null;rpc.current=null;connection.current=null};
 },[session.id,generation]);
 const key=(e,down)=>{if(!enabled.current)return;e.preventDefault();e.stopPropagation();if(e.ctrlKey&&e.altKey&&e.shiftKey){release();setInput(false);video.current.blur();return}keys.current?.handle(e,down,keyboardLayout)};
 const move=e=>{if(!enabled.current||!video.current.videoWidth)return;e.preventDefault();const r=video.current.getBoundingClientRect();const scale=Math.min(r.width/video.current.videoWidth,r.height/video.current.videoHeight),w=video.current.videoWidth*scale,h=video.current.videoHeight*scale;const x=(e.clientX-r.left-(r.width-w)/2)/w,y=(e.clientY-r.top-(r.height-h)/2)/h;if(e.type==='pointerdown'&&(x<0||x>1||y<0||y>1))return;pointer.current={x:x*32767,y:y*32767,used:true};send(jetPointer(pointer.current.x,pointer.current.y,e.buttons));if(e.type==='pointerdown'){video.current.focus();video.current.setPointerCapture(e.pointerId)}};
 const wheel=e=>{if(!enabled.current||rpc.current?.readyState!=='open')return;rpc.current.send(JSON.stringify({jsonrpc:'2.0',id:crypto.randomUUID(),method:'wheelReport',params:{wheelY:-Math.sign(e.deltaY),wheelX:Math.sign(e.deltaX)}}))};
 const labels={connecting:'JetKVM wird verbunden …',connected:'Verbunden',closed:'Sitzung beendet',error:'Verbindung fehlgeschlagen'};
 return <section className="kvm-panel jet-panel" ref={surface} style={{display:active?'flex':'none'}}>
  <div className="kvm-toolbar jet-toolbar"><div className="jet-identity"><span className={`tiny-dot ${status==='connected'?'green':''}`}/><strong>{session.device.host}</strong><span className="kvm-status-text">{labels[status]}</span><span className="jet-version" title={`JetKVM · WebRTC${version?` · ${version}`:''}`}>JetKVM{version?` ${version}`:''}</span></div><div className="jet-controls">
   <label className="keyboard-select" title="Tastaturbelegung des Zielgeräts"><Keyboard size={15}/><select aria-label="KVM-Tastaturbelegung" value={keyboardLayout} onChange={e=>setKeyboardLayout(e.target.value)}>{keyboardOptions.map(([v,label])=><option value={v} key={v}>{label}</option>)}</select></label>
   <button aria-expanded={toolPanel==='media'} disabled={!toolsClient} onClick={()=>{release();setInput(false);setToolPanel(toolPanel==='media'?null:'media')}}><Disc3 size={16}/>Medien</button>
   <button aria-expanded={toolPanel==='atx'} disabled={!toolsClient} onClick={()=>{release();setInput(false);setToolPanel(toolPanel==='atx'?null:'atx')}}><Power size={16}/>ATX</button>
   <button disabled={status!=='connected'} className={input?'input-enabled':''} title={input?'Strg + Alt + Umschalt löst die Eingabe.':'Nur ansehen. Hier klicken, um Tastatur und Maus freizugeben.'} onClick={()=>{release();setInput(!input)}}>{input?<MousePointer2 size={16}/>:<Eye size={16}/ >}{input?'Steuerung beenden':'Tastatur & Maus aktivieren'}</button>
   <button title="Strg + Alt + Entf senden" disabled={!input||status!=='connected'} onClick={()=>{for(const k of [224,226,76])send(new Uint8Array([5,k,1]));for(const k of [76,226,224])send(new Uint8Array([5,k,0]))}}><Keyboard size={16}/><span>Strg Alt Entf</span></button>
   <button title="Vollbild" onClick={()=>document.fullscreenElement?document.exitFullscreen():surface.current.requestFullscreen()}><Maximize2 size={17}/></button><button title="Verbindung trennen" onClick={onClose}><Unplug size={17}/></button>
  </div></div>
  <JetTools client={toolsClient} sessionId={transportId} device={session.device} panel={toolPanel} onClose={()=>setToolPanel(null)}/>
  <div className={`kvm-surface ${input?'input-ready':''}`}><video ref={video} autoPlay playsInline muted tabIndex={input?0:-1} aria-label={`Remote-Bildschirm ${session.device.name}`} onResize={()=>setSize(`${video.current.videoWidth} × ${video.current.videoHeight}`)} onKeyDown={e=>key(e,true)} onKeyUp={e=>key(e,false)} onPointerDown={move} onPointerMove={move} onPointerUp={move} onPointerCancel={release} onBlur={release} onContextMenu={e=>e.preventDefault()} onWheel={wheel}/>
  {status!=='connected'&&<div className="kvm-overlay"><Monitor size={38}/><h2>{labels[status]}</h2><p>{error||'Anmeldung über den Teamserver, Bildübertragung direkt über LAN oder VPN.'}</p>{['error','closed'].includes(status)&&<button className="button primary" onClick={()=>setGeneration(v=>v+1)}><RefreshCw size={16}/>Erneut verbinden</button>}</div>}
  {status==='connected'&&!size&&<div className="jet-no-video">Verbunden · Warte auf das HDMI-Bildsignal …</div>}</div>
  <div className="kvm-footer"><span>JetKVM · Verschlüsselte WebRTC-Bildübertragung</span><span>{size||'Noch kein Bildsignal'} · {input?'Steuerung aktiv':'Nur ansehen'}</span></div>
 </section>;
}
