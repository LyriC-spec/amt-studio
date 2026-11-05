const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const {EventEmitter} = require('node:events');
const {WebSocket} = require('ws');
const {checkPin} = require('./security.cjs');

// Fixed local API routes only. Neither device cookies nor raw device responses
// are exposed through the team API. No redirects or cloud/STUN servers.
class JetClient {
  constructor(device, password) { this.device=device; this.password=password; this.cookie=''; this.pending=null; this.retryAt=0; }
  url(route) { const d=this.device; return new URL(`${d.jetProtocol}://${net.isIP(d.host)===6?'['+d.host+']':d.host}:${d.jetPort}${route}`); }
  tls() {
    const d=this.device;
    return d.jetProtocol==='https' ? {minVersion:'TLSv1.2',rejectUnauthorized:true,
      ...(d.fingerprint?{rejectUnauthorized:false}: {})} : {};
  }
  request(route, body) {
    return new Promise((resolve,reject)=>{
      const payload=body===undefined?null:Buffer.from(JSON.stringify(body));
      const req=(this.device.jetProtocol==='https'?https:http).request(this.url(route),{...this.tls(),method:payload?'POST':'GET',agent:false,headers:{Accept:'application/json',...(this.cookie?{Cookie:this.cookie}:{}),...(payload?{'Content-Type':'application/json','Content-Length':payload.length}:{})}},res=>{
        let size=0;const chunks=[];
        res.on('data',b=>{size+=b.length;if(size>128*1024)res.destroy(new Error('JetKVM-Antwort zu groß.'));else chunks.push(b)});
        res.on('error',reject);res.on('end',()=>{clearTimeout(timer);let data;try{data=JSON.parse(Buffer.concat(chunks).toString())}catch{}resolve({status:res.statusCode,data,cookies:res.headers['set-cookie']||[]})});
      });
      // Pin before writing credentials (waiting on secureConnect, not on response).
      req.on('socket',socket=>{if(this.device.jetProtocol==='https')socket.once('secureConnect',()=>{try{if(this.device.fingerprint)checkPin(socket.getPeerCertificate(),this.device.fingerprint);req.end(payload)}catch(e){req.destroy(e)}});else req.end(payload)});
      const timer=setTimeout(()=>req.destroy(new Error('JetKVM antwortet nicht.')),10000);
      req.on('error',e=>{clearTimeout(timer);reject(e)});
    });
  }
  async authenticate() {
    if(this.pending)return this.pending;
    this.pending=this.authenticateOnce();
    try{return await this.pending}finally{this.pending=null}
  }
  async authenticateOnce() {
    let result=await this.request('/device');
    if(result.status===401){
      if(Date.now()<this.retryAt)throw new Error('JetKVM-Anmeldung fehlgeschlagen. Kennwort prüfen und in einer Minute erneut versuchen.');
      this.retryAt=Date.now()+60000;
      const password=await this.password();
      const login=await this.request('/auth/login-local',{password});
      if(login.status!==200)throw new Error(login.status===429?'JetKVM begrenzt Anmeldeversuche. Bitte später erneut versuchen.':'JetKVM-Kennwort wurde nicht akzeptiert.');
      const cookie=login.cookies.map(c=>c.split(';')[0]).find(c=>/^authToken=[^;\r\n]+$/.test(c));
      if(!cookie)throw new Error('JetKVM hat keine gültige Anmeldung zurückgegeben.');
      this.cookie=cookie;result=await this.request('/device');
    }
    if(result.status!==200 || !['password','noPassword'].includes(result.data?.authMode))throw new Error('Keine unterstützte JetKVM-Geräteschnittstelle gefunden.');
    return {hostName:this.device.name,authMode:result.data.authMode};
  }
}

class JetSession extends EventEmitter {
  constructor(client, valid){super();this.client=client;this.valid=valid;this.closed=false;this.socket=null;this.timer=null;}
  async start(){
    try{
      await this.client.authenticate();if(this.closed)return;this.valid();
      const url=this.client.url('/webrtc/signaling/client');url.protocol=url.protocol==='https:'?'wss:':'ws:';
      // WS must never transmit a cookie before a custom pin was checked. For
      // pinned TLS use a verified TLS stream as its connection factory.
      let options={headers:this.client.cookie?{Cookie:this.client.cookie}:{},handshakeTimeout:10000,maxPayload:256*1024,followRedirects:false,...this.client.tls()};
      if(this.client.device.jetProtocol==='https'&&this.client.device.fingerprint){
        const {connectTls}=require('./security.cjs');const socket=await connectTls(this.client.device,this.client.device.jetPort);
        if(this.closed){socket.destroy();return}this.valid();options.createConnection=()=>socket;
      }
      this.socket=new WebSocket(url,options);
      this.socket.on('message',bytes=>{if(this.closed)return;try{this.valid();if(bytes.toString()==='pong')return;const signal=JSON.parse(bytes.toString());if(['device-metadata','answer','new-ice-candidate','other-session-connected'].includes(signal.type))this.emit('signal',signal)}catch(e){this.fail(e)}});
      this.socket.on('error',()=>this.fail(new Error('JetKVM-Signalisierung fehlgeschlagen. Bitte Firmware und Anmeldung prüfen.')));
      this.socket.on('close',()=>this.close());
      this.timer=setInterval(()=>{try{this.valid();if(this.socket.readyState===WebSocket.OPEN)this.socket.send('ping')}catch(e){this.fail(e)}},10000);
    }catch(e){this.fail(e)}
  }
  send(bytes){
    if(this.closed||this.socket?.readyState!==WebSocket.OPEN)throw new Error('JetKVM-Sitzung ist nicht bereit.');
    if(bytes.length>128*1024)throw new Error('JetKVM-Signal zu groß.');
    const signal=JSON.parse(Buffer.from(bytes).toString());
    if(!['offer','new-ice-candidate'].includes(signal.type))throw new Error('Ungültiges JetKVM-Signal.');
    if(signal.type==='offer'&&(typeof signal.data?.sd!=='string'||signal.data.sd.length>120000))throw new Error('Ungültiges WebRTC-Angebot.');
    this.valid();if(this.socket.bufferedAmount>512*1024)throw new Error('JetKVM-Verbindung zu langsam.');this.socket.send(JSON.stringify({type:signal.type,data:signal.data}));
  }
  fail(error){if(this.closed)return;this.emit('failure',error);this.close()}
  close(){if(this.closed)return;this.closed=true;clearInterval(this.timer);this.socket?.terminate();this.emit('closed')}
}
module.exports={JetClient,JetSession};
