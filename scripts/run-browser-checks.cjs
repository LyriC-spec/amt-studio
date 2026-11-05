const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..');fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
for(const file of ['autocheck-browser-check.cjs','polling-browser-check.cjs','snapshot-browser-check.cjs','device-edit-browser-check.cjs','consoles-browser-check.cjs','jetkvm-browser-check.cjs']){const r=spawnSync(process.execPath,[path.join(__dirname,file)],{cwd:root,stdio:'inherit',timeout:120000});if(r.error||r.status!==0){console.error(file,r.error?.message||'failed');process.exit(1)}}
