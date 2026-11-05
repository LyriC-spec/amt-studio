import React,{useEffect,useRef,useState} from 'react';
import {TerminalSquare,RefreshCw,Unplug} from 'lucide-react';
import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
export function Sol({session,active=true,onClose}){
 const element=useRef(null),terminalRef=useRef(null),fitRef=useRef(null),activeRef=useRef(active);
 const [state,setState]=useState('connecting'),[error,setError]=useState(''),[generation,setGeneration]=useState(0),[received,setReceived]=useState(0);
 useEffect(()=>{activeRef.current=active;if(active){fitRef.current?.fit();terminalRef.current?.focus()}else terminalRef.current?.blur()},[active]);
 useEffect(()=>{
  let disposed=false,ready=false;const id=crypto.randomUUID(),encoder=new TextEncoder();
  setState('connecting');setError('');setReceived(0);
  const terminal=new Terminal({cursorBlink:true,fontSize:14,theme:{background:'#101316',foreground:'#e1e9e4'},scrollback:3000}),fit=new FitAddon();
  terminalRef.current=terminal;fitRef.current=fit;terminal.loadAddon(fit);terminal.open(element.current);fit.fit();
  const observer=new ResizeObserver(()=>{if(activeRef.current)fit.fit()});observer.observe(element.current);
  const input=terminal.onData(data=>{if(ready&&activeRef.current)window.amt.sendKvm(id,encoder.encode(data))});
  const remove=window.amt.onKvm(event=>{
   if(disposed||event.sessionId!==id)return;
   if(event.type==='data'){terminal.write(new Uint8Array(event.data));setReceived(n=>n+event.data.length)}
   if(event.type==='ready'){ready=true;setState('connected');if(activeRef.current)terminal.focus()}
   if(event.type==='closed'){ready=false;setState(old=>old==='error'?old:'closed')}
   if(event.type==='error'){ready=false;setError(event.message);setState('error')}
  });
  void window.amt.action('startSol',{id:session.device.id,sessionId:id}).then(result=>{if(!result.ok&&!disposed){setError(result.error);setState('error')}}).catch(error=>{if(!disposed){setError(error.message);setState('error')}});
  return()=>{disposed=true;ready=false;remove();input.dispose();observer.disconnect();terminal.dispose();terminalRef.current=null;fitRef.current=null;void window.amt.action('stopSession',{sessionId:id})};
 },[session.id,generation]);
 return <section className="sol-session work-card" style={{display:active?'block':'none'}}><div className="card-title"><TerminalSquare size={20}/><h2>{session.device.name} · SOL</h2><span role="status">{{connecting:'Verbindung wird aufgebaut …',connected:'Verbunden',closed:'Getrennt',error:'Verbindung fehlgeschlagen'}[state]}</span>{['closed','error'].includes(state)&&<button className="button" onClick={()=>setGeneration(n=>n+1)}><RefreshCw size={16}/>Erneut verbinden</button>}<button className="button" onClick={onClose}><Unplug size={16}/>SOL trennen</button></div>{error&&<div className="inline-error" role="alert">{error}</div>}<p className="sol-help">Serielle Textkonsole über Intel AMT. Für eine Ausgabe muss die serielle Umleitung in Firmware oder Betriebssystem eingerichtet sein. Die Verbindung startet das Gerät nicht neu.</p><div className="sol-terminal" ref={element}/><div className="sol-summary">{session.device.host} · UTF-8 · {received} Bytes empfangen{state==='connected'&&received===0?' · Verbunden, noch keine serielle Ausgabe':''}</div></section>
}
