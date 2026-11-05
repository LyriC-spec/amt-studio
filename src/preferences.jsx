import React,{createContext,useContext,useEffect,useLayoutEffect,useState} from 'react';
import {applyInterfaceScale} from './interface-scale.js';
export const scaleOptions=[100,110,120,130,140,150].map(value=>[value,`${value} %`]);
export const refreshOptions=[[0,'Aus · nur bei Anmeldung'],[15,'15 Sekunden'],[30,'30 Sekunden'],[60,'1 Minute'],[120,'2 Minuten'],[300,'5 Minuten']];
export const keyboardOptions=[['de','Deutsch · QWERTZ'],['us','Englisch · US'],['physical','Tastenpositionen unverändert']];
const Preferences=createContext(null);
function read(key,options,fallback){try{const value=localStorage.getItem(key);return options.find(([id])=>String(id)===value)?.[0]??fallback}catch{return fallback}}
export function PreferencesProvider({children}){
 const [interfaceScale,setInterfaceScale]=useState(()=>read('amt-interface-scale',scaleOptions,120));
 const [refreshSeconds,setRefreshSeconds]=useState(()=>read('amt-refresh-seconds',refreshOptions,60));
 const [keyboardLayout,setKeyboardLayout]=useState(()=>read('amt-keyboard-layout',keyboardOptions,'de'));
 useEffect(()=>{localStorage.setItem('amt-refresh-seconds',String(refreshSeconds))},[refreshSeconds]);
 useEffect(()=>{localStorage.setItem('amt-keyboard-layout',keyboardLayout)},[keyboardLayout]);
 useLayoutEffect(()=>{applyInterfaceScale(interfaceScale);localStorage.setItem('amt-interface-scale',String(interfaceScale))},[interfaceScale]);
 return <Preferences.Provider value={{refreshSeconds,setRefreshSeconds,keyboardLayout,setKeyboardLayout,interfaceScale,setInterfaceScale}}>{children}</Preferences.Provider>
}
export const usePreferences=()=>useContext(Preferences);
export function DisplaySettings(){const {interfaceScale,setInterfaceScale}=usePreferences();return <section className="settings-card connection-preferences display-preferences"><h2>Größe der Oberfläche</h2><label>Darstellungsgröße<select aria-label="Darstellungsgröße" value={interfaceScale} onChange={e=>setInterfaceScale(Number(e.target.value))}>{scaleOptions.map(([value,label])=><option key={value} value={value}>{label}{value===120?' · Empfohlen':''}</option>)}</select></label><p>Vergrößert Schrift, Schaltflächen und Abstände in der gesamten Anwendung. Deine Auswahl gilt sofort und bleibt in diesem Browser gespeichert.</p><button className="button" onClick={()=>setInterfaceScale(100)} disabled={interfaceScale===100}>Auf 100 % zurücksetzen</button><p>Für einen direkten Vergleich stelle den Zoom deines Browsers auf 100 %.</p></section>}
export function ConnectionSettings(){const {refreshSeconds,setRefreshSeconds,keyboardLayout,setKeyboardLayout}=usePreferences();return <section className="settings-card connection-preferences"><h2>Status & Eingabe</h2><label>Automatische Aktualisierung<select aria-label={'Automatische Aktualisierung'} value={refreshSeconds} onChange={e=>setRefreshSeconds(Number(e.target.value))}>{refreshOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><p>Der Zeitabstand beginnt nach Abschluss einer Prüfrunde. Im Hintergrund pausiert die Prüfung. Die Anmeldung prüft deine eingerichteten Geräte weiterhin einmalig.</p><label>KVM-Tastaturbelegung<select aria-label={'KVM-Tastaturbelegung'} value={keyboardLayout} onChange={e=>setKeyboardLayout(e.target.value)}>{keyboardOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><p>Wähle die Belegung des Zielsystems. Die Auswahl stellt das Betriebssystem oder BIOS nicht um. Für ein US-BIOS wähle „Englisch · US“.</p><small>Änderungen gelten sofort und werden in diesem Browser gespeichert.</small></section>}
