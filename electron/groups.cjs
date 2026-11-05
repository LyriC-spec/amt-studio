const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
class Groups {
  constructor(directory, store) { this.store=store;this.file=path.join(directory,'groups.json');this.groups=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):[]; for(const device of store.devices){let group=this.groups.find(g=>g.id===device.groupId)||this.groups.find(g=>g.name===device.group);if(!group){group={id:randomUUID(),name:device.group||'Meine Geräte',description:'',color:'#b5e9cb'};this.groups.push(group)}device.groupId=group.id;}this.persist();store.persist(); }
  list(){return this.groups.map(g=>({...g,count:this.store.devices.filter(d=>d.groupId===g.id).length}))}
  get(id){const group=this.groups.find(g=>g.id===id);if(!group)throw new Error('Gruppe nicht gefunden.');return group}
  save(input){const name=String(input.name||'').trim();if(!name||name.length>80||/[\x00-\x1f]/.test(name))throw new Error('Gruppenname ist ungültig.');if(this.groups.some(g=>g.id!==input.id&&g.name.toLowerCase()===name.toLowerCase()))throw new Error('Dieser Gruppenname ist bereits vergeben.');const old=input.id?this.get(input.id):null;const group={id:old?.id||randomUUID(),name,description:String(input.description||'').slice(0,500),color:/^#[a-f0-9]{6}$/i.test(input.color)?input.color:'#b5e9cb'};this.groups=this.groups.filter(g=>g.id!==group.id).concat(group);for(const d of this.store.devices)if(d.groupId===group.id)d.group=group.name;this.persist();this.store.persist();return group}
  assign(ids,groupId){const group=this.get(groupId);if(!Array.isArray(ids)||ids.length>500)throw new Error('Ungültige Geräteauswahl.');const devices=ids.map(id=>this.store.get(id));for(const device of devices){device.groupId=group.id;device.group=group.name}this.store.persist();return this.list()}
  remove(id,targetId){this.get(id);const assigned=this.store.devices.filter(d=>d.groupId===id);if(assigned.length){if(!targetId||targetId===id)throw new Error('Wähle zuerst eine andere Gruppe für die enthaltenen Geräte.');this.assign(assigned.map(d=>d.id),targetId)}this.groups=this.groups.filter(g=>g.id!==id);this.persist();return this.list()}
  resolve(input){let group=input.groupId?this.get(input.groupId):this.groups.find(g=>g.name===input.group);if(!group)group=this.save({name:input.group||'Meine Geräte'});return {...input,groupId:group.id,group:group.name}}
  persist(){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.groups,null,2),{mode:0o600});fs.renameSync(this.file+'.tmp',this.file)}
}
module.exports={Groups};
