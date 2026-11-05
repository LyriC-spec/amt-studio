// JetKVM HID RPC v1: USB HID usage IDs, big-endian absolute pointer coordinates.
// https://github.com/jetkvm/kvm/blob/dev/ui/src/hooks/hidRpc.ts
import {KvmKeyboard} from './kvm-keyboard.mjs';
const usage=new Map();
for(let i=0;i<26;i++)usage.set(97+i,4+i);
for(let i=1;i<=9;i++)usage.set(48+i,29+i);usage.set(48,39);
for(const [symbol,key] of [[32,44],[45,45],[61,46],[91,47],[93,48],[92,49],[59,51],[39,52],[96,53],[44,54],[46,55],[47,56],[0x17170056,100],[0xff08,42],[0xff09,43],[0xff0d,40],[0xff1b,41],[0xffff,76],[0xff50,74],[0xff57,77],[0xff55,75],[0xff56,78],[0xff51,80],[0xff52,82],[0xff53,79],[0xff54,81],[0xff63,73],[0xffe1,225],[0xffe2,229],[0xffe3,224],[0xffe4,228],[0xffe9,226],[0xffea,230],[0xffe7,227],[0xffe8,231],[0xffe5,57],[0xff7f,83],[0xff14,71],[0xff13,72],[0xff61,70],[0xff67,101]])usage.set(symbol,key);
for(let i=1;i<=12;i++)usage.set(0xffbd+i,57+i);
export function jetKeyboard(send){return new KvmKeyboard(packet=>{const key=usage.get(new DataView(packet.buffer,packet.byteOffset,packet.byteLength).getUint32(4));if(key!==undefined)send(new Uint8Array([5,key,packet[1]]))})}
export function jetPointer(x,y,buttons){const data=new Uint8Array(10),view=new DataView(data.buffer);data[0]=3;view.setInt32(1,Math.max(0,Math.min(32767,Math.round(x))));view.setInt32(5,Math.max(0,Math.min(32767,Math.round(y))));data[9]=buttons&7;return data}
