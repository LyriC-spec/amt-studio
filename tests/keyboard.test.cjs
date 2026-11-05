const test=require('node:test'),assert=require('node:assert/strict');
async function fixture(){const {KvmKeyboard}=await import('../src/kvm-keyboard.mjs');const frames=[];return {frames,keyboard:new KvmKeyboard(bytes=>frames.push({down:bytes[1]===1,symbol:new DataView(bytes.buffer).getUint32(4)}))}}
function event(code,key,extra={}){return {code,key,shiftKey:false,ctrlKey:false,altKey:false,metaKey:false,...extra}}
test('German target layout maps letters, umlauts, AltGr and the Intel European extra key',async()=>{
 const {keyboard,frames}=await fixture();
 for(const [key,symbol,modifier] of [['z',121],['y',122],['ä',39],['ö',59],['ü',91],['ß',45],['@',113,0xffea],['€',101,0xffea],['|',0x17170056,0xffea],['>',0x17170056,0xffe1]]){
  frames.length=0;assert.ok(keyboard.handle(event('Unidentified',key),true,'de'));keyboard.handle(event('Unidentified',key),false,'de');
  assert.deepEqual(frames, [...(modifier?[{down:true,symbol:modifier}]:[]),{down:true,symbol},{down:false,symbol},...(modifier?[{down:false,symbol:modifier}]:[])]);
 }
});
test('Key releases use the original symbol even when Shift is released first; blur releases shortcuts',async()=>{
 const {keyboard,frames}=await fixture();keyboard.handle(event('ShiftLeft','Shift',{shiftKey:true}),true,'physical');keyboard.handle(event('KeyA','A',{shiftKey:true}),true,'physical');keyboard.handle(event('ShiftLeft','Shift'),false,'physical');keyboard.handle(event('KeyA','a'),false,'physical');assert.deepEqual(frames.slice(-2),[{down:false,symbol:0xffe1},{down:false,symbol:97}]);
 frames.length=0;keyboard.handle(event('ControlLeft','Control',{ctrlKey:true}),true,'de');keyboard.handle(event('KeyY','z',{ctrlKey:true}),true,'de');keyboard.release();assert.deepEqual(frames.slice(-2),[{down:false,symbol:0xffe3},{down:false,symbol:121}]);
});
test('AltGr is restored after translated text; US and German mappings differ and unknown characters are rejected',async()=>{
 const {keyboard,frames}=await fixture();keyboard.handle(event('AltRight','AltGraph',{altKey:true}),true,'de');keyboard.handle(event('KeyQ','@',{ctrlKey:true,altKey:true}),true,'de');keyboard.handle(event('KeyQ','q'),false,'de');keyboard.handle(event('AltRight','Alt'),false,'de');assert.equal(frames.at(-1).symbol,0xffea);assert.equal(frames.at(-1).down,false);
 frames.length=0;keyboard.handle(event('KeyZ','z'),true,'us');assert.equal(frames[0].symbol,122);keyboard.release();assert.equal(keyboard.handle(event('KeyA','Ж'),true,'de'),false);
});
