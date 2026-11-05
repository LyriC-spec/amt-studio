const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{once}=require('node:events'),{randomUUID}=require('node:crypto');
const {WebSocketServer}=require('ws');const {JetClient,JetSession}=require('../electron/jetkvm.cjs');const {validateDevice}=require('../electron/security.cjs');const {Store}=require('../electron/store.cjs');const {Controller,LOCAL_USER}=require('../electron/controller.cjs');
async function fixture(t,{password='fixture-password'}={}){
 let logins=0,requests=[];const sockets=new Set();
 const server=http.createServer(async(req,res)=>{requests.push(req.url);res.setHeader('Content-Type','application/json');if(req.url==='/device'){res.statusCode=req.headers.cookie==='authToken=fixture-cookie'?200:401;res.end(JSON.stringify(res.statusCode===200?{authMode:'password',deviceId:'secret-id'}:{error:'Unauthorized'}))}else if(req.url==='/auth/login-local'){logins++;let text='';for await(const b of req)text+=b;const ok=JSON.parse(text).password===password;res.statusCode=ok?200:401;if(ok)res.setHeader('Set-Cookie','authToken=fixture-cookie; HttpOnly');res.end('{}')}else{res.statusCode=404;res.end('{}')}});
 const wss=new WebSocketServer({noServer:true});server.on('upgrade',(req,socket,head)=>{if(req.headers.cookie!=='authToken=fixture-cookie'){socket.destroy();return}wss.handleUpgrade(req,socket,head,ws=>{sockets.add(ws);ws.on('close',()=>sockets.delete(ws));ws.send(JSON.stringify({type:'device-metadata',data:{deviceVersion:'fixture'}}));ws.on('message',data=>{if(data.toString()==='ping'){ws.send('pong');return}requests.push(JSON.parse(data.toString()));ws.send(JSON.stringify({type:'answer',data:'fixture-answer'}))})})});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{for(const socket of sockets)socket.terminate();wss.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))});
 const device=validateDevice({kind:'jetkvm',name:'Jet fixture',host:'127.0.0.1',jetPort:server.address().port});return {device,client:new JetClient(device,async()=>password),requests,logins:()=>logins};
}
test('JetKVM authenticates once, reuses its private cookie and relays only signaling',async t=>{
 const {client,logins,requests}=await fixture(t);const [a,b]=await Promise.all([client.authenticate(),client.authenticate()]);assert.equal(a.authMode,'password');assert.deepEqual(a,b);assert.equal(logins(),1);await client.authenticate();assert.equal(logins(),1);assert.ok(!JSON.stringify(a).includes('cookie'));
 const session=new JetSession(client,()=>{});t.after(()=>session.close());const metadata=once(session,'signal');await session.start();assert.equal((await metadata)[0].type,'device-metadata');assert.throws(()=>session.send(Buffer.from(JSON.stringify({type:'rpc',data:{method:'reboot'}}))),/Ungültiges/);const answer=once(session,'signal');session.send(Buffer.from(JSON.stringify({type:'offer',data:{sd:'fixture'}})));assert.equal((await answer)[0].type,'answer');assert.ok(requests.some(r=>r.type==='offer'));const closed=once(session,'closed');session.close();await closed;
});
test('Failed JetKVM login has a cooldown and does not follow redirects',async t=>{
 const {client,logins}=await fixture(t);client.password=async()=> 'wrong';await assert.rejects(client.authenticate(),/nicht akzeptiert/);await assert.rejects(client.authenticate(),/Minute/);assert.equal(logins(),1);
 const server=http.createServer((req,res)=>{res.writeHead(302,{Location:'http://127.0.0.1:1/secret'});res.end()});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));const c=new JetClient({...client.device,jetPort:server.address().port},async()=> 'never');await assert.rejects(c.authenticate(),/schnittstelle/);
});
test('JetKVM requires admin console access, rejects AMT actions, and invalidates changed connection credentials',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'amt-jet-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir,{isEncryptionAvailable:()=>false}),controller=new Controller(store);t.after(()=>controller.close());const context={user:LOCAL_USER,owner:'test'},[device]=await controller.action(context,'save',{kind:'jetkvm',name:'Test',host:'127.0.0.1',password:'fixture'});
 assert.equal(device.kind,'jetkvm');assert.equal(device.username,'local');assert.equal(device.password,undefined);assert.equal(await store.password(device.id),'fixture');
 await assert.rejects(controller.action({user:{id:'viewer',role:'viewer',grants:[]}},'startJetKvm',{id:device.id,sessionId:randomUUID()}),/Administratoren/);
 for(const action of ['startKvm','startSol','startMedia'])await assert.rejects(controller.action(context,action,{id:device.id,sessionId:randomUUID()}),/JetKVM-Konsole/);
 await assert.rejects(controller.action(context,'power',{id:device.id,action:'on'}),/nicht verfügbar/);
 store.save({...device,jetPort:8080});assert.equal(store.list()[0].hasPassword,false);await assert.rejects(store.password(device.id),/Kennwort/);
 assert.throws(()=>validateDevice({...device,jetProtocol:'file'}));assert.throws(()=>validateDevice({...device,jetPort:-1}));assert.throws(()=>validateDevice({...device,host:'127.0.0.1/path'}));
});
test('JetKVM German HID input and absolute pointer coordinates use protocol packets',async()=>{
 const {jetKeyboard,jetPointer}=await import('../src/jetkvm-input.mjs');const packets=[],keyboard=jetKeyboard(p=>packets.push([...p]));
 keyboard.handle({code:'KeyY',key:'z'},true,'de');assert.deepEqual(packets,[[5,28,1],[5,28,0]]);packets.length=0;
 keyboard.handle({code:'KeyQ',key:'@'},true,'de');assert.deepEqual(packets,[[5,230,1],[5,20,1],[5,20,0],[5,230,0]]);
 keyboard.handle({code:'ControlLeft',key:'Control'},true,'de');keyboard.release();assert.deepEqual(packets.at(-1),[5,224,0]);
 const pointer=jetPointer(16384,99999,2),v=new DataView(pointer.buffer);assert.equal(v.getInt32(1),16384);assert.equal(v.getInt32(5),32767);assert.equal(pointer[9],2);
});
