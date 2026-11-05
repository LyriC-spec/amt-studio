import './browser-client.js';
import {AppearanceProvider,AppearancePanel,AppearanceButton,useAppearance} from './appearance.jsx';
import {PreferencesProvider,ConnectionSettings,DisplaySettings,usePreferences} from './preferences.jsx';
import {BrowserGate,BrowserAccount,ConfirmationHost} from './web-shell.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowDownLeft, ArrowUpRight, Check, ChevronDown, ChevronRight, CircleHelp, Command, Cpu, Ellipsis, Folder, Globe2, HardDrive, Keyboard, LayoutGrid, LockKeyhole, Maximize2, Monitor, Moon, MousePointer2, Plus, Power, RefreshCw, Search, Server, Settings2, ShieldCheck, Sun, TerminalSquare, Trash2, Unplug, X } from 'lucide-react';
import { Kvm } from './remote.jsx';
import {Sol} from './sol.jsx';
import {JetKvm} from './jetkvm.jsx';
import {JetDetails} from './jetkvm-details.jsx';
import {DeviceForm} from './device-form.jsx';
import {WorkspacePage,api} from './workspace.jsx';
import {Disc3,Users} from 'lucide-react';
import './style.css';
import './readability.css';
import './designs.css';
import './layouts.css';
import './scale.css';
import './kvm-toolbar.css';

