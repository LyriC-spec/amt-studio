// AMT translates RFB keysyms into a USB keyboard. Printable characters therefore
// need the physical key and modifiers of the selected TARGET layout.
// Intel's European extra-key keysym is documented in MeshCentral's AMT client:
// https://github.com/Ylianst/MeshCentral/blob/master/public/scripts/amt-desktop-0.0.2.js
const extra=0x17170056;
const special={Backspace:0xff08,Tab:0xff09,Enter:0xff0d,NumpadEnter:0xff0d,Escape:0xff1b,Delete:0xffff,Home:0xff50,End:0xff57,PageUp:0xff55,PageDown:0xff56,ArrowLeft:0xff51,ArrowUp:0xff52,ArrowRight:0xff53,ArrowDown:0xff54,Insert:0xff63,ShiftLeft:0xffe1,ShiftRight:0xffe2,ControlLeft:0xffe3,ControlRight:0xffe4,AltLeft:0xffe9,AltRight:0xffea,MetaLeft:0xffe7,MetaRight:0xffe8,CapsLock:0xffe5,NumLock:0xff7f,ScrollLock:0xff14,Pause:0xff13,PrintScreen:0xff61,ContextMenu:0xff67};
const positions={Space:32,Backquote:96,Minus:45,Equal:61,BracketLeft:91,BracketRight:93,Backslash:92,Semicolon:59,Quote:39,Comma:44,Period:46,Slash:47,IntlBackslash:extra,NumpadMultiply:42,NumpadAdd:43,NumpadSubtract:45,NumpadDecimal:46,NumpadDivide:47};
for(let i=1;i<=12;i++)special['F'+i]=0xffbd+i;
for(const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')positions['Key'+c]=c.toLowerCase().charCodeAt(0);
for(let i=0;i<10;i++){positions['Digit'+i]=48+i;positions['Numpad'+i]=48+i}
const layouts={de:new Map(),us:new Map()};
function key(layout,code,plain,shifted,altGr){for(const [char,shift,alt] of [[plain,false,false],[shifted,true,false],[altGr,false,true]])if(char)layouts[layout].set(char,{symbol:positions[code],shift,altGr:alt})}
for(const layout of ['de','us']){
 for(const c of 'abcdefghijklmnopqrstuvwxyz'){const position=layout==='de'?(c==='y'?'z':c==='z'?'y':c):c;key(layout,'Key'+position.toUpperCase(),c,c.toUpperCase())}
 key(layout,'Space',' ');
}
for(const [code,plain,shift,alt] of [
 ['Digit1','1','!'],['Digit2','2','"','²'],['Digit3','3','§','³'],['Digit4','4','$'],['Digit5','5','%'],['Digit6','6','&'],['Digit7','7','/','{'],['Digit8','8','(','['],['Digit9','9',')',']'],['Digit0','0','=','}'],
 ['Minus','ß','?','\\'],['Equal','´','`'],['BracketLeft','ü','Ü'],['BracketRight','+','*','~'],['Semicolon','ö','Ö'],['Quote','ä','Ä'],['Backslash','#',"'"],['Backquote','^','°'],['Comma',',',';'],['Period','.',':'],['Slash','-','_'],['IntlBackslash','<','>','|']
])key('de',code,plain,shift,alt);
layouts.de.set('@',{symbol:113,shift:false,altGr:true});layouts.de.set('€',{symbol:101,shift:false,altGr:true});layouts.de.set('µ',{symbol:109,shift:false,altGr:true});
for(const [code,plain,shift] of [['Digit1','1','!'],['Digit2','2','@'],['Digit3','3','#'],['Digit4','4','$'],['Digit5','5','%'],['Digit6','6','^'],['Digit7','7','&'],['Digit8','8','*'],['Digit9','9','('],['Digit0','0',')'],['Minus','-','_'],['Equal','=','+'],['BracketLeft','[','{'],['BracketRight',']','}'],['Semicolon',';',':'],['Quote',"'",'"'],['Backslash','\\','|'],['Backquote','`','~'],['Comma',',','<'],['Period','.','>'],['Slash','/','?']])key('us',code,plain,shift);
export function keyPacket(symbol,down){const bytes=new Uint8Array(8);bytes[0]=4;bytes[1]=down?1:0;new DataView(bytes.buffer).setUint32(4,symbol);return bytes}
export class KvmKeyboard {
 constructor(send){this.send=send;this.pressed=new Map()}
 emit(symbol,down){this.send(keyPacket(symbol,down))}
 release(){for(const entry of this.pressed.values())if(entry.symbol!=null)this.emit(entry.symbol,false);this.pressed.clear()}
 handle(event,down,layout='de'){
  const id=event.code||event.key,previous=this.pressed.get(id);
  if(!down){if(previous?.symbol!=null)this.emit(previous.symbol,false);this.pressed.delete(id);return Boolean(previous)}
  if(previous?.symbol!=null){this.emit(previous.symbol,true);return true}
  const modifier=special[event.code];
  if(modifier!=null){this.emit(modifier,true);this.pressed.set(id,{symbol:modifier});return true}
  const altGr=Boolean(event.getModifierState?.('AltGraph')||this.pressed.has('AltRight'));
  const shortcut=event.metaKey||event.ctrlKey&&!altGr||event.altKey&&!altGr;
  if(layout!=='physical'&&!shortcut&&event.key?.length===1){
   const mapping=layouts[layout]?.get(event.key);if(!mapping)return false;
   // Temporarily replace local modifiers; AltGr can arrive as Ctrl+Alt on Windows.
   const held=[...this.pressed.values()].filter(entry=>entry.symbol>=0xffe1&&entry.symbol<=0xffee&&entry.symbol!==0xffe5);
   for(const entry of held)this.emit(entry.symbol,false);
   const caps=/^[a-zA-ZäöüÄÖÜ]$/.test(event.key)&&Boolean(event.getModifierState?.('CapsLock'));
   const shift=mapping.shift!==caps;
   if(shift)this.emit(0xffe1,true);if(mapping.altGr)this.emit(0xffea,true);
   this.emit(mapping.symbol,true);this.emit(mapping.symbol,false);
   if(mapping.altGr)this.emit(0xffea,false);if(shift)this.emit(0xffe1,false);
   for(const entry of held)this.emit(entry.symbol,true);
   this.pressed.set(id,{});return true;
  }
  // Shortcuts retain held modifiers, but use the target letter position.
  const mapped=layout!=='physical'&&shortcut?layouts[layout]?.get(event.key?.toLowerCase()):null;
  const symbol=mapped?.symbol??positions[event.code];
  if(symbol==null)return false;
  this.emit(symbol,true);this.pressed.set(id,{symbol});return true;
 }
}
