const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium,expect}=require('@playwright/test'),{createServer}=require('../server/server.cjs');
const root=path.join(__dirname,'..'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'amt-scale-ui-'));
(async()=>{
 const service=createServer({directory}),address=await service.listen(0);await service.identity.setup(fs.readFileSync(service.identity.setupFile,'utf8'),'scaleadmin','scale-test-password');
 const group=service.controller.groups.save({name:'Homelab'});for(let n=1;n<=4;n++)service.controller.store.save({name:'Testgerät '+n,host:'192.0.2.'+n,username:'admin',groupId:group.id,group:'Homelab'});
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1512,height:1080}}),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
 async function login(){await page.getByLabel('Benutzername',{exact:true}).fill('scaleadmin');await page.getByLabel('Kennwort',{exact:true}).fill('scale-test-password');await page.getByRole('button',{name:'Workspace öffnen',exact:true}).click();await expect(page.locator('.device-row')).toHaveCount(4)}
 async function fits(label){const sizes=await page.evaluate(()=>({overflow:[...document.querySelectorAll('main *')].filter(e=>e.getClientRects().length&&e.getBoundingClientRect().right>innerWidth+2).slice(0,12).map(e=>({tag:e.tagName,class:e.className,right:e.getBoundingClientRect().right})),width:innerWidth,scroll:document.documentElement.scrollWidth,boxes:[...document.querySelectorAll('.app-shell,.details,.device-section,.display-preferences,.appearance-dialog,.device-modal')].filter(e=>e.getClientRects().length).map(e=>({class:e.className,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right}))}));assert.ok(sizes.scroll<=sizes.width+2,label+' '+JSON.stringify(sizes));for(const box of sizes.boxes)assert.ok(box.left>=-2&&box.right<=sizes.width+2,label+' '+JSON.stringify(box))}
 try{
  await page.goto(`http://127.0.0.1:${address.port}`);await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.documentElement).zoom)).toBe('1.2');await login();
  for(const design of ['Serein','Luma','Orbit']){
   await page.setViewportSize({width:1512,height:1080});await page.getByRole('button',{name:'Design auswählen',exact:true}).click();await page.getByRole('dialog',{name:'Design auswählen',exact:true}).getByRole('button',{name:'Design '+design,exact:true}).click();await page.getByRole('button',{name:'Designauswahl schließen',exact:true}).click();
   for(const scale of [100,110,120,130,140,150]){
    await page.getByRole('button',{name:'Einstellungen',exact:true}).click();await page.getByLabel('Darstellungsgröße',{exact:true}).selectOption(String(scale));await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.documentElement).zoom)).toBe(String(scale/100));
    for(const width of [1512,1000,390]){await page.setViewportSize({width,height:1080});await fits(`${design} settings ${scale}/${width}`);await page.locator('nav').getByRole('button',{name:/^Geräte/}).click();await fits(`${design} fleet ${scale}/${width}`);await page.getByRole('button',{name:'Gerät hinzufügen',exact:true}).click();await fits(`${design} modal ${scale}/${width}`);await page.getByRole('button',{name:'Schließen',exact:true}).click();checks.push({design,scale,width});await page.getByRole('button',{name:'Einstellungen',exact:true}).click()}
    await page.setViewportSize({width:1512,height:1080});
   }
  }
  await page.getByLabel('Darstellungsgröße',{exact:true}).selectOption('120');await page.reload();await page.getByRole('button',{name:'Einstellungen',exact:true}).click();await expect(page.getByLabel('Darstellungsgröße',{exact:true})).toHaveValue('120');await page.screenshot({path:path.join(root,'artifacts/interface-scale-120.png'),fullPage:true});
  await page.getByRole('button',{name:'Auf 100 % zurücksetzen',exact:true}).click();await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.documentElement).zoom)).toBe('1');await page.reload();await page.getByRole('button',{name:'Einstellungen',exact:true}).click();await expect(page.getByLabel('Darstellungsgröße',{exact:true})).toHaveValue('100');
  await page.getByRole('button',{name:'Teamserver',exact:true}).click();await page.getByRole('button',{name:'Abmelden',exact:true}).click();await expect(page.getByRole('button',{name:'Workspace öffnen',exact:true})).toBeVisible();await fits('login');assert.deepEqual(errors,[]);
  const report={ok:true,defaultPercent:120,choices:6,combinations:checks.length,persistent:true,reset:true,dialogsFit:true,checks,errors};fs.writeFileSync(path.join(root,'artifacts/scale-browser-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,checks:undefined}));
 }catch(error){await page.screenshot({path:path.join(root,'artifacts/scale-ui-failure.png'),fullPage:true});console.error(error.message);process.exitCode=1}
 finally{await browser.close();await service.close();fs.rmSync(directory,{recursive:true,force:true})}
})().catch(error=>{console.error(error.message);process.exitCode=1});
