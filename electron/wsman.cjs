const https = require('node:https');
const { randomUUID } = require('node:crypto');
const { XMLParser } = require('fast-xml-parser');
const { connectTls } = require('./security.cjs');
const { authorization } = require('./digest.cjs');
const NS = { a: 'http://schemas.xmlsoap.org/ws/2004/08/addressing', w: 'http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd', s: 'http://www.w3.org/2003/05/soap-envelope', e: 'http://schemas.xmlsoap.org/ws/2004/09/enumeration' };
const resource = name => `http://${name.startsWith('CIM_') ? 'schemas.dmtf.org/wbem/wscim/1/cim-schema/2' : 'intel.com/wbem/wscim/1/' + (name.startsWith('IPS_') ? 'ips' : 'amt') + '-schema/1'}/${name}`;
const xml = value => String(value).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false, processEntities: true });
function find(object, key) {
  if (!object || typeof object !== 'object') return undefined;
  if (Object.hasOwn(object, key)) return object[key];
  for (const value of Object.values(object)) { const result = find(value, key); if (result !== undefined) return result; }
}
function envelope(device, name, action, body, selectors = {}) {
  const host = device.host.includes(':') ? `[${device.host}]` : device.host;
  return `<?xml version="1.0" encoding="UTF-8"?><s:Envelope ${Object.entries(NS).map(([k,v]) => `xmlns:${k}="${v}"`).join(' ')}><s:Header><a:To>https://${xml(host)}:${device.managementPort}/wsman</a:To><a:ReplyTo><a:Address>${NS.a}/role/anonymous</a:Address></a:ReplyTo><a:Action s:mustUnderstand="true">${xml(action)}</a:Action><w:ResourceURI s:mustUnderstand="true">${resource(name)}</w:ResourceURI><a:MessageID>uuid:${randomUUID()}</a:MessageID><w:OperationTimeout>PT60S</w:OperationTimeout>${Object.keys(selectors).length ? `<w:SelectorSet>${Object.entries(selectors).map(([k,v]) => `<w:Selector Name="${xml(k)}">${xml(v)}</w:Selector>`).join('')}</w:SelectorSet>` : ''}</s:Header><s:Body>${body}</s:Body></s:Envelope>`;
}
function makeAgent(device) {
  const agent = new https.Agent({ keepAlive: true, maxSockets: 1, timeout: 15000 });
  agent.createConnection = (_options, callback) => { connectTls(device, device.managementPort).then(socket => callback(null, socket), callback); };
  return agent;
}
async function request(device, body, auth, agent) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: device.host, port: device.managementPort, path: '/wsman', method: 'POST', agent, headers: { 'Content-Type': 'application/soap+xml;charset=UTF-8', 'Content-Length': Buffer.byteLength(body), ...(auth ? { Authorization: auth } : {}) } }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 2 * 1024 * 1024) req.destroy(new Error('AMT-Antwort überschreitet das Größenlimit.')); else chunks.push(chunk); });
      res.on('error', error => { agent.destroy(); reject(error); });
      res.on('end', () => { resolve({ status: res.statusCode, challenge: res.headers['www-authenticate'], body: Buffer.concat(chunks).toString('utf8') }); });
    });
    req.setTimeout(15000, () => req.destroy(new Error('Zeitüberschreitung beim AMT-Aufruf.')));
    req.on('error', error => { agent.destroy(); reject(error); }); req.end(body);
  });
}
class Wsman {
  constructor(device, password, transport = request) { this.device = device; this.password = password; this.transport = transport; this.challenge = null; this.nc = 0; this.agent = makeAgent(device); }
  close() { this.agent.destroy(); this.password = undefined; }
  async call(name, action, body, selectors) {
    const payload = envelope(this.device, name, action, body, selectors);
    const auth = () => this.challenge ? authorization(this.challenge, this.device.username, this.password, { nonceCount: ++this.nc }) : undefined;
    let response = await this.transport(this.device, payload, auth(), this.agent);
    if (response.status === 401) {
      this.challenge = response.challenge; this.nc = 0;
      if (!this.challenge) throw new Error('AMT hat die Anmeldung ohne Digest-Anfrage abgelehnt.');
      response = await this.transport(this.device, payload, auth(), this.agent);
    }
    if (response.status === 401) throw new Error('Anmeldung abgelehnt. Benutzername, Kennwort und AMT-Berechtigungen prüfen.');
    if (/<!DOCTYPE|<!ENTITY/i.test(response.body)) throw new Error('Unzulässige XML-Antwort.');
    const result = parser.parse(response.body);
    const fault = find(result, 'Fault');
    if (fault) { const reason = find(fault, 'Text') || find(fault, 'Value') || 'WS-Management-Fehler'; throw new Error(`AMT meldet (${action.split('/').pop()}): ` + String(typeof reason === 'object' ? reason['#text'] || JSON.stringify(reason) : reason).slice(0, 250)); }
    if (response.status !== 200) throw new Error(`AMT antwortet mit HTTP ${response.status}.`);
    return result;
  }
  async enumerate(name) {
    let result = await this.call(name, `${NS.e}/Enumerate`, '<e:Enumerate/>');
    const items = [];
    for (let page = 0; page < 32; page++) {
      const data = find(result, name); if (data) items.push(...(Array.isArray(data) ? data : [data]));
      const context = find(result, 'EnumerationContext');
      if (find(result, 'EndOfSequence') !== undefined || !context) return items;
      result = await this.call(name, `${NS.e}/Pull`, `<e:Pull><e:EnumerationContext>${xml(context)}</e:EnumerationContext></e:Pull>`);
    }
    throw new Error('AMT-Enumeration enthält zu viele Seiten.');
  }
  async inspect() {
    try { return await this.inspectData(); } finally { this.close(); }
  }
  async inspectData() {
    const general = (await this.enumerate('AMT_GeneralSettings'))[0] || {};
    const detail = {};
    for (const name of ['CIM_AssociatedPowerManagementService','IPS_KVMRedirectionSettingData','CIM_SoftwareIdentity']) {
      try { detail[name] = await this.enumerate(name); for (const row of detail[name]) delete row.RFBPassword; } catch (error) { detail[name] = { error: error.message }; }
    }
    const firmware = Array.isArray(detail.CIM_SoftwareIdentity) ? detail.CIM_SoftwareIdentity.find(x => /AMT/i.test(x.InstanceID || x.ElementName || '')) : null;
    return { hostName: general.HostName, powerState: detail.CIM_AssociatedPowerManagementService?.[0]?.PowerState || null, firmware: firmware?.VersionString || null, kvm: detail.IPS_KVMRedirectionSettingData?.[0] || null, detail, checkedAt: new Date().toISOString() };
  }
  async power(action) {
    try { return await this.powerRequest(action); } finally { this.close(); }
  }
  async details() {
    const result={};
    for(const name of ['AMT_RedirectionService','CIM_BootSourceSetting','AMT_BootSettingData','AMT_BootCapabilities','CIM_ComputerSystem','CIM_Processor','CIM_PhysicalMemory','CIM_BIOSElement','CIM_MediaAccessDevice','AMT_EthernetPortSettings','AMT_NetworkPortSystemDefensePolicy','IPS_OptInService']){
      try{result[name]=(await this.enumerate(name)).map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>!/password|secret/i.test(key))))}catch(error){result[name]={error:error.message}}
    }
    return result;
  }
  async method(name,method,parameters,selectors){const uri=resource(name);const result=await this.call(name,`${uri}/${method}`,`<p:${method}_INPUT xmlns:p="${uri}">${parameters}</p:${method}_INPUT>`,selectors);const code=String(find(result,'ReturnValue'));if(!['0','4096'].includes(code))throw new Error(`AMT hat ${method} abgelehnt (${code}).`);return result}
  async put(name,values,selectors){const uri=resource(name);return this.call(name,'http://schemas.xmlsoap.org/ws/2004/09/transfer/Put',`<p:${name} xmlns:p="${uri}">${Object.entries(values).map(([key,value])=>Array.isArray(value)?value.map(v=>`<p:${key}>${xml(v)}</p:${key}>`).join(''):`<p:${key}>${xml(value)}</p:${key}>`).join('')}</p:${name}>`,selectors)}
  async configureRedirection(options){
    if(typeof options.sol!=='boolean'||typeof options.media!=='boolean')throw new Error('Ungültige Umleitungsoptionen.');
    const current=(await this.enumerate('AMT_RedirectionService'))[0];if(!current)throw new Error('Umleitungsdienst nicht vorhanden.');
    const selectors={Name:current.Name};const state=32768+(options.media?1:0)+(options.sol?2:0);
    await this.method('AMT_RedirectionService','RequestStateChange',`<p:RequestedState>${state}</p:RequestedState><p:TimeoutPeriod>PT0S</p:TimeoutPeriod>`,selectors);
    if(current.ListenerEnabled!=='true'){const latest=(await this.enumerate('AMT_RedirectionService'))[0];await this.put('AMT_RedirectionService',{...latest,ListenerEnabled:'true'},selectors);}
    return {accepted:true,state:(await this.enumerate('AMT_RedirectionService'))[0]};
  }
  async configureBoot(options){
    const mode=options.mode;if(!['normal','bios','sol','media','source'].includes(mode))throw new Error('Ungültige Startoption.');
    const configurations=await this.enumerate('CIM_BootConfigSetting');const config=configurations[0];if(!config?.InstanceID)throw new Error('Startkonfiguration nicht verfügbar.');
    const epr=(name,key,value)=>`<a:Address>${NS.a}/role/anonymous</a:Address><a:ReferenceParameters><w:ResourceURI>${resource(name)}</w:ResourceURI><w:SelectorSet><w:Selector Name="${key}">${xml(value)}</w:Selector></w:SelectorSet></a:ReferenceParameters>`;
    if(mode!=='normal'){
      const boot=(await this.enumerate('AMT_BootSettingData'))[0];if(!boot?.InstanceID)throw new Error('AMT-Startoptionen fehlen.');
      let selectedSource;if(mode==='source'){selectedSource=(await this.enumerate('CIM_BootSourceSetting')).find(s=>s.InstanceID===options.sourceId);if(!selectedSource)throw new Error('Startquelle nicht gefunden.')}
      const values={...boot};for(const key of ['BIOSPause','BIOSSetup','ConfigurationDataReset','ForcedProgressEvents','LockKeyboard','LockPowerButton','LockResetButton','LockSleepButton','ReflashBIOS','UseIDER','UseSOL','UseSafeMode','UserPasswordBypass','SecureErase','PlatformErase'])if(key in values)values[key]='false';for(const key of ['BootMediaIndex','FirmwareVerbosity','IDERBootDevice'])if(key in values)values[key]='0';
      if(mode==='bios')values.BIOSSetup='true';if(mode==='sol')values.UseSOL='true';if(mode==='media'){values.UseIDER='true';values.IDERBootDevice=options.kind==='img'?'0':'1'}
      await this.put('AMT_BootSettingData',values,{InstanceID:boot.InstanceID});
      let source='';if(mode==='source'){const selected=selectedSource;source=`<p:Source>${epr('CIM_BootSourceSetting','InstanceID',selected.InstanceID)}</p:Source>`}
      await this.method('CIM_BootConfigSetting','ChangeBootOrder',source,{InstanceID:config.InstanceID});
    }
    await this.method('CIM_BootService','SetBootConfigRole',`<p:BootConfigSetting>${epr('CIM_BootConfigSetting','InstanceID',config.InstanceID)}</p:BootConfigSetting><p:Role>${mode==='normal'?32768:1}</p:Role>`,{Name:'Intel(r) AMT Boot Service'});
    return {accepted:true,message:'Startoption für den nächsten einzelnen Start gespeichert. Es wurde kein Neustart ausgelöst.'};
  }
  async powerRequest(action) {
    const states = { on: 2, off: 8, restart: 10 };
    if (!Object.hasOwn(states, action)) throw new Error('Unzulässige Stromaktion.');
    const service = resource('CIM_PowerManagementService');
    const body = `<p:RequestPowerStateChange_INPUT xmlns:p="${service}"><p:PowerState>${states[action]}</p:PowerState><p:ManagedElement><a:Address>${NS.a}/role/anonymous</a:Address><a:ReferenceParameters><w:ResourceURI>${resource('CIM_ComputerSystem')}</w:ResourceURI><w:SelectorSet><w:Selector Name="CreationClassName">CIM_ComputerSystem</w:Selector><w:Selector Name="Name">ManagedSystem</w:Selector></w:SelectorSet></a:ReferenceParameters></p:ManagedElement></p:RequestPowerStateChange_INPUT>`;
    const result = await this.call('CIM_PowerManagementService', `${service}/RequestPowerStateChange`, body, { Name: 'Intel(r) AMT Power Management Service' });
    const code = String(find(result, 'ReturnValue'));
    if (!['0','4096'].includes(code)) throw new Error(`AMT hat die Stromaktion abgelehnt (Rückgabewert ${code}).`);
    return { accepted: true, pending: code === '4096' };
  }
}
module.exports = { Wsman, xml, find, resource, envelope };
