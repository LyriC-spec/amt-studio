const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {randomUUID}=require('node:crypto');const WebSocket=require('ws');const {createServer}=require('../server/server.cjs');
test('Browser login uses HttpOnly cookies; mutations require exact Origin and session CSRF',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'amt-browser-')),service=createServer({directory});const address=await service.listen(0),origin=`http://127.0.0.1:${address.port}`;t.after(async()=>{await service.close();fs.rmSync(directory,{recursive:true,force:true})});
 const headers={'Content-Type':'application/json','X-AMT-Browser':'1','X-AMT-Client':randomUUID(),Origin:origin};
 const post=(route,payload,extra={})=>fetch(origin+route,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(payload)});
 await service.identity.setup(fs.readFileSync(service.identity.setupFile,'utf8'),'admin','browser-test-password');
 const login=await post('/api/login',{username:'admin',password:'browser-test-password'}),data=(await login.json()).data,cookie=login.headers.get('set-cookie').split(';')[0];assert.ok(login.headers.get('set-cookie').includes('HttpOnly'));assert.ok(login.headers.get('set-cookie').includes('SameSite=Strict'));assert.equal(data.token,undefined);assert.ok(data.csrf);headers.Cookie=cookie;
 let result=await post('/api/action',{action:'groupsSave',payload:{name:'Denied'}});assert.equal(result.status,403);headers['X-AMT-CSRF']=data.csrf;
 result=await post('/api/action',{action:'groupsSave',payload:{name:'Allowed'}});assert.equal(result.status,200);assert.equal((await result.json()).data.name,'Allowed');
 result=await post('/api/action',{action:'groupsSave',payload:{name:'Cross-origin'}},{Origin:'https://attacker.invalid'});assert.equal(result.status,403);
 const noOrigin={...headers};delete noOrigin.Origin;result=await fetch(origin+'/api/action',{method:'POST',headers:noOrigin,body:JSON.stringify({action:'list'})});assert.equal(result.status,403);
 result=await fetch(origin+'/api/session',{headers:{Cookie:cookie}});assert.equal((await result.json()).data.authenticated,true);
 const page=await fetch(origin+'/');assert.equal(page.status,200);assert.match(page.headers.get('content-type'),/text\/html/);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.ok(!(await page.text()).includes('browser-test-password'));
 for(const route of ['/server/identity.cjs','/package.json','/assets/..%2F..%2Fserver%2Fidentity.cjs']){const response=await fetch(origin+route);assert.notEqual(response.status,200)}
 await post('/api/logout',{});result=await fetch(origin+'/api/session',{headers:{Cookie:cookie}});assert.equal((await result.json()).data.authenticated,false);
});
test('Browser WebSockets reject foreign origins and isolate two tab connections',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'amt-tabs-')),service=createServer({directory}),address=await service.listen(0),origin=`http://127.0.0.1:${address.port}`;t.after(async()=>{await service.close();fs.rmSync(directory,{recursive:true,force:true})});await service.identity.setup(fs.readFileSync(service.identity.setupFile,'utf8'),'admin','browser-test-password');const {token}=await service.identity.login('admin','browser-test-password');
 const sockets=[];const connect=(source,client)=>new Promise((resolve,reject)=>{const socket=new WebSocket(`ws://127.0.0.1:${address.port}/api/events?client=${client}`,{headers:{Cookie:'amt-session='+token,Origin:source}});socket.once('error',reject);socket.once('message',data=>{sockets.push(socket);resolve(JSON.parse(data.toString()))})});
 await assert.rejects(connect('https://attacker.invalid',randomUUID()));assert.equal((await connect(origin,randomUUID())).type,'connected');assert.equal((await connect(origin,randomUUID())).type,'connected');assert.ok(sockets.every(socket=>socket.readyState===WebSocket.OPEN));service.identity.logout(token);await new Promise(resolve=>setTimeout(resolve,30));assert.ok(sockets.every(socket=>socket.readyState!==WebSocket.OPEN));
});

test('Missing WebSocket pongs release orphaned sessions without disconnecting a healthy tab',{timeout:60000},async t=>{
 t.mock.timers.enable({apis:['setInterval']});
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'amt-orphan-')),service=createServer({directory});
 const address=await service.listen(0),origin=`http://127.0.0.1:${address.port}`,sockets=[];
 t.after(async()=>{for(const ws of sockets)ws.terminate();await service.close();fs.rmSync(directory,{recursive:true,force:true})});
 await service.identity.setup(fs.readFileSync(service.identity.setupFile,'utf8'),'admin','browser-test-password');
 const {token}=await service.identity.login('admin','browser-test-password'),deadClient=randomUUID(),liveClient=randomUUID();
 const connect=(client,autoPong=true)=>new Promise((resolve,reject)=>{
  const ws=new WebSocket(`ws://127.0.0.1:${address.port}/api/events?client=${client}`,{autoPong,headers:{Cookie:'amt-session='+token,Origin:origin}});
  sockets.push(ws);ws.once('error',reject);ws.once('message',()=>resolve(ws));
 });
 const dead=await connect(deadClient,false),live=await connect(liveClient),closed=[];
 // Controller-owned redirections with no frame traffic still need to be closed.
 for(const [id,client]of [['dead-kvm',deadClient],['live-kvm',liveClient]])service.controller.sessions.set(id,{
  owner:service.identity.tokenKey(token)+'/'+client,session:{close(){closed.push(id);service.controller.sessions.delete(id)}}
 });
 const pinged=new Promise(resolve=>live.once('ping',resolve));t.mock.timers.tick(30000);await pinged;
 // Drain the real local WebSocket pong while only interval scheduling is mocked.
 await new Promise(resolve=>setTimeout(resolve,100));
 const disconnected=new Promise(resolve=>dead.once('close',resolve));t.mock.timers.tick(30000);await disconnected;
 assert.deepEqual(closed,['dead-kvm']);assert.equal(live.readyState,WebSocket.OPEN);
 assert.equal(service.controller.sessions.has('dead-kvm'),false);assert.equal(service.controller.sessions.has('live-kvm'),true);
 const replacement=await connect(deadClient);assert.equal(replacement.readyState,WebSocket.OPEN);
 assert.equal(service.controller.sessions.has('live-kvm'),true);
});
