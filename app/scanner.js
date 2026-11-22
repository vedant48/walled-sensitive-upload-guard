'use strict';
const {createWorker}=require('tesseract.js');
const {langPath}=require('@tesseract.js-data/eng');
const {createCanvas}=require('@napi-rs/canvas');
const {imageSize}=require('image-size');
const MARKER='WALLED_SENSITIVE';
const MAX_BYTES=20*1024*1024;
let ocrPromise;
async function ocr(image) {
  if(!ocrPromise) ocrPromise=createWorker('eng',1,{langPath,gzip:true,cacheMethod:'none',logger:()=>{}}).catch(e=>{ocrPromise=null;throw e;});
  const worker=await ocrPromise;
  return (await worker.recognize(image)).data.text;
}
async function scanFile({dataB64,name='',mime=''}) {
  if(typeof dataB64!=='string'||dataB64.length>Math.ceil(MAX_BYTES/3)*4+4) throw Error('File exceeds the 20 MiB inspection limit');
  const bytes=Buffer.from(dataB64,'base64');
  if(bytes.length>MAX_BYTES) throw Error('File exceeds the 20 MiB inspection limit');
  if(!bytes.length) return {hit:false};
  let text='';
  const isPdf=bytes.subarray(0,5).toString()==='%PDF-';
  const isImage=bytes.subarray(1,4).toString()==='PNG'||(bytes[0]===255&&bytes[1]===216)||bytes.subarray(0,3).toString()==='GIF'||bytes.subarray(0,2).toString()==='BM'||(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP');
  if(isPdf||/\.pdf$/i.test(name)||mime==='application/pdf') {
    const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task=pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:true,verbosity:0});
    const doc=await task.promise;
    try {
      if(doc.numPages>50) throw Error('PDF exceeds the 50-page inspection limit');
      for(let i=1;i<=doc.numPages;i++) {
        const page=await doc.getPage(i);
        const content=await page.getTextContent();
        const extracted=content.items.map(x=>x.str||'').join(' ');
        // Search both the text layer and the rendered page. A text layer can
        // coexist with a sensitive screenshot, so nonempty text is not a skip.
        if(extracted.includes(MARKER)) return {hit:true};
        const viewport=page.getViewport({scale:1.7});
        if(viewport.width*viewport.height>25000000) throw Error('PDF page exceeds raster inspection limit');
        const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
        await page.render({canvasContext:canvas.getContext('2d'),viewport,canvas}).promise;
        if((await ocr(canvas.toBuffer('image/png'))).includes(MARKER)) return {hit:true};
        page.cleanup();
      }
      return {hit:false};
    } finally {await task.destroy();}
  } else if(isImage) {
    // Decode before OCR to bound pixel allocation and reject malformed files.
    const {loadImage}=require('@napi-rs/canvas');
    const dimensions=imageSize(bytes);
    if(!dimensions.width||!dimensions.height||dimensions.width*dimensions.height>25000000)throw Error('Image exceeds raster inspection limit');
    const image=await loadImage(bytes);
    if(image.width*image.height>25000000) throw Error('Image exceeds 25 megapixel inspection limit');
    text=await ocr(bytes);
  } else {
    if(mime&&!/^(text\/|application\/(json|xml|octet-stream|x-www-form-urlencoded))/.test(mime)) throw Error('Unsupported file format');
    if(bytes.includes(0)) throw Error('Unsupported binary file format');
    text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }
  return {hit:text.includes(MARKER)};
}
async function close(){if(ocrPromise){await (await ocrPromise).terminate();ocrPromise=null;}}
module.exports={scanFile,close,MAX_BYTES};
