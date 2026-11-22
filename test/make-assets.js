'use strict';
const {createCanvas,loadImage}=require('@napi-rs/canvas');const fs=require('fs'),path=require('path'),zlib=require('zlib');
(async()=>{
  const canvas=createCanvas(950,180),c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,950,180);c.fillStyle='black';c.font='44px sans-serif';c.fillText('Ordinary public project notes',40,100);fs.writeFileSync(path.join(__dirname,'assets/clean.png'),canvas.toBuffer('image/png'));
  const flagged=createCanvas(950,180),fc=flagged.getContext('2d');fc.fillStyle='white';fc.fillRect(0,0,950,180);fc.fillStyle='black';fc.font='bold 46px sans-serif';fc.fillText('WALLED_SENSITIVE',40,100);
  const rgba=fc.getImageData(0,0,950,180).data,rgb=Buffer.alloc(950*180*3);for(let i=0,j=0;i<rgba.length;i+=4){rgb[j++]=rgba[i];rgb[j++]=rgba[i+1];rgb[j++]=rgba[i+2];}
  const img=zlib.deflateSync(rgb),stream=Buffer.from('q 570 0 0 108 10 650 cm /Im0 Do Q');
  const objects=[Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'),Buffer.concat([Buffer.from('<< /Type /XObject /Subtype /Image /Width 950 /Height 180 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length '+img.length+' >>\nstream\n'),img,Buffer.from('\nendstream')]),Buffer.concat([Buffer.from('<< /Length '+stream.length+' >>\nstream\n'),stream,Buffer.from('\nendstream')])];
  const parts=[Buffer.from('%PDF-1.4\n')],offsets=[0];let length=parts[0].length;objects.forEach((o,i)=>{offsets.push(length);const b=Buffer.concat([Buffer.from((i+1)+' 0 obj\n'),o,Buffer.from('\nendobj\n')]);parts.push(b);length+=b.length;});
  const xref=Buffer.from('xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+length+'\n%%EOF\n');parts.push(xref);fs.writeFileSync(path.join(__dirname,'assets/scanned-flagged.pdf'),Buffer.concat(parts));
})().catch(e=>{console.error(e);process.exitCode=1;});
