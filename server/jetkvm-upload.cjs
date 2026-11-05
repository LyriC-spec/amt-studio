const http=require('node:http'),https=require('node:https'),{Transform}=require('node:stream'),{pipeline}=require('node:stream/promises');
const {checkPin}=require('../electron/security.cjs');
function uploadEntry(controller,context,sessionId){const user=controller.user(context);controller.admin(user);const entry=controller.sessions.get(sessionId);if(!entry||entry.protocol!=='jetkvm'||entry.userId!==user.id||entry.owner!==context.owner)throw new Error('JetKVM-Sitzung für den Upload nicht gefunden.');controller.device(user,entry.deviceId,'manage');entry.session.valid();return entry}
async function uploadJetMedia(controller,context,req,params){
 const sessionId=params.get('sessionId'),uploadId=params.get('uploadId'),entry=uploadEntry(controller,context,sessionId);
 if(!/^upload_[a-f0-9-]{36}$/.test(uploadId||''))throw new Error('Ungültige JetKVM-Uploadkennung.');
 const length=Number(req.headers['content-length']);if(!Number.isSafeInteger(length)||length<1||length>64*1024**3)throw new Error('Ungültige Mediengröße (maximal 64 GiB).');
 if(entry.uploading)throw new Error('Für dieses JetKVM läuft bereits ein Upload.');entry.uploading=true;
 const client=entry.session.client;let outgoing,response,received=0;
 const invalid=()=>{if(uploadEntry(controller,context,sessionId)!==entry)throw new Error('JetKVM-Sitzung wurde geändert.')};
 const abort=()=>outgoing?.destroy(new Error('JetKVM-Sitzung wurde getrennt.'));
 try{
  invalid();entry.session.on('closed',abort);
  response=new Promise((resolve,reject)=>{
   outgoing=(client.device.jetProtocol==='https'?https:http).request(client.url('/storage/upload?uploadId='+encodeURIComponent(uploadId)),{...client.tls(),agent:false,method:'POST',headers:{'Content-Type':'application/octet-stream','Content-Length':length,...(client.cookie?{Cookie:client.cookie}:{})}},res=>{
    let bytes=0;res.on('data',b=>{bytes+=b.length;if(bytes>65536)res.destroy(new Error('JetKVM-Antwort zu groß.'))});res.on('error',reject);res.on('end',()=>{if(res.statusCode!==200)reject(new Error(res.statusCode===401?'JetKVM-Anmeldung ist abgelaufen. Bitte die Konsole neu verbinden.':'JetKVM hat den Upload abgelehnt. Speicherplatz und Dateinamen prüfen.'));else resolve()});
   });outgoing.on('error',reject);outgoing.setTimeout(60000,()=>outgoing.destroy(new Error('JetKVM-Upload antwortet nicht.')));
  });
  response.catch(()=>{}); // A socket failure can precede the stream pipeline.
  // Authenticate/pin the outbound socket before piping even the first byte.
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>outgoing.destroy(new Error('JetKVM-Uploadverbindung antwortet nicht.')),15000);const finish=(error)=>{clearTimeout(timer);if(error)reject(error);else resolve()};outgoing.once('error',finish);outgoing.once('socket',socket=>{const ready=()=>{try{if(client.device.jetProtocol==='https'&&client.device.fingerprint)checkPin(socket.getPeerCertificate(),client.device.fingerprint);invalid();finish()}catch(e){outgoing.destroy(e);finish(e)}};if(client.device.jetProtocol==='https')socket.once('secureConnect',ready);else if(socket.connecting)socket.once('connect',ready);else ready()})});
  const limit=new Transform({transform(chunk,_enc,callback){try{invalid();received+=chunk.length;if(received>length)throw new Error('Upload überschreitet die angegebene Größe.');callback(null,chunk)}catch(e){callback(e)}}});
  await Promise.all([pipeline(req,limit,outgoing),response]);if(received!==length)throw new Error('Upload unvollständig.');invalid();controller.audit.write(controller.user(context),'jetMediaUpload',entry.deviceId);return {bytes:received};
 }catch(e){outgoing?.destroy();await response?.catch(()=>{});throw e}
 finally{entry.uploading=false;entry.session.off('closed',abort)}
}
module.exports={uploadJetMedia,uploadEntry};
