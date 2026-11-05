const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium,expect}=require('@playwright/test'),{createServer}=require('../server/server.cjs');
const root=path.join(__dirname,'..'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'amt-autocheck-ui-'));
(async()=>{
 const service=createServer({directory}),address=await service.listen(0);
 await service.identity.setup(fs.readFileSync(service.identity.setupFile,'utf8'),'checkadmin','autocheck-test-password');
 const store=service.controller.store,group=service.controller.groups.save({name:'Lab'}),devices=[];
 for(let n=1;n<=6;n++){
  const rows=store.save({name:'Testsystem '+n,host:'127.0.0.'+n,username:'admin',group:'Lab',groupId:group.id,...(n===6?{}:{password:'fixture-password',remember:true})});
  const device=rows.at(-1);devices.push(device);
  if(n!==5)store.trust(device.id,'ab'.repeat(32));
  store.recordInspection(store.get(device.id),store.get(device.id).fingerprint,{hostName:'cached-'+n,firmware:'19.0.0',powerState:'2',kvm:{EnabledByMEBx:'true'}});
 }
 const calls=[],pending=[];let active=0,maxActive=0,hold=true,failFirst=true;
 service.controller.ws=async(device,action)=>{
  assert.equal(action,'inspect');calls.push(device.id);active++;maxActive=Math.max(maxActive,active);
  try{
   if(hold)await new Promise(resolve=>pending.push(resolve));
   if(failFirst&&device.id===devices[0].id)throw new Error('Test: Gerät vorübergehend offline');
   return {hostName:'live-'+device.host,firmware:'19.0.5',powerState:'2',kvm:{EnabledByMEBx:'true'}};
  }finally{active--}
 };
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1512,height:1080}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 async function login(){await page.getByLabel('Benutzername',{exact:true}).fill('checkadmin');await page.getByLabel('Kennwort',{exact:true}).fill('autocheck-test-password');await page.getByRole('button',{name:'Workspace öffnen',exact:true}).click();await expect(page.locator('.device-row')).toHaveCount(6)}
 async function logout(){await page.getByRole('button',{name:'Teamserver',exact:true}).click();await page.getByRole('button',{name:'Abmelden',exact:true}).click();await page.getByRole('button',{name:'Workspace öffnen',exact:true}).waitFor()}
 function release(){for(const resolve of pending.splice(0))resolve()}
 try{
  await page.goto(`http://127.0.0.1:${address.port}`);await login();
  await expect.poll(()=>calls.length).toBe(2);
  await expect(page.locator('.device-row .badge.checking')).toHaveCount(2);
  await expect(page.getByText('cached-1',{exact:true})).toBeVisible();
  await expect(page.locator('.snapshot-note')).toContainText('Wird gerade aktualisiert');
  await expect(page.getByRole('button',{name:'Alle Geräte prüfen',exact:true})).toBeDisabled();
  // Refreshing the list or changing the page must not launch another batch.
  await page.getByRole('button',{name:'Workspace aktualisieren',exact:true}).click();
  await page.getByRole('button',{name:'Aktivität',exact:true}).click();await page.locator('nav').getByRole('button',{name:/^Geräte/}).click();
  await expect(page.locator('.device-row .badge.checking')).toHaveCount(2);
  hold=false;release();await expect(page.locator('.device-row .badge.online')).toHaveCount(3);
  await expect(page.locator('.device-row .badge.error')).toHaveCount(1);
  await expect(page.locator('.device-row .badge.cached')).toHaveCount(2);
  await expect(page.getByText('cached-1',{exact:true})).toBeVisible();
  assert.equal(calls.length,4);assert.equal(maxActive,2);
  assert.ok(!calls.includes(devices[4].id)&&!calls.includes(devices[5].id));
  for(const design of ['Luma','Orbit','Serein']){await page.getByRole('button',{name:'Design auswählen',exact:true}).click();await page.getByRole('button',{name:'Design '+design,exact:true}).click();await page.getByRole('button',{name:'Designauswahl schließen',exact:true}).click()}
  assert.equal(calls.length,4);
  // Logging out during a check stops the remaining queue and ignores late results.
  await logout();hold=true;failFirst=false;await login();await expect.poll(()=>calls.length).toBe(6);
  await logout();release();await expect.poll(()=>active).toBe(0);
  await page.getByRole('button',{name:'Workspace öffnen',exact:true}).waitFor();assert.equal(calls.length,6);
  hold=false;await login();await expect(page.locator('.device-row .badge.online')).toHaveCount(4);assert.equal(calls.length,10);
  await page.reload();await expect(page.locator('.device-row .badge.online')).toHaveCount(4);assert.equal(calls.length,14);
  await expect(page.getByText('live-127.0.0.1',{exact:true})).toBeVisible();
  assert.deepEqual(errors,[]);await page.screenshot({path:path.join(root,'artifacts/autocheck-login.png'),fullPage:true});
  const report={ok:true,automaticLogin:true,relogin:true,reload:true,maxConcurrent:maxActive,cachedVisibleWhileChecking:true,offlineDoesNotBlockOthers:true,unconfiguredSkipped:true,noDuplicateOnNavigationOrDesign:true,logoutStopsQueue:true,errors};
  fs.writeFileSync(path.join(root,'artifacts/autocheck-browser-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(error){await page.screenshot({path:path.join(root,'artifacts/autocheck-ui-failure.png'),fullPage:true});console.error(error.message);process.exitCode=1}
 finally{hold=false;release();await browser.close();await service.close();fs.rmSync(directory,{recursive:true,force:true})}
})().catch(error=>{console.error(error.message);process.exitCode=1});
