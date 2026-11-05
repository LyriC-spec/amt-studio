const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),{execFileSync}=require('node:child_process');
const hostname=process.argv[2]||'localhost';if(!net.isIP(hostname)&&(!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,251}$/.test(hostname)||hostname.includes('..')))throw Error('Pass a hostname or IP address, without a URL or port.');
const dir=path.resolve(__dirname,'../tls'),key=path.join(dir,'server.key'),cert=path.join(dir,'server.crt');if(fs.existsSync(key)||fs.existsSync(cert))throw Error('TLS files already exist. Back them up before replacing them.');fs.mkdirSync(dir,{recursive:true,mode:0o700});
const gitOpenSSL='C:/Program Files/Git/usr/bin/openssl.exe',openssl=process.env.OPENSSL_BIN||(process.platform==='win32'&&fs.existsSync(gitOpenSSL)?gitOpenSSL:'openssl');
const san=['DNS:localhost','IP:127.0.0.1',...(hostname==='localhost'?[]:[`${net.isIP(hostname)?'IP':'DNS'}:${hostname}`])].join(',');
execFileSync(openssl,['req','-x509','-newkey','rsa:3072','-nodes','-keyout',key,'-out',cert,'-days','365','-subj','/CN=AMT Studio','-addext',`subjectAltName=${san}`],{stdio:['ignore','ignore','pipe'],windowsHide:true});fs.chmodSync(key,0o600);fs.chmodSync(cert,0o644);
if(process.getuid?.()===0){fs.chownSync(dir,1000,1000);fs.chownSync(key,1000,1000);fs.chownSync(cert,1000,1000)}
console.log('Created tls/server.crt and tls/server.key. On Linux, grant container UID 1000 access before starting Compose.');
execFileSync(openssl,['x509','-in',cert,'-noout','-fingerprint','-sha256'],{stdio:'inherit',windowsHide:true});
