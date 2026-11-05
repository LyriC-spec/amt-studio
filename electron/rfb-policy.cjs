// Validate complete client RFB messages before forwarding. Viewers may negotiate
// and request frames, but cannot smuggle keyboard, mouse or clipboard input.
class RfbPolicy {
  constructor(canControl){this.canControl=canControl;this.stage=0;this.buffer=Buffer.alloc(0)}
  accept(data){this.buffer=Buffer.concat([this.buffer,Buffer.from(data)]);if(this.buffer.length>1048576)throw new Error('KVM-Eingabe überschreitet das Größenlimit.');const frames=[];
    while(this.buffer.length){const b=this.buffer;let size;if(this.stage===0){size=12;if(b.length<size)break;if(!/^RFB 003\.00[38]\n$/.test(b.subarray(0,12).toString('ascii')))throw new Error('Ungültige RFB-Version.');this.stage=b.subarray(0,12).toString('ascii')==='RFB 003.003\n'?2:1}
      else if(this.stage===1){size=1;if(b[0]!==1)throw new Error('Ungültiger RFB-Sicherheitsmodus.');this.stage=2}
      else if(this.stage===2){size=1;if(b[0]>1)throw new Error('Ungültiger RFB-Sitzungsmodus.');this.stage=3}
      else {switch(b[0]){case 0:size=20;break;case 2:if(b.length<4)return frames;size=4+b.readUInt16BE(2)*4;if(size>4096)throw new Error('Zu viele KVM-Kodierungen.');break;case 3:size=10;break;case 4:size=8;break;case 5:size=6;break;case 6:if(b.length<8)return frames;size=8+b.readUInt32BE(4);break;default:throw new Error('Nicht unterstützte KVM-Eingabe.')}if([4,5,6].includes(b[0])&&!this.canControl())throw new Error('Diese Sitzung hat nur Leserechte.');if(size>1048576)throw new Error('KVM-Eingabe ist zu groß.')}
      if(b.length<size)break;frames.push(b.subarray(0,size));this.buffer=b.subarray(size);
    }return frames;
  }
}
module.exports={RfbPolicy};