const desktop = Boolean(window.amt);
const browser=Boolean(window.amt?.browser);
const previewDevices = [
  { id: 'preview-1', name: 'MS-02 Ultra', host: '192.0.2.5', username: 'admin', group: 'Homelab', legacyConnect: true, hasPassword: true },
  { id: 'preview-2', name: 'Compute 02', host: '192.0.2.6', username: 'admin', group: 'Homelab', legacyConnect: true, hasPassword: true },
  { id: 'preview-3', name: 'Compute 03', host: '192.0.2.7', username: 'admin', group: 'Homelab', legacyConnect: true, hasPassword: true },
];
const previewInfo = { hostName: 'Designvorschau', firmware: '16.1.25', powerState: '2', kvm: { EnabledByMEBx: 'true', OptInPolicy: 'false' }, checkedAt: new Date().toISOString() };
const prettyTime = value => value ? new Date(value).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : 'Noch nicht geprüft';
const prettySnapshot = value => value ? new Date(value).toLocaleString('de-DE', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : 'Noch nicht geprüft';
const Button = ({ children, icon: Icon, variant = '', className = '', ...props }) => <button className={`button ${variant} ${className}`} {...props}>{Icon && <Icon size={16} />}{children}</button>;
const IconButton = ({ icon: Icon, title, ...props }) => <button className="icon-button" title={title} aria-label={title} {...props}><Icon size={18} /></button>;
const ClockSnapshot=()=> <RefreshCw size={15} aria-hidden="true"/>;
function Badge({ state }) { const labels = { online: 'Erreichbar', cached:'Gespeichert', error: 'Prüfen', checking: 'Wird geprüft', unknown: 'Nicht geprüft' }; return <span className={`badge ${state}`}><i />{labels[state]}</span>; }

function DeviceEntry({device,index,selected,info,design,onSelect,onConnect}){
  return <div role="button" tabIndex={0} aria-label={`${device.name}, ${device.host}, Details anzeigen`} onKeyDown={e=>{if(e.target===e.currentTarget&&['Enter',' '].includes(e.key)){e.preventDefault();onSelect()}}} className={`device-row ${selected?'selected':''}`} onClick={onSelect}>
    {design==='orbit'&&<span className="device-index" aria-hidden="true">{String(index+1).padStart(2,'0')}</span>}
    <div className={`device-icon icon-${index%3}`}><Server size={22}/></div>
    <div className="device-name"><strong>{device.name}</strong><span>{device.host}<i/>{device.group}</span></div>
    <Badge state={info?.state||'unknown'}/>
    {design==='luma'&&<div className="device-card-facts"><span><ShieldCheck size={13}/>{device.kind==='jetkvm'?device.jetProtocol==='https'?'HTTPS':'Lokales HTTP':device.fingerprint?'Zertifikat bestätigt':'Zertifikat offen'}</span><span><Cpu size={13}/>{device.kind==='jetkvm'?'JetKVM':info?.firmware?`AMT ${info.firmware}`:'Intel AMT'}</span></div>}
    {design==='orbit'&&<span className="device-pin-state"><ShieldCheck size={13}/>{device.kind==='jetkvm'?'JETKVM':device.fingerprint?'PIN OK':'PIN OFFEN'}</span>}
    <button className="connect-small" onClick={e=>{e.stopPropagation();onConnect()}} aria-label={`KVM mit ${device.name} verbinden`}><Monitor size={15}/>{design==='luma'?'Konsole öffnen':'KVM'}<ArrowUpRight size={15}/></button>
  </div>
}

function App() {
  const {mode:theme,setMode:setTheme,design}=useAppearance();
  const {refreshSeconds}=usePreferences();
  const refreshInterval=useRef(refreshSeconds*1000),reschedulePolling=useRef(null);
  const [devices, setDevices] = useState(desktop ? [] : previewDevices);
  const [selected, setSelected] = useState(null);
  const [info, setInfo] = useState(desktop ? {} : Object.fromEntries(previewDevices.map(d => [d.id, { state: 'online', ...previewInfo }])));
  const [page, setPage] = useState('devices');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('Alle Geräte');
  const [form, setForm] = useState(null);
  const [toast, setToast] = useState(null);
  const [activity, setActivity] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [encryptionAvailable, setEncryptionAvailable] = useState(false);
  const [checkingAll, setCheckingAll] = useState(false);
  const alive = useRef(false), checkingBatch = useRef(false), inspections = useRef(new Map());
  const deviceVersions=useRef(new Map());
  const [busy, setBusy] = useState(false);
  const [groups,setGroups]=useState([]),[user,setUser]=useState(null),[workspace,setWorkspace]=useState({mode:browser?'team':'local',browser});
  async function refreshWorkspace(){setSessions([]);setActiveSession(null);setInfo({});setSelected(null);setSearch('');setWorkspace(await api('workspaceStatus'));await refreshList()}
  useEffect(()=>window.amt?.onKvm(event=>{if(event.type==='teamDisconnected'){setSessions([]);setToast('Die Teamverbindung wurde getrennt. Bitte am Teamserver erneut anmelden.')}}),[]);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('amt-theme', theme); }, [theme]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(null), 6500); return () => clearTimeout(timer); } }, [toast]);
  async function refreshList() {
    if (!desktop) return;
    const result = await window.amt.list();
    if (!alive.current) return;
    if (result.ok) { setDevices(result.data.devices);setInfo(old=>Object.fromEntries(result.data.devices.map(device=>{const existing=old[device.id],saved=device.lastInspection;return [device.id,(existing?.state==='checking'||existing?.state==='online'&&existing.checkedAt===saved?.checkedAt)?existing:saved?{...saved,state:'cached'}:{state:'unknown'}]})));setGroups(result.data.groups||[]);setUser(result.data.user);if(browser)setWorkspace({mode:'team',browser:true,address:location.origin,user:result.data.user}); setEncryptionAvailable(result.data.encryptionAvailable); }
    else setToast(result.error);
    return result.ok ? result.data.devices : undefined;
  }
  useEffect(() => {
    alive.current = true;
    if (!browser) {
      void refreshList();
      return () => { alive.current = false; };
    }
    let timer, stopped = false, running = false, dueAt = Infinity;
    const schedule = () => {
      clearTimeout(timer); dueAt = Infinity;
      if (!stopped && refreshInterval.current > 0) {
        dueAt = Date.now() + refreshInterval.current;
        timer = setTimeout(() => void updateStatus(), refreshInterval.current);
      }
    };
    reschedulePolling.current = () => { if (!running) schedule(); };
    async function updateStatus(initial = false) {
      if (stopped || running || (!initial && document.hidden)) return;
      clearTimeout(timer);
      running = true;
      try {
        if (!checkingBatch.current) {
          // Reload the authorized list so newly added or removed devices are respected.
          const rows = await refreshList();
          if (!stopped && !document.hidden && rows) await checkAll(rows.filter(device => device.kind==='jetkvm' ? device.jetProtocol==='http'||device.fingerprint : device.fingerprint && device.hasPassword));
        }
      } finally {
        running = false;
        if (!stopped) schedule();
      }
    }
    const resume = () => { if (!document.hidden && Date.now() >= dueAt) void updateStatus(); };
    document.addEventListener('visibilitychange', resume);
    void updateStatus(true);
    return () => {
      stopped = true; alive.current = false; clearTimeout(timer);
      reschedulePolling.current = null;
      document.removeEventListener('visibilitychange', resume);
    };
  }, []);
  useEffect(() => {
    refreshInterval.current = refreshSeconds * 1000;
    reschedulePolling.current?.();
  }, [refreshSeconds]);
  useEffect(() => {
    const shortcut = event => { if (page === 'devices' && !form && event.key === '/' && !['INPUT','TEXTAREA'].includes(event.target.tagName)) { event.preventDefault(); document.querySelector('input[aria-label="Geräte suchen"]')?.focus(); } };
    window.addEventListener('keydown', shortcut); return () => window.removeEventListener('keydown', shortcut);
  }, [page, form]);
  const current = devices.find(d => d.id === selected) || devices[0];
  const currentInfo = info[current?.id] || { state: 'unknown' };
  const visible = devices.filter(d => `${d.name} ${d.host} ${d.group}`.toLowerCase().includes(search.toLowerCase()) && (filter === 'Alle Geräte' || (filter === 'Erreichbar' && info[d.id]?.state === 'online') || (filter === 'Zu prüfen' && info[d.id]?.state !== 'online')));
  const reachable = devices.filter(d => info[d.id]?.state === 'online').length;
  const log = (text, type = 'info') => setActivity(old => [{ text, type, at: new Date().toISOString(), id: crypto.randomUUID() }, ...old].slice(0, 30));
  async function inspect(device) {
    if (!desktop) { setToast('Designvorschau: echte Verbindungen sind in der Desktop-App verfügbar.'); return; }
    if (!alive.current) return;
    if (inspections.current.has(device.id)) return inspections.current.get(device.id);
    const pending = inspectDevice(device).finally(() => inspections.current.delete(device.id));
    inspections.current.set(device.id, pending);
    return pending;
  }
  async function inspectDevice(device) {
    const version=deviceVersions.current.get(device.id);
    setInfo(old => ({ ...old, [device.id]: { ...old[device.id], state: 'checking', error: null } }));
    let result;
    try { result = await window.amt.inspect(device.id); }
    catch (error) { result = {ok:false,error:error.message || 'Geräteprüfung fehlgeschlagen.'}; }
    if (!alive.current||deviceVersions.current.get(device.id)!==version) return;
    if (result.ok) { setInfo(old => ({ ...old, [device.id]: { ...result.data, state: 'online' } })); log(`${device.name}: Anmeldung erfolgreich`); }
    else { setInfo(old => ({ ...old, [device.id]: { ...old[device.id], state: 'error', error: result.error, code: result.code } })); log(`${device.name}: ${result.error}`, 'error'); }
  }
  async function checkAll(targets = devices) {
    if (!alive.current || checkingBatch.current || !targets.length) return;
    checkingBatch.current = true; setCheckingAll(true);
    let next = 0;
    async function worker() {
      while (alive.current && next < targets.length) await inspect(targets[next++]);
    }
    try { await Promise.all([worker(), worker()]); }
    finally { checkingBatch.current = false; if (alive.current) setCheckingAll(false); }
  }
  async function trust(device) {
    if (!desktop) { setToast('Zertifikate werden in der Desktop-App geprüft.'); return; }
    setBusy(true); const result = await window.amt.trust(device.id); setBusy(false);
    if (!result.ok) setToast(result.error);
    else if (result.data.trusted) { setDevices(result.data.devices); log(`${device.name}: Zertifikat bestätigt`); await inspect(device); }
  }
  async function power(device, action) {
    if (!desktop) { setToast('Designvorschau: Es wird keine Stromaktion ausgeführt.'); return; }
    setBusy(true); const result = await window.amt.power(device.id, action); setBusy(false);
    if (!result.ok) setToast(result.error);
    else if (!result.data.cancelled) { log(`${device.name}: Stromaktion von AMT angenommen`); setToast('AMT hat den Befehl angenommen. Aktualisiere den Status nach einigen Sekunden.'); }
  }
  function connect(device,protocol='kvm') {
    if(device.kind==='jetkvm'){if(user?.role!=='admin'){setToast('Die JetKVM-Konsole ist Administratoren vorbehalten.');return}protocol='jetkvm'}
    if (!desktop) { setToast('Designvorschau: Starte die Desktop-App für eine echte KVM-Sitzung.'); return; }
    const existing = sessions.find(s => s.device.id === device.id && s.protocol === protocol);
    if (existing) setActiveSession(existing.id);
    else { const session = { id: crypto.randomUUID(), device, protocol }; setSessions(old => [...old, session]); setActiveSession(session.id); log(`${device.name}: ${protocol.toUpperCase()}-Verbindung wird aufgebaut`); }
    setPage('sessions');
  }
  function closeSession(id) { const rest = sessions.filter(s => s.id !== id); setSessions(rest); if (activeSession === id) setActiveSession(rest[0]?.id || null); }
  async function saveDevice(value) {
    if (!desktop) { const d = { ...value, id: value.id || crypto.randomUUID(), hasPassword: Boolean(value.password) }; delete d.password; setDevices(old => old.filter(x => x.id !== d.id).concat(d)); setForm(null); setToast('Gerät in der Vorschau ergänzt. Es wird keine Verbindung aufgebaut.'); return; }
    const result = await window.amt.save(value);
    if (result.ok) { if(value.id){deviceVersions.current.set(value.id,(deviceVersions.current.get(value.id)||0)+1);const remaining=sessions.filter(s=>s.device.id!==value.id);setSessions(remaining);if(!remaining.some(s=>s.id===activeSession))setActiveSession(remaining[0]?.id||null);setInfo(old=>{const next={...old};delete next[value.id];return next});} setDevices(result.data);setSelected(value.id||result.data.at(-1)?.id); await refreshList();setForm(null); setToast('Gerät gespeichert.'); }
    else throw new Error(result.error);
  }
  async function removeDevice(device) {
    if (!confirm(`${device.name} aus dieser Anwendung entfernen? Das Gerät selbst wird nicht verändert.`)) return;
    if (desktop) { const result = await window.amt.remove(device.id); if (!result.ok) { setToast(result.error); return; } setDevices(result.data); }
    else setDevices(old => old.filter(d => d.id !== device.id));
    setSelected(null); log(`${device.name}: aus der Geräteliste entfernt`);
  }
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Command size={23} /></div><span>amt<span className="brand-light">studio</span><small>REMOTE MANAGEMENT</small></span></div>
      <div className="workspace"><span className="workspace-icon"><Server size={18} /></span><span>{workspace.mode==='team'?'Team-Workspace':'Mein Workspace'}<small>{workspace.mode==='team'?workspace.user?.username:'Lokale Verwaltung'}</small></span><LockKeyhole size={13} /></div>
      <span className="nav-label">WORKSPACE</span>
      <nav>
        <button className={page === 'devices' ? 'active' : ''} onClick={() => setPage('devices')}><LayoutGrid size={18} />Geräte<span className="nav-count">{devices.length}</span></button>
        <button className={page === 'sessions' ? 'active' : ''} onClick={() => setPage('sessions')}><Monitor size={18} />KVM & SOL{sessions.length > 0 && <span className="nav-count">{sessions.length}</span>}</button>
        {[['groups','Gruppen',Folder],['media','Medien',Disc3],['advanced','AMT-Werkzeuge',TerminalSquare],['users','Benutzer',Users],['team','Teamserver',Server],['audit','Protokoll',ShieldCheck]].map(([id,label,Icon])=><button key={id} className={page===id?'active':''} onClick={()=>setPage(id)}><Icon size={18}/>{label}</button>)}
        <button className={page === 'activity' ? 'active' : ''} onClick={() => setPage('activity')}><Activity size={18} />Aktivität</button>
        <button className={page === 'settings' ? 'active' : ''} onClick={() => setPage('settings')}><Settings2 size={18} />Einstellungen</button>
      </nav>
      <span className="nav-label groups-label">GERÄTEGRUPPEN</span>
      {[...new Set(devices.map(d => d.group))].map(group => <button className="group-link" key={group} onClick={() => { setPage('devices'); setSearch(group); }}><Folder size={15} />{group}<span>{devices.filter(d => d.group === group).length}</span></button>)}
      <div className="sidebar-bottom"><div className="local-note"><div className="local-dot" /><div>{workspace.mode==='team'?'Teamserver':'Lokaler Workspace'}<small>{workspace.mode==='team'?'Gemeinsame Verwaltung':'Ohne Cloud-Konto'}</small></div><ShieldCheck size={17} /></div><div className="sidebar-footer"><span>AMT Studio <b>0.3.1</b></span><AppearanceButton/><IconButton icon={theme === 'dark' ? Sun : Moon} title={theme === 'dark' ? 'Hellen Modus aktivieren' : 'Dunklen Modus aktivieren'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} /></div></div>
    </aside>
    <main>
      <header className="topbar"><div className="breadcrumb">Workspace <ChevronRight size={14} /><span>{{ devices: 'Geräteübersicht', sessions: 'KVM & SOL', activity: 'Aktivität', settings: 'Einstellungen',groups:'Gruppen',media:'Medien',advanced:'AMT-Werkzeuge',users:'Benutzer',team:'Teamserver',audit:'Protokoll' }[page]}</span></div><div className="topbar-right"><IconButton icon={RefreshCw} title="Workspace aktualisieren" onClick={refreshList}/>{!desktop && <span className="preview-label">DESIGNVORSCHAU</span>}<span className="transport-label"><LockKeyhole size={13} />AMT & JetKVM</span><button className="avatar" onClick={() => setPage('settings')} title={user?.username||"Workspace"}>{(user?.username||"AS").slice(0,2).toUpperCase()}</button></div></header>
      {page==='team'&&browser&&<div className="page-content"><div className="page-heading"><div><div className="eyebrow">GEMEINSAM VERBUNDEN</div><h1>Ein Ort für dein Team.</h1><p>Dein AMT-Workspace läuft vollständig auf deinem eigenen Server.</p></div></div><BrowserAccount user={user}/></div>}
      {['groups','media','advanced','users','team','audit'].includes(page)&&!(page==='team'&&browser)&&<WorkspacePage key={page} page={page} devices={['advanced','media'].includes(page)?devices.filter(d=>d.kind!=='jetkvm'):devices} groups={groups} user={user} workspace={workspace} onRefresh={refreshList} onWorkspace={refreshWorkspace} onNotice={setToast} onOpenSol={device=>connect(device,'sol')}/>}
      {page === 'devices' && <div className="page-content fleet-page">
        <div className="page-heading"><div><div className="eyebrow">{design==='orbit'?'SYSTEMÜBERSICHT / REMOTE KVM':design==='luma'?'DEIN TEAM. DEINE SYSTEME.':'DEINE INFRASTRUKTUR. DEINE KONTROLLE.'}</div><h1>{design==='orbit'?'Systeme & Verbindungen.':design==='luma'?'Raum für deine Systeme.':'Alles im Blick.'}</h1><p>Deine Geräte verwalten. Auch wenn das Betriebssystem nicht läuft.</p></div><Button icon={Plus} variant="primary" onClick={() => setForm({})}>Gerät hinzufügen</Button></div>
        <div className="metrics"><div className="metric"><span>Verwaltete Geräte<Server size={18} /></span><strong>{String(devices.length).padStart(2, '0')}</strong><small>In deinem Workspace</small></div><div className="metric"><span>Erreichbar<Activity size={18} /></span><strong>{String(reachable).padStart(2, '0')}<i className="metric-dot" /></strong><small>{desktop ? 'Durch Anmeldung geprüft' : 'Beispielstatus · Vorschau'}</small></div><div className="metric"><span>KVM & SOL<Monitor size={18} /></span><strong>{String(sessions.length).padStart(2, '0')}</strong><small>{sessions.length ? 'Geöffnete Sitzungstabs' : 'Bereit, wenn du es bist'}</small></div><div className="metric subtle-metric"><span>Verbindungsweg<ShieldCheck size={18} /></span><strong className="tls-value">TLS <span>1.2+</span></strong><small>Direkt im Netzwerk oder VPN</small></div></div>
        <div className="devices-layout"><section className="device-section"><div className="section-toolbar"><div className="tabs">{['Alle Geräte','Erreichbar','Zu prüfen'].map(f => <button className={filter === f ? 'selected' : ''} key={f} onClick={() => setFilter(f)}>{f}{f === 'Alle Geräte' && <span>{devices.length}</span>}</button>)}</div><IconButton icon={RefreshCw} title="Alle Geräte prüfen" onClick={() => void checkAll()} disabled={checkingAll || !devices.length} /></div>
          <div className="search-row"><Search size={17} /><input aria-label="Geräte suchen" placeholder="Name, IP-Adresse oder Gruppe suchen …" value={search} onChange={e => setSearch(e.target.value)} /><kbd>/</kbd></div>
          <div className="list-head"><span>GERÄT</span><span>STATUS</span><span>VERBINDUNG</span></div>
          <div className="device-list">{visible.map((device,index)=><DeviceEntry key={device.id} device={device} index={index} selected={current?.id===device.id} info={info[device.id]} design={design} onSelect={()=>setSelected(device.id)} onConnect={()=>connect(device)}/>)}</div>
          {!visible.length && <div className="empty-list"><Server size={30} /><h3>{devices.length ? 'Kein passendes Gerät' : 'Dein erstes Gerät wartet.'}</h3><p>{devices.length ? 'Passe die Suche oder den Filter an.' : 'Füge ein Intel-AMT-Gerät oder JetKVM hinzu, um loszulegen.'}</p>{!devices.length && <Button icon={Plus} onClick={() => setForm({})}>Gerät hinzufügen</Button>}</div>}
          <div className="list-footer"><span>{visible.length} von {devices.length} Geräten</span><span><span className="tiny-dot" />{checkingAll ? 'Geräte werden geprüft …' : browser ? refreshSeconds ? `Automatisch alle ${refreshSeconds} Sekunden` : 'Automatik aus · Prüfung bei Anmeldung' : 'Status wird auf Anfrage geprüft'}</span></div>
          <div className="workflow-note"><div className="note-symbol"><Monitor size={24} /></div><div><h3>Der direkte Weg zu deinem System.</h3><p>Bildschirm, Tastatur und Maus über Intel AMT oder JetKVM. Keine Installation auf dem Zielgerät nötig.</p></div><ArrowUpRight size={24} /></div>
          <section className="activity-preview"><div className="section-title"><h2>Letzte Aktivität</h2><button onClick={() => setPage('activity')}>Alle anzeigen <ChevronRight size={14} /></button></div>{activity.length ? activity.slice(0, 3).map(a => <div className="activity-line" key={a.id}><span className={`event-icon ${a.type}`}>{a.type === 'error' ? <CircleHelp size={14} /> : <Check size={14} />}</span><span>{a.text}</span><time>{prettyTime(a.at)}</time></div>) : <div className="activity-empty"><Activity size={17} /><span>Hier erscheinen deine Verbindungs- und Verwaltungsaktionen.</span></div>}</section>
        </section>
        <aside className="details">{current?.kind==='jetkvm'?<JetDetails device={current} info={currentInfo} user={user} onEdit={()=>setForm(current)} onRemove={()=>removeDevice(current)} onConnect={()=>connect(current)} onInspect={()=>inspect(current)} onTrust={()=>trust(current)}/>:current ? <><div className="details-top"><span>GERÄTEDETAILS</span><div><Button icon={Settings2} className="device-edit-button" aria-label="Gerät bearbeiten" disabled={current.permissions&&!current.permissions.includes('manage')} onClick={() => setForm(current)}>Bearbeiten</Button><IconButton icon={Trash2} title="Gerät entfernen" onClick={() => removeDevice(current)} /></div></div><div className="device-illustration"><div className="device-glow" /><div className="tower"><div className="tower-side" /><div className="tower-front"><div className="tower-slots" /><div className="tower-line" /><span>AMT</span><div className="tower-ports"><i /><i /><b /></div></div></div><span className="illustration-chip"><Cpu size={12} />vPro / AMT</span></div><div className="detail-name"><h2>{current.name}</h2><span>{current.host}</span></div><div className="detail-status"><Badge state={currentInfo.state} /><span>{prettySnapshot(currentInfo.checkedAt)}</span></div><Button icon={Monitor} variant="primary wide" onClick={() => connect(current)}>KVM öffnen<ArrowUpRight size={16} /></Button><Button icon={TerminalSquare} className="wide sol-open" disabled={current.permissions&&!current.permissions.includes('sol')} onClick={()=>connect(current,'sol')}>SOL-Konsole öffnen</Button><div className="detail-actions"><Button icon={RefreshCw} onClick={() => inspect(current)} disabled={currentInfo.state === 'checking'}>Prüfen</Button><Button icon={Power} onClick={() => power(current, 'on')} disabled={busy}>Einschalten</Button></div>
          {currentInfo.error && <div className="inline-error"><CircleHelp size={17} /><span>{currentInfo.error}</span></div>}
          {currentInfo.checkedAt&&currentInfo.state!=='online'&&<div className="snapshot-note"><ClockSnapshot/><span>Gespeicherter Stand vom {prettySnapshot(currentInfo.checkedAt)}. {currentInfo.state==='checking'?'Wird gerade aktualisiert …':'Mit „Prüfen“ aktualisieren.'}</span></div>}
          <div className="detail-grid"><span>Hostname</span><strong>{currentInfo.hostName || 'Noch nicht ermittelt'}</strong><span>Firmware</span><strong>{currentInfo.firmware ? `Intel AMT ${currentInfo.firmware}` : 'Noch nicht ermittelt'}</strong><span>Betriebszustand</span><strong>{currentInfo.powerState === '2' ? 'Eingeschaltet' : currentInfo.powerState === '8' ? 'Ausgeschaltet' : 'Unbekannt'}</strong><span>KVM im MEBx</span><strong className={currentInfo.kvm?.EnabledByMEBx === 'true' ? 'positive' : ''}>{currentInfo.kvm?.EnabledByMEBx === 'true' ? 'Aktiviert' : 'Noch nicht ermittelt'}</strong><span>Benutzer</span><strong>{current.username}</strong></div>
          <div className="certificate-card"><ShieldCheck size={19} /><div><strong>{current.fingerprint ? 'Zertifikat gespeichert' : 'Zertifikat prüfen'}</strong><span>{current.fingerprint ? 'SHA-256-Fingerabdruck hinterlegt' : 'Identität vor der Verbindung bestätigen'}</span></div><button onClick={() => trust(current)} disabled={busy} title="Zertifikat prüfen"><ChevronRight size={18} /></button></div><div className="power-actions"><button onClick={() => power(current, 'restart')} disabled={busy}>Neu starten</button><span>·</span><button onClick={() => power(current, 'off')} disabled={busy}>Ausschalten</button></div></> : <div className="detail-placeholder"><Monitor size={36} /><p>Deine Gerätedetails erscheinen hier.</p></div>}</aside></div>
      </div>}
      <div className="session-page" style={{ display: page === 'sessions' ? 'flex' : 'none' }}><div className="session-heading"><div><div className="eyebrow">KVM & SERIELLE KONSOLE</div><h1>Direkt am Gerät.</h1></div><span className="session-hint"><Keyboard size={16} />Strg + Alt + Umschalt löst die Eingabe</span></div>{sessions.length ? <><div className="session-tabs">{sessions.map(s => <div key={s.id} className={activeSession === s.id ? 'active' : ''}><button onClick={() => setActiveSession(s.id)}>{s.protocol==='sol'?<TerminalSquare size={14}/>:<Monitor size={14}/ >}{s.device.name} · {s.protocol.toUpperCase()}</button><IconButton icon={X} title={`Sitzung ${s.device.name} schließen`} onClick={() => closeSession(s.id)} /></div>)}</div>{sessions.map(s => s.protocol==='jetkvm'?<JetKvm key={s.id} session={s} active={page==='sessions'&&activeSession===s.id} onClose={()=>closeSession(s.id)}/>:s.protocol==='sol'?<Sol key={s.id} session={s} active={page==='sessions'&&activeSession===s.id} onClose={()=>closeSession(s.id)}/>:<Kvm key={s.id} session={s} active={page === 'sessions' && activeSession === s.id} onClose={() => closeSession(s.id)} />)}</> : <div className="session-empty"><div className="empty-monitor"><Monitor size={52} /></div><h2>Ein Klick bis zur Konsole.</h2><p>Öffne KVM oder SOL aus deiner Geräteübersicht.<br />Jedes Gerät erhält einen eigenen Sitzungstab.</p><Button icon={LayoutGrid} variant="primary" onClick={() => setPage('devices')}>Zu deinen Geräten</Button></div>}</div>
      {page === 'activity' && <div className="page-content"><div className="page-heading"><div><div className="eyebrow">DIESE APP-SITZUNG</div><h1>Nachvollziehbar.</h1><p>Verbindungen und Aktionen, ohne Kennwörter oder Bildschirminhalte zu protokollieren.</p></div></div><div className="activity-panel">{activity.length ? activity.map(a => <div className="activity-line" key={a.id}><span className={`event-icon ${a.type}`}><Activity size={15} /></span><span>{a.text}</span><time>{prettyTime(a.at)}</time></div>) : <div className="empty-list"><Activity size={32} /><h3>Noch keine Aktionen</h3><p>Prüfe ein Gerät oder öffne eine KVM-Sitzung.</p></div>}</div></div>}
      {page === 'settings' && <div className="page-content settings-page"><div className="page-heading"><div><div className="eyebrow">DEIN WORKSPACE</div><h1>So, wie du arbeitest.</h1><p>Gestaltung und Verbindungen für deine AMT-Konsole.</p></div></div><section className="settings-card appearance-settings"><AppearancePanel/></section><DisplaySettings/><ConnectionSettings/><section className="settings-card legacy-theme-options" hidden><h2>Darstellung</h2><p>Wähle das Erscheinungsbild deiner Anwendung.</p><div className="theme-options"><button className={theme === 'dark' ? 'selected' : ''} onClick={() => setTheme('dark')}><div className="theme-swatch dark-swatch"><span /><span /><span /></div><Moon size={17} />Dunkel{theme === 'dark' && <Check size={17} />}</button><button className={theme === 'light' ? 'selected' : ''} onClick={() => setTheme('light')}><div className="theme-swatch light-swatch"><span /><span /><span /></div><Sun size={17} />Hell{theme === 'light' && <Check size={17} />}</button></div></section><section className="settings-card"><h2>Zugangsdaten & Verbindung</h2><div className="setting-row"><ShieldCheck size={21} /><div><strong>{browser?"Kennworttresor auf dem Server":"Lokaler Kennwortspeicher"}</strong><p>{browser?'Gerätekennwörter werden verschlüsselt auf deinem Server gespeichert. Sie werden nicht an den Browser zurückgegeben.':!desktop ? 'In der Desktop-App verfügbar.' : encryptionAvailable ? 'Verschlüsselung über den Schlüsselspeicher deines Betriebssystems ist verfügbar.' : 'Kein sicherer Schlüsselspeicher verfügbar. Neue Kennwörter bleiben nur für diese Sitzung im Arbeitsspeicher.'}</p></div></div><div className="setting-row"><Globe2 size={21} /><div><strong>Direkte AMT-Verbindungen</strong><p>TLS 1.2 oder höher über die Ports 16993 und 16995. Für entfernte Standorte nutzt du dein VPN.</p></div></div><div className="setting-row"><Cpu size={21} /><div><strong>Kompatibilität</strong><p>KVM, Serial over LAN, virtuelle Medien und einmalige Startoptionen. Die verfügbaren Funktionen hängen von Firmware und MEBx-Einstellungen ab. CIRA und Kerberos werden noch nicht unterstützt.</p></div></div></section><p className="version-note">AMT Studio 0.3.1 · Docker + Browser · KVM-Decoder: Device Management Toolkit (Apache-2.0)</p></div>}
      <footer className="statusbar"><span><span className="tiny-dot" />{desktop ? workspace.mode==='team'?'Mit Teamserver verbunden':'Lokale Desktop-Anwendung' : 'Oberflächenvorschau · Keine Geräteverbindung'}</span><span>Intel Active Management Technology<span className="footer-separator">/</span>AMT STUDIO</span></footer>
    </main>
    {form && <DeviceForm groups={groups} team={workspace.mode==='team'} initial={form} onClose={() => setForm(null)} onSave={saveDevice} encryptionAvailable={encryptionAvailable} />}
    {toast && <div className="toast" role="status"><CircleHelp size={18} /><span>{toast}</span><IconButton icon={X} title="Hinweis schließen" onClick={() => setToast(null)} /></div>}
  </div>;
}
createRoot(document.getElementById('root')).render(<AppearanceProvider><PreferencesProvider><BrowserGate><App/></BrowserGate><ConfirmationHost/></PreferencesProvider></AppearanceProvider>);
