const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../electron/store.cjs'),{Controller,LOCAL_USER}=require('../electron/controller.cjs');
const keyring={isEncryptionAvailable:()=>false};
function fixture(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'amt-snapshot-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const store=new Store(directory,keyring),controller=new Controller(store);t.after(()=>controller.close());const context={user:LOCAL_USER,owner:'test'};return{directory,store,controller,context}}
const sample={hostName:'lab-host',firmware:'19.0.5',powerState:'2',kvm:{EnabledByMEBx:'true',Password:'never-persist-me'},detail:{secret:'never-persist-me'}};
test('Successful device reads and certificate pins survive restart without storing raw response or client-supplied metadata',async t=>{
 const {directory,store,controller,context}=fixture(t);const [row]=await controller.action(context,'save',{name:'Lab',host:'127.0.0.1',username:'admin'});store.trust(row.id,'ab'.repeat(32));controller.ws=async()=>sample;
 const result=await controller.action(context,'inspect',{id:row.id});assert.ok(result.checkedAt);
 let restored=new Store(directory,keyring);assert.equal(restored.get(row.id).fingerprint,'ab'.repeat(32));assert.equal(restored.get(row.id).lastInspection.hostName,'lab-host');assert.equal(restored.get(row.id).lastInspection.firmware,'19.0.5');assert.equal(restored.get(row.id).lastInspection.state,undefined);assert.ok(!fs.readFileSync(restored.file,'utf8').includes('never-persist-me'));
 restored.save({...restored.list()[0],name:'Renamed',lastInspection:{hostName:'forged'},fingerprint:'forged'});restored=new Store(directory,keyring);assert.equal(restored.get(row.id).lastInspection.hostName,'lab-host');assert.equal(restored.get(row.id).fingerprint,'ab'.repeat(32));
 restored.trust(row.id,'cd'.repeat(32));assert.equal(restored.get(row.id).lastInspection,undefined);restored.recordInspection(restored.get(row.id),'cd'.repeat(32),sample);restored.save({...restored.list()[0],host:'127.0.0.2'});assert.equal(restored.get(row.id).lastInspection,undefined);assert.equal(restored.get(row.id).fingerprint,undefined);
});
test('Failed reads preserve the last successful snapshot; concurrent device edits cannot persist obsolete results',async t=>{
 const {store,controller,context}=fixture(t);const [row]=await controller.action(context,'save',{name:'Lab',host:'127.0.0.1',username:'admin'});controller.ws=async()=>sample;await controller.action(context,'inspect',{id:row.id});const before=JSON.stringify(store.get(row.id).lastInspection);
 controller.ws=async()=>{throw new Error('offline')};await assert.rejects(controller.action(context,'inspect',{id:row.id}),/offline/);assert.equal(JSON.stringify(store.get(row.id).lastInspection),before);
 let finish;controller.ws=()=>new Promise(resolve=>finish=resolve);const pending=controller.action(context,'inspect',{id:row.id});store.save({...row,host:'127.0.0.2'});finish(sample);await assert.rejects(pending,/inzwischen geändert/);assert.equal(store.get(row.id).lastInspection,undefined);
});
