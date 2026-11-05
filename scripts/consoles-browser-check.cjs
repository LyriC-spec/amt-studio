const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium,expect}=require('@playwright/test'),{createServer}=require('../server/server.cjs');
const root=path.join(__dirname,'..'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'amt-consoles-ui-'));
(async()=>{
 const service=createServer({directory}),address=await service.listen(0),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1512,height:1080}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const device={id:'11111111-1111-4111-8111-111111111111',name:'Console Test',host:'127.0.0.1',username:'admin',group:'Lab',permissions:['view','control','sol']},listeners=new Set(),sessions=new Map();
  window.consoleTest={packets:[],starts:[],stops:[]};
  const emit=(sessionId,type,extra={})=>listeners.forEach(fn=>fn({sessionId,type,...extra}));
  const data=(id,bytes)=>queueMicrotask(()=>emit(id,'data',{data:new Uint8Array(bytes)}));
  window.amt={browser:true,onKvm:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},list:async()=>({ok:true,data:{devices:[device],groups:[],user:{username:'tester',role:'admin'},encryptionAvailable:true}}),
   startKvm:async(_,id)=>{sessions.set(id,{protocol:'kvm',stage:0});window.consoleTest.starts.push({id,protocol:'kvm'});queueMicrotask(()=>{emit(id,'ready');data(id,new TextEncoder().encode('RFB 003.008\n'))});return{ok:true}},
   stopKvm:async id=>{sessions.delete(id);window.consoleTest.stops.push(id);return{ok:true}},
   action:async(action,p={})=>{if(action==='startSol'){sessions.set(p.sessionId,{protocol:'sol'});window.consoleTest.starts.push({id:p.sessionId,protocol:'sol'});queueMicrotask(()=>{emit(p.sessionId,'ready');data(p.sessionId,new TextEncoder().encode('Serielle Testkonsole\r\n> '))})}if(action==='stopSession'){sessions.delete(p.sessionId);window.consoleTest.stops.push(p.sessionId)}return{ok:true,data:[]}},
   sendKvm:(id,bytes)=>{const session=sessions.get(id);if(!session)return;if(session.protocol==='sol'){window.consoleTest.packets.push({protocol:'sol',bytes:Array.from(bytes)});data(id,bytes);return}
    if(session.stage===0){session.stage=1;data(id,[1,1]);return}if(session.stage===1){session.stage=2;data(id,[0,0,0,0]);return}if(session.stage===2){session.stage=3;const init=new Uint8Array(24),v=new DataView(init.buffer);v.setUint16(0,640);v.setUint16(2,360);init.set([16,16,0,1,0,31,0,63,0,31,11,5,0,0,0,0],4);data(id,init);return}
    if(bytes[0]===4||bytes[0]===5)window.consoleTest.packets.push({protocol:'kvm',bytes:Array.from(bytes)});
   }};
 });
 async function key(code,key,type='keydown',extra={}){await page.locator('canvas').dispatchEvent(type,{code,key,bubbles:true,cancelable:true,...extra})}
 try{
  await page.goto(`http://127.0.0.1:${address.port}`);await page.getByRole('button',{name:'KVM öffnen',exact:true}).click();await expect(page.locator('.kvm-status-text')).toHaveText('Verbunden');
  await key('KeyA','a');assert.equal((await page.evaluate(()=>window.consoleTest.packets)).length,0);
  await page.getByRole('button',{name:'Tastatur & Maus aktivieren',exact:true}).click();await expect(page.locator('canvas')).toBeFocused();
  await page.locator('canvas').click();
  const pointer=await page.evaluate(()=>window.consoleTest.packets.filter(p=>p.bytes[0]===5).at(-1).bytes);
  const position=new DataView(new Uint8Array(pointer).buffer);assert.ok(Math.abs(position.getUint16(2)-320)<=1);assert.ok(Math.abs(position.getUint16(4)-180)<=1);
  for(const [code,char] of [['KeyY','z'],['KeyZ','y'],['Quote','ä'],['Semicolon','ö'],['BracketLeft','ü'],['Minus','ß'],['KeyQ','@'],['IntlBackslash','|']]){await key(code,char);await key(code,char,'keyup')}
  const down=await page.evaluate(()=>window.consoleTest.packets.filter(p=>p.protocol==='kvm'&&p.bytes[0]===4&&p.bytes[1]===1).map(p=>new DataView(new Uint8Array(p.bytes).buffer).getUint32(4)));for(const symbol of [121,122,39,59,91,45,113,0xffea,0x17170056])assert.ok(down.includes(symbol));
  await key('ControlLeft','Control');await page.getByRole('button',{name:'Einstellungen',exact:true}).click();const packets=await page.evaluate(()=>window.consoleTest.packets);assert.ok(packets.some(p=>p.bytes[0]===4&&p.bytes[1]===0&&new DataView(new Uint8Array(p.bytes).buffer).getUint32(4)===0xffe3));
  await page.locator('nav').getByRole('button',{name:/^Geräte/}).click();await page.getByRole('button',{name:'SOL-Konsole öffnen',exact:true}).click();await expect(page.locator('.sol-session [role=status]')).toHaveText('Verbunden');await expect(page.locator('.sol-session')).toContainText('Bytes empfangen');
  await page.locator('.sol-session .xterm-helper-textarea').fill('');await page.keyboard.type('SOL-Test');await expect.poll(async()=>await page.evaluate(()=>window.consoleTest.packets.filter(p=>p.protocol==='sol').flatMap(p=>p.bytes).length)).toBeGreaterThan(0);
  await page.getByRole('button',{name:'Einstellungen',exact:true}).click();await page.locator('nav').getByRole('button',{name:/^KVM & SOL/}).click();assert.equal((await page.evaluate(()=>window.consoleTest.starts.filter(s=>s.protocol==='sol'))).length,1);
  for(const design of ['Serein','Luma','Orbit']){await page.setViewportSize({width:1512,height:1080});await page.getByRole('button',{name:'Design auswählen',exact:true}).click();await page.getByRole('button',{name:'Design '+design,exact:true}).click();await page.getByRole('button',{name:'Designauswahl schließen',exact:true}).click();for(const width of [1512,390]){await page.setViewportSize({width,height:1080});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,design+' SOL '+width)}}
  await page.setViewportSize({width:1512,height:1080});await page.screenshot({path:path.join(root,'artifacts/sol-console.png'),fullPage:true});
  await page.getByRole('button',{name:'SOL trennen',exact:true}).click();assert.equal((await page.evaluate(()=>window.consoleTest.stops)).length,1);
  await page.locator('.session-tabs button').filter({hasText:'KVM'}).click();await page.screenshot({path:path.join(root,'artifacts/kvm-keyboard.png'),fullPage:true});
  for(const width of [1512,390]){await page.setViewportSize({width,height:1080});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'KVM '+width)}
  await page.getByRole('button',{name:'Verbindung trennen',exact:true}).click();assert.deepEqual(errors,[]);
  const report={ok:true,emulatedTransport:true,viewOnlyBlocksInput:true,enableFocusesCanvas:true,germanKeyPackets:true,blurReleasesKeys:true,solSendReceive:true,solSurvivesNavigation:true,solCloseStopsSession:true,layouts:3,errors};fs.writeFileSync(path.join(root,'artifacts/consoles-browser-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(error){await page.screenshot({path:path.join(root,'artifacts/consoles-ui-failure.png'),fullPage:true});console.error(error.message);process.exitCode=1}
 finally{await browser.close();await service.close();fs.rmSync(directory,{recursive:true,force:true})}
})().catch(error=>{console.error(error.message);process.exitCode=1});
