const {EventEmitter}=require('node:events');const {Worker}=require('node:worker_threads');const path=require('node:path');const {Redirection}=require('./redirection.cjs');
class MediaSession extends EventEmitter {
  constructor(device,password,image,mode){super();this.device=device;this.image=image;this.mode=mode;this.redirection=new Redirection(device,password,'media');this.closed=false}
  start(){this.redirection.on('failure',e=>this.fail(e));this.redirection.on('closed',()=>this.close());this.redirection.on('ready',()=>{this.emit('ready');this.worker=new Worker(path.join(__dirname,'media-worker.cjs'),{workerData:{file:this.image.file,size:this.image.size,kind:this.image.kind,mode:this.mode},resourceLimits:{maxOldGenerationSizeMb:128}});this.worker.on('error',e=>this.fail(new Error('Medienumleitung fehlgeschlagen: '+e.message)));this.worker.on('exit',()=>this.close());this.worker.on('message',m=>{if(this.closed)return;if(m.type==='send')this.redirection.socket.write(Buffer.from(m.data),()=>{if(!this.closed)this.worker.postMessage({type:'ack',id:m.id})});else if(m.type==='error')this.fail(new Error(m.message));else if(m.type==='closed')this.close();else this.emit(m.type,m)});});this.redirection.on('data',data=>this.worker?.postMessage({type:'data',data}));void this.redirection.start()}
  fail(error){if(this.closed)return;this.emit('failure',error);this.close()}
  close(){if(this.closed)return;this.closed=true;this.redirection.close();void this.worker?.terminate();this.emit('closed')}
}
module.exports={MediaSession};
