const fs=require('node:fs');const path=require('node:path');const {randomUUID}=require('node:crypto');
class Audit {
  constructor(directory){this.file=path.join(directory,'activity.jsonl');fs.mkdirSync(directory,{recursive:true})}
  write(user,action,deviceId,result='ok',detail=''){const event={id:randomUUID(),at:new Date().toISOString(),userId:user?.id||'local',username:user?.username||'Lokaler Benutzer',action,deviceId:deviceId||null,result,detail:String(detail).slice(0,300)};if(fs.existsSync(this.file)&&fs.statSync(this.file).size>8*1024*1024)fs.renameSync(this.file,this.file+'.previous');fs.appendFileSync(this.file,JSON.stringify(event)+'\n',{mode:0o600});return event}
  list(limit=200){if(!fs.existsSync(this.file))return[];return fs.readFileSync(this.file,'utf8').trim().split('\n').filter(Boolean).slice(-Math.min(1000,limit)).reverse().map(line=>JSON.parse(line))}
}
module.exports={Audit};
