const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
class MediaLibrary {
  constructor(directory){this.directory=directory;this.file=path.join(directory,'media.json');this.blobs=path.join(directory,'media');fs.mkdirSync(this.blobs,{recursive:true});this.items=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):[]}
  list(){return this.items.map(({file,...item})=>item)}
  get(id){const item=this.items.find(i=>i.id===id);if(!item)throw new Error('Medium nicht gefunden.');return item}
  async add(file,groupId,originalName,authorize=()=>{}){const stat=await fs.promises.stat(file);const name=path.basename(originalName||file);if(!/\.(iso|img)$/i.test(name)||!stat.isFile()||stat.size<512||stat.size>64*1024**3)throw new Error('Wähle eine ISO- oder IMG-Datei zwischen 512 Byte und 64 GiB.');const sector=/\.iso$/i.test(name)?2048:512;if(stat.size%sector)throw new Error(`Die Image-Größe muss ein Vielfaches von ${sector} Byte sein.`);const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);const item={id:crypto.randomUUID(),name,groupId,size:stat.size,kind:sector===2048?'iso':'img',sha256:hash.digest('hex'),createdAt:new Date().toISOString(),file:path.resolve(file)};authorize();this.items.push(item);this.persist();return this.list().find(i=>i.id===item.id)}
  remove(id){const item=this.get(id);this.items=this.items.filter(i=>i.id!==id);this.persist();if(path.dirname(item.file)===path.resolve(this.blobs)&&/^[a-f0-9-]+\.(iso|img)$/i.test(path.basename(item.file)))fs.unlinkSync(item.file);return this.list()}
  persist(){fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.items,null,2),{mode:0o600});fs.renameSync(this.file+'.tmp',this.file)}
}
module.exports={MediaLibrary};
