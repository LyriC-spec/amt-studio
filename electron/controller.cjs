const {Groups}=require('./groups.cjs');const {Audit}=require('./audit.cjs');const {MediaLibrary}=require('./media-library.cjs');const {Wsman}=require('./wsman.cjs');const {Redirection}=require('./redirection.cjs');const {MediaSession}=require('./media-session.cjs');const {RfbPolicy}=require('./rfb-policy.cjs');const {inspectCertificate,checkPin,friendlyError}=require('./security.cjs');const {can,requirePermission}=require('../server/identity.cjs');
const LOCAL_USER={id:'local',username:'Lokaler Benutzer',role:'admin',enabled:true,grants:[]};
const {JetClient,JetSession}=require('./jetkvm.cjs');
class Controller {
  constructor(store,identity){this.store=store;this.identity=identity;this.groups=new Groups(store.directory,store);this.audit=new Audit(store.directory);this.media=new MediaLibrary(store.directory);this.sessions=new Map()}
  user(context){return context.currentUser?context.currentUser():context.user||LOCAL_USER}
  admin(user){if(user.role!=='admin')throw new Error('Diese Aktion ist Administratoren vorbehalten.')}
  device(user,id,permission='view'){const device=this.store.get(id);requirePermission(user,device.groupId,permission);return device}
  list(user){return {devices:this.store.list().filter(d=>can(user,d.groupId,'view')).map(d=>({...d,permissions:['view','control','power','sol','media','boot','manage'].filter(p=>can(user,d.groupId,p))})),groups:this.groups.list().filter(g=>can(user,g.id,'view')),encryptionAvailable:this.store.encryptionAvailable(),platform:process.platform,user}}
  async ws(device,method,...args){if(device.kind==='jetkvm')throw new Error('Diese Intel-AMT-Funktion ist für JetKVM nicht verfügbar.');const ws=new Wsman(device,await this.store.password(device.id));try{return await ws[method](...args)}finally{ws.close()}}
  jetClient(device){this.jetClients||=new WeakMap();if(!this.jetClients.has(device))this.jetClients.set(device,new JetClient(device,()=>this.store.password(device.id)));return this.jetClients.get(device)}
  async startJet(context,p){
    const user=this.user(context);this.admin(user);const device=this.device(user,p.id,'manage');
    if(device.kind!=='jetkvm')throw new Error('Kein JetKVM-Gerät.');
    if(typeof p.sessionId!=='string'||!/^[a-f0-9-]{36}$/.test(p.sessionId)||this.sessions.has(p.sessionId)||this.sessions.size>=32)throw new Error('Ungültige oder zu viele Sitzungen.');
    if([...this.sessions.values()].some(s=>s.deviceId===device.id))throw new Error('Für dieses Gerät ist bereits eine Sitzung aktiv.');
    const valid=()=>{this.admin(this.user(context));this.device(this.user(context),device.id,'manage');if(this.store.get(device.id)!==device||context.isAlive&&!context.isAlive())throw new Error('JetKVM-Sitzung ist nicht mehr gültig.')};
    valid();const session=new JetSession(this.jetClient(device),valid),entry={session,deviceId:device.id,userId:user.id,username:user.username,protocol:'jetkvm',owner:context.owner,startedAt:new Date().toISOString(),context};
    this.sessions.set(p.sessionId,entry);
    const notify=event=>{try{context.notify({sessionId:p.sessionId,protocol:'jetkvm',...event})}catch{session.close()}};
    session.on('signal',signal=>notify({type:'jetSignal',signal}));session.on('failure',error=>{notify({type:'error',message:error.message});this.audit.write(user,'startJetKvm',device.id,'error',error.message)});
    session.on('closed',()=>{this.sessions.delete(p.sessionId);notify({type:'closed'});this.audit.write(user,'sessionClosed',device.id)});
    this.audit.write(user,'startJetKvm',device.id);void session.start();return {sessionId:p.sessionId};
  }
  async action(context,action,p={}){const user=this.user(context);if(!this.identity&&['usersSave','usersRemove','changePassword'].includes(action))throw new Error('Benutzerverwaltung benötigt einen Teamserver.');let data;
    if(action==='list')return this.list(user);
    if(action==='save'){if(user.role!=='admin')this.groups.get(p.groupId);const input=this.groups.resolve(p);if(p.id)this.device(user,p.id,'manage');requirePermission(user,input.groupId,'manage');if(p.id)this.closeDevice(p.id);this.store.save(input);data=this.list(user).devices}
    else if(action==='remove'){this.device(user,p.id,'manage');this.closeDevice(p.id);this.store.remove(p.id);data=this.list(user).devices}
    else if(action==='inspect'){
      const device=this.device(user,p.id),fingerprint=device.fingerprint;
      const result=device.kind==='jetkvm'?await this.jetClient(device).authenticate():await this.ws(device,'inspect');
      this.device(this.user(context),p.id);
      const saved=this.store.recordInspection(device,fingerprint,result);
      return {...result,checkedAt:saved.checkedAt};
    }
    else if(action==='details')return this.ws(this.device(user,p.id),'details');
    else if(action==='certificate'){const device=this.device(user,p.id,'manage');if(device.kind==='jetkvm'&&device.jetProtocol!=='https')throw new Error('Dieses JetKVM verwendet HTTP und hat kein TLS-Zertifikat.');return inspectCertificate(device)}
    else if(action==='trust'){const device=this.device(user,p.id,'manage'),cert=await inspectCertificate(device);checkPin({fingerprint256:cert.fingerprint,valid_from:cert.validFrom,valid_to:cert.validTo},p.fingerprint);this.store.trust(p.id,cert.fingerprint);data={trusted:true,devices:this.list(user).devices}}
    else if(action==='power')data=await this.ws(this.device(user,p.id,'power'),'power',p.action);
    else if(action==='boot')data=await this.ws(this.device(user,p.id,'boot'),'configureBoot',p);
    else if(action==='redirectionSettings')data=await this.ws(this.device(user,p.id,'manage'),'configureRedirection',p);
    else if(action==='groupsList')return this.groups.list().filter(g=>can(user,g.id,'view'));
    else if(action==='groupsSave'){this.admin(user);data=this.groups.save(p)}
    else if(action==='groupsRemove'){this.admin(user);for(const s of this.sessions.values())s.session.close();if(this.media.items.some(m=>m.groupId===p.id))throw new Error('Entferne zuerst die Medien dieser Gruppe.');data=this.groups.remove(p.id,p.targetId)}
    else if(action==='groupsAssign'){this.groups.get(p.groupId);requirePermission(user,p.groupId,'manage');for(const id of p.ids||[])this.device(user,id,'manage');for(const id of p.ids)this.closeDevice(id);data=this.groups.assign(p.ids,p.groupId)}
    else if(action==='audit')return this.audit.list().filter(e=>user.role==='admin'||e.userId===user.id);
    else if(action==='mediaList')return this.media.list().filter(m=>can(user,m.groupId,'media'));
    else if(action==='mediaRemove'){const item=this.media.get(p.id);requirePermission(user,item.groupId,'manage');if([...this.sessions.values()].some(s=>s.mediaId===p.id))throw new Error('Trenne zuerst die aktive Medienumleitung.');this.media.remove(p.id);data=true}
    else if(action==='usersList'){this.admin(user);if(!this.identity)throw new Error('Benutzerverwaltung ist im Teamserver verfügbar.');return this.identity.list()}
    else if(action==='usersSave'){this.admin(user);for(const grant of p.grants||[])this.groups.get(grant.groupId);data=await this.identity.save(p,()=>this.admin(this.user(context)))}
    else if(action==='usersRemove'){this.admin(user);this.identity.remove(p.id);data=true}
    else if(action==='changePassword'){await this.identity.changePassword(user.id,p.currentPassword,p.password);data=true}
    else if(action==='startJetKvm')return this.startJet(context,p);
    else if(['startKvm','startSol','startMedia'].includes(action)){if(this.device(user,p.id).kind==='jetkvm')throw new Error('Für JetKVM bitte die JetKVM-Konsole öffnen.');return this.startSession(context,action,p)}
    else if(action==='stopKvm'||action==='stopSession'){const entry=this.sessions.get(p.sessionId);if(entry&&entry.userId!==user.id&&user.role!=='admin')throw new Error('Diese Sitzung gehört einem anderen Benutzer.');entry?.session.close();return true}
    else if(action==='sessionsList')return [...this.sessions].filter(([,s])=>user.role==='admin'||s.userId===user.id).map(([id,s])=>({id,deviceId:s.deviceId,userId:s.userId,username:s.username,protocol:s.protocol,startedAt:s.startedAt,mediaId:s.mediaId}));
    else throw new Error('Unbekannte Aktion.');
    this.audit.write(user,action,p.id);return data;
  }
  async startSession(context,action,p){const user=this.user(context),protocol={startKvm:'kvm',startSol:'sol',startMedia:'media'}[action],device=this.device(user,p.id,protocol==='kvm'?'view':protocol);if(typeof p.sessionId!=='string'||!/^[a-f0-9-]{36}$/.test(p.sessionId)||this.sessions.has(p.sessionId)||this.sessions.size>=32)throw new Error('Ungültige oder zu viele Sitzungen.');if([...this.sessions.values()].some(s=>s.deviceId===device.id&&s.protocol===protocol))throw new Error('Für dieses Gerät ist bereits eine Sitzung dieses Typs aktiv.');let image;if(protocol==='media'){image=this.media.get(p.mediaId);requirePermission(user,image.groupId,'media');if(!['now','nextboot'].includes(p.mode))throw new Error('Ungültiger Medienmodus.')}
    const password=await this.store.password(device.id);if(context.isAlive&&!context.isAlive())throw new Error('Die Ereignisverbindung wurde getrennt.');this.device(this.user(context),device.id,protocol==='kvm'?'view':protocol);if(this.sessions.size>=32||this.sessions.has(p.sessionId)||[...this.sessions.values()].some(s=>s.deviceId===device.id&&s.protocol===protocol))throw new Error('Sitzung bereits aktiv.');if(protocol==='media'){this.media.get(image.id);requirePermission(this.user(context),image.groupId,'media')}if(this.store.get(device.id)!==device)throw new Error('Gerät wurde inzwischen geändert. Bitte erneut verbinden.');const session=protocol==='media'?new MediaSession(device,password,image,p.mode,{usbCompatibility:p.usbCompatibility===true}):new Redirection(device,password,protocol);const entry={session,deviceId:device.id,userId:user.id,username:user.username,protocol,mediaId:image?.id,owner:context.owner,startedAt:new Date().toISOString(),context,policy:protocol==='kvm'?new RfbPolicy(()=>can(this.user(context),this.store.get(device.id).groupId,'control')):null};this.sessions.set(p.sessionId,entry);const notify=event=>{try{this.device(this.user(context),device.id,protocol==='kvm'?'view':protocol);context.notify({sessionId:p.sessionId,protocol,...event})}catch{session.close()}};
    session.on('diagnostic',stats=>{if(protocol==='media')this.audit.write(user,'mediaProtocol',device.id,'error',JSON.stringify({code:stats.code,lastOpcode:stats.lastOpcode,bytesRead:stats.bytesRead,protocolErrors:stats.protocolErrors}))});
    session.on('ready',()=>notify({type:'ready'}));session.on('data',bytes=>notify({type:'data',data:new Uint8Array(bytes)}));session.on('active',()=>notify({type:'active'}));session.on('progress',stats=>notify({type:'progress',bytesRead:stats.bytesRead}));session.on('failure',error=>{notify({type:'error',...friendlyError(error)});this.audit.write(user,action,device.id,'error',friendlyError(error).message)});session.on('closed',()=>{this.sessions.delete(p.sessionId);try{context.notify({sessionId:p.sessionId,protocol,type:'closed'})}catch{};this.audit.write(user,'sessionClosed',device.id)});this.audit.write(user,action,device.id);void session.start();return {sessionId:p.sessionId};
  }
  input(context,id,data){const user=this.user(context),entry=this.sessions.get(id);if(!entry||entry.userId!==user.id||entry.owner!==context.owner)throw new Error('Sitzung nicht gefunden.');this.device(user,entry.deviceId,entry.protocol==='jetkvm'?'manage':entry.protocol==='kvm'?'view':'sol');if(entry.protocol==='jetkvm')this.admin(user);if(!(data instanceof Uint8Array)||data.byteLength>1048576)throw new Error('Ungültige Sitzungsdaten.');try{if(entry.protocol==='kvm')for(const frame of entry.policy.accept(data))entry.session.send(frame);else if(['sol','jetkvm'].includes(entry.protocol))entry.session.send(data)}catch(error){entry.session.close();throw error}}
  closeOwner(owner){for(const s of this.sessions.values())if(s.owner===owner)s.session.close()}
  closeUser(userId){for(const s of this.sessions.values())if(s.userId===userId)s.session.close()}
  closeDevice(id){for(const s of this.sessions.values())if(s.deviceId===id)s.session.close()}
  close(){for(const s of this.sessions.values())s.session.close()}
}
module.exports={Controller,LOCAL_USER};
