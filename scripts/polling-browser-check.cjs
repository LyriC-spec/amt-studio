const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium,expect}=require('@playwright/test'),{createServer}=require('../server/server.cjs');
const root=path.join(__dirname,'..'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'amt-polling-ui-'));
(async()=>{
 const service=createServer({directory}),address=await service.listen(0);
 await service.identity.setup(fs.readFileSync(service.identity.setupFile,'utf8'),'polladmin','polling-test-password');
 const store=service.controller.store,group=service.controller.groups.save({name:'Lab'});
 function add(n,trusted=true){const device=store.save({name:'Testsystem '+n,host:'127.0.0.'+n,username:'admin',group:'Lab',groupId:group.id,password:'fixture-password',remember:true}).at(-1);if(trusted)store.trust(device.id,'ab'.repeat(32));return device}
 const devices=[add(1),add(2),add(3),add(4,false)],calls=[],pending=[];let hold=false,active=0,maxActive=0;
 service.controller.ws=async(device,action)=>{assert.equal(action,'inspect');calls.push(device.id);active++;maxActive=Math.max(maxActive,active);try{if(hold)await new Promise(resolve=>pending.push(resolve));return {hostName:'live-'+device.host,firmware:'19.0.5',powerState:'2',kvm:{EnabledByMEBx:'true'}}}finally{active--}};
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1512,height:1080}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 function release(){for(const resolve of pending.splice(0))resolve()}
 async function complete(expected){await expect.poll(()=>calls.length).toBe(expected);await expect(page.locator('.device-row .badge.online')).toHaveCount(3);await expect(page.getByRole('button',{name:'Alle Geräte prüfen',exact:true})).toBeEnabled()}
 async function visibility(hidden){await page.evaluate(value=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>value});document.dispatchEvent(new Event('visibilitychange'))},hidden)}
 try{
  await page.clock.install();await page.goto(`http://127.0.0.1:${address.port}`);
  await page.getByLabel('Benutzername',{exact:true}).fill('polladmin');await page.getByLabel('Kennwort',{exact:true}).fill('polling-test-password');await page.getByRole('button',{name:'Workspace öffnen',exact:true}).click();await complete(3);
  hold=true;await page.clock.fastForward(61000);await expect.poll(()=>calls.length).toBe(5);
  await page.clock.fastForward(180000);assert.equal(calls.length,5);assert.equal(maxActive,2);
  hold=false;release();await complete(6);
  await visibility(true);await page.clock.fastForward(180000);assert.equal(calls.length,6);
  await visibility(false);await complete(9);
  // A later cycle obtains the current server list, including changes by another user.
  store.remove(devices[2].id);const added=add(5);await page.clock.fastForward(61000);await complete(12);
  assert.ok(calls.slice(9).includes(added.id));assert.ok(!calls.slice(9).includes(devices[2].id));assert.ok(!calls.includes(devices[3].id));
  await page.getByRole('button',{name:'Einstellungen',exact:true}).click();
  const interval=page.getByLabel('Automatische Aktualisierung',{exact:true});
  await interval.selectOption('15');await page.clock.fastForward(16000);await expect.poll(()=>calls.length).toBe(15);
  await interval.selectOption('300');await page.clock.fastForward(61000);assert.equal(calls.length,15);
  await interval.selectOption('0');await page.clock.fastForward(600000);assert.equal(calls.length,15);
  await page.reload();await complete(18);await page.getByRole('button',{name:'Einstellungen',exact:true}).click();await expect(interval).toHaveValue('0');
  await page.getByLabel('KVM-Tastaturbelegung',{exact:true}).selectOption('us');await page.reload();await complete(21);await page.getByRole('button',{name:'Einstellungen',exact:true}).click();await expect(page.getByLabel('KVM-Tastaturbelegung',{exact:true})).toHaveValue('us');
  for(const design of ['Serein','Luma','Orbit']){await page.setViewportSize({width:1512,height:1080});await page.getByRole('button',{name:'Design auswählen',exact:true}).click();await page.getByRole('dialog',{name:'Design auswählen',exact:true}).getByRole('button',{name:'Design '+design,exact:true}).click();await page.getByRole('button',{name:'Designauswahl schließen',exact:true}).click();for(const width of [1512,390]){await page.setViewportSize({width,height:1080});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)}}
  await page.setViewportSize({width:1512,height:1080});await page.screenshot({path:path.join(root,'artifacts/preferences.png'),fullPage:true});
  await page.getByRole('button',{name:'Teamserver',exact:true}).click();await page.getByRole('button',{name:'Abmelden',exact:true}).click();await page.getByRole('button',{name:'Workspace öffnen',exact:true}).waitFor();
  await page.clock.fastForward(180000);assert.equal(calls.length,21);assert.deepEqual(errors,[]);
  const report={ok:true,defaultIntervalSeconds:60,configurableInterval:true,disabledStopsTimer:true,preferencesSurviveReload:true,layouts:3,repeatedCycles:true,noOverlapDuringSlowRead:true,maxConcurrent:maxActive,hiddenTabPauses:true,visibleTabCatchesUp:true,updatedDeviceList:true,untrustedSkipped:true,logoutStopsTimer:true,errors};
  fs.writeFileSync(path.join(root,'artifacts/polling-browser-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(error){await page.screenshot({path:path.join(root,'artifacts/polling-ui-failure.png'),fullPage:true});console.error(error.message);process.exitCode=1}
 finally{hold=false;release();await browser.close();await service.close();fs.rmSync(directory,{recursive:true,force:true})}
})().catch(error=>{console.error(error.message);process.exitCode=1});
