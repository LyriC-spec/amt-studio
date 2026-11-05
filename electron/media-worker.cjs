const {parentPort,workerData}=require('node:worker_threads');const fs=require('node:fs');
global.self=global;
const {AMTIDER}=require('@device-management-toolkit/ui-toolkit/core');
const {configureMediaScsi}=require('./media-scsi.cjs');
let closed=false,pending=0,sendId=0,busy=false,bytesRead=0;const queue=[],waiters=[];
const fd=fs.openSync(workerData.file,'r');const stat=fs.fstatSync(fd);
if(stat.size!==workerData.size)throw new Error('Die Image-Datei wurde seit dem Import verändert.');
function stop(message){if(closed)return;closed=true;fs.closeSync(fd);parentPort.postMessage({type:message?'error':'closed',message});parentPort.close()}
function send(text){if(closed)return;if(pending>256)return stop('Die Medienverbindung verarbeitet Daten zu langsam.');pending++;parentPort.postMessage({type:'send',id:++sendId,data:Buffer.from(text,'latin1')})}
const image={size:stat.size};
const ider=new AMTIDER({socketSend:send,stop:()=>stop()},workerData.kind==='iso'?image:null,workerData.kind==='img'?image:null);
ider.iderStart=workerData.mode==='nextboot'?0:2;
configureMediaScsi(ider);
let lastOpcode=null,protocolErrors=0;
const handleScsi=ider.dataProcessor.handleSCSI.bind(ider.dataProcessor);
ider.dataProcessor.handleSCSI=(...args)=>{lastOpcode=args[0];return handleScsi(...args)};
// Firmware can report a recoverable transfer error without closing the stream.
// Preserve its code for diagnosis; do not turn it into a forced disconnect.
ider.dataProcessor.processErrorOccurredCommand=()=>{if(ider.acc.length<11)return 0;protocolErrors++;if(protocolErrors<=5)parentPort.postMessage({type:'diagnostic',code:ider.acc.charCodeAt(8),lastOpcode,bytesRead,protocolErrors});return 11};
ider.sendDiskData=(dev,lba,count,feature)=>{const media=dev===0xa0?ider.floppy:ider.cdrom,block=dev===0xa0?512:2048;if(!media||!Number.isSafeInteger(lba)||!Number.isSafeInteger(count)||lba<0||count<0||lba+count>Math.floor(media.size/block))return ider.sendCommandEndResponse(false,5,dev,0x21,0);if(!count)return ider.sendCommandEndResponse(true,0,dev,0,0);if(queue.length>=128)return stop('Zu viele gleichzeitige Medienanforderungen.');queue.push({dev,offset:lba*block,length:count*block,feature});void drain()};
async function drain(){if(busy||closed)return;busy=true;try{while(queue.length&&!closed){const job=queue.shift();ider.g_media=image;while(job.length&&!closed){const size=Math.min(job.length,ider.iderinfo?.readbfr||8192);if(size<1||size>8192)throw new Error('Ungültige Medienblockgröße.');const data=Buffer.alloc(size);const count=fs.readSync(fd,data,0,size,job.offset);if(count!==size)throw new Error('Die Image-Datei konnte nicht vollständig gelesen werden.');job.offset+=size;job.length-=size;bytesRead+=size;ider.sendDataToHost(job.dev,job.length===0,data.toString('latin1'),job.feature&1);if(pending>16)await new Promise(resolve=>waiters.push(resolve));if(ider.g_reset){ider.sendCommand(0x47);queue.length=0;ider.g_reset=false;break}}ider.g_media=null;parentPort.postMessage({type:'progress',bytesRead})}}catch(error){stop(error.message)}finally{busy=false}}
let active=false;
parentPort.on('message',message=>{if(closed)return;try{if(message.type==='ack'){pending=Math.max(0,pending-1);if(pending<=16)while(waiters.length)waiters.shift()();return}if(message.type==='close')return stop();if(message.type==='data'){if(ider.acc.length+message.data.length>1048576)throw new Error('Ungültige Medienantwort.');ider.processData(Buffer.from(message.data).toString('latin1'));if(ider.enabled&&!active){active=true;parentPort.postMessage({type:'active'})}}}catch(error){stop(error.message)}});
ider.start();
