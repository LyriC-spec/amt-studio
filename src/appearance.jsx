import React,{createContext,useContext,useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {Check,Sun,Moon,Palette,X,Command,Monitor,Folder,Activity} from 'lucide-react';
export const designs=[
  {id:'serein',name:'Serein',tag:'Die ruhige Werkstatt.',description:'Seitliche Navigation, weiche Listen und ein großzügiger Gerätebereich.',number:'01'},
  {id:'luma',name:'Luma',tag:'Eine Galerie für deine Systeme.',description:'Schwebende Navigation, große Gerätekarten und runde, offene Flächen.',number:'02'},
  {id:'orbit',name:'Orbit',tag:'Dein Kontrollraum.',description:'Schmale Werkzeugleiste, kompakte Statustabelle und ein technisches Instrumentenfeld.',number:'03'},
];
const Appearance=createContext(null);
export function AppearanceProvider({children}){
  const [design,setDesign]=useState(()=>['serein','luma','orbit'].includes(localStorage.getItem('amt-design'))?localStorage.getItem('amt-design'):'serein');
  const [mode,setMode]=useState(()=>localStorage.getItem('amt-theme')==='light'?'light':'dark');
  useEffect(()=>{document.documentElement.dataset.design=design;document.documentElement.dataset.theme=mode;localStorage.setItem('amt-design',design);localStorage.setItem('amt-theme',mode)},[design,mode]);
  return <Appearance.Provider value={{design,setDesign,mode,setMode}}>{children}</Appearance.Provider>
}
export const useAppearance=()=>useContext(Appearance);
function Miniature({design,mode}){return <div className={`design-mini ${design} ${mode}`} aria-hidden="true"><div className="mini-nav"><Command/><span/><Monitor/><Folder/><Activity/></div><div className="mini-body"><div className="mini-title"/><div className="mini-metrics"><i/><i/><i/></div><div className="mini-lower"><div><b/><b/><b/></div><aside><div className="mini-orb"/><i/></aside></div></div><span className="mini-glow"/></div>}
export function AppearancePanel(){const {design,setDesign,mode,setMode}=useAppearance();return <div className="appearance-panel"><div className="appearance-heading"><div><span className="eyebrow">DEIN STIL. DEIN RAUM.</span><h2>Wie möchtest du arbeiten?</h2><p>Drei eigenständige Designs. Jedes in Hell und Dunkel.</p></div><div className="mode-switch" aria-label="Helligkeit"><button aria-pressed={mode==='light'} onClick={()=>setMode('light')}><Sun size={16}/>Hell</button><button aria-pressed={mode==='dark'} onClick={()=>setMode('dark')}><Moon size={16}/>Dunkel</button></div></div><div className="design-cards">{designs.map(d=><button key={d.id} className={`design-card ${design===d.id?'chosen':''}`} aria-label={`Design ${d.name}`} aria-pressed={design===d.id} onClick={()=>setDesign(d.id)}><Miniature design={d.id} mode={mode}/><div className="design-card-copy"><span>{d.number}</span><h3>{d.name}</h3>{design===d.id&&<Check size={17}/>}<strong>{d.tag}</strong><p>{d.description}</p></div></button>)}</div><div className="appearance-foot"><span className="tiny-dot"/>Deine Auswahl wird in diesem Browser gespeichert.</div></div>}
export function AppearanceButton(){const[open,setOpen]=useState(false);return <><button className="icon-button" title="Design auswählen" aria-label="Design auswählen" onClick={()=>setOpen(true)}><Palette size={18}/></button>{open&&createPortal(<div className="modal-backdrop appearance-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setOpen(false)}}><section className="appearance-dialog" role="dialog" aria-modal="true" aria-label="Design auswählen"><button className="icon-button close-appearance" aria-label="Designauswahl schließen" onClick={()=>setOpen(false)}><X size={20}/></button><AppearancePanel/></section></div>,document.body)}</>}
