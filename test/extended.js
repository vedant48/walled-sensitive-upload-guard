'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {dialog,click}=require('./native');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async function({page,app}){
  const results=[];const check=(name,ok)=>{results.push({name,ok});console.log((ok?'PASS':'FAIL')+'  '+name);if(!ok)throw Error(name);};
  const receipts=()=>fetch('http://127.0.0.1:8899/receipts').then(r=>r.json());
  const count=async()=>(await receipts()).length;
  async function until(fn,timeout=5000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return true;await sleep(40);}return false;}
  const waitDialog=()=>until(()=>!!dialog(),30000);
  const waitCount=n=>until(async()=>await count()>=n);
  async function begin(code){await page.evaluate(code);}
  async function reset(){await page.evaluate(()=>{document.getElementById('composer').value='';});}
  // The reconstructed approval pipeline preserves original image bytes.
  const prior=await receipts();const pngHash=createHash('sha256').update(fs.readFileSync(path.join(__dirname,'assets/flagged.png'))).digest('hex');
  check('OCR-approved upload preserves the original image bytes',prior.some(r=>r.files?.some(f=>f.sha256===pngHash)));
  let before=await count();
  await page.evaluate(()=>{window.testResult=null;const body=new TextEncoder().encode('WALLED_SENSITIVE clean-range');const start='WALLED_SENSITIVE '.length;fetch(new URL('/slice',location.href),{method:'POST',body:body.subarray(start)}).then(()=>window.testResult='sent').catch(()=>window.testResult='blocked');});
  check('Typed-array scans honor byteOffset and byteLength',await waitCount(before+1)&&!dialog());
  before=await count();
  await page.evaluate(()=>{window.testResult=null;fetch(new URL('/url-object',location.href),{method:'POST',body:'WALLED_SENSITIVE URL object'}).then(()=>window.testResult='sent').catch(()=>window.testResult='blocked');});
  check('URL-object fetch cannot bypass prompt inspection',await waitDialog());click('cancel');
  await until(()=>page.evaluate(()=>window.testResult==='blocked'));
  check('URL-object Cancel reaches no server',await count()===before);
  await page.evaluate(()=>{window.testResult=null;const r=new Request('/request-object',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:'WALLED_SENSITIVE request object'})});fetch(r).then(()=>window.testResult='sent').catch(()=>window.testResult='blocked');});
  check('Request-object bodies are inspected',await waitDialog());click('continue');
  check('Request-object Continue sends exactly once',await waitCount(before+1));await sleep(150);check('Request-object has no second dialog',!dialog());
  // XHR remains held rather than sending from its async continuation early.
  before=await count();
  await page.evaluate(()=>{window.testResult=null;const x=new XMLHttpRequest();x.open('POST','/xhr');x.onload=()=>window.testResult='sent';x.onerror=()=>window.testResult='blocked';x.send('WALLED_SENSITIVE xhr');});
  check('XHR produces a native confirmation before transmission',await waitDialog()&&await count()===before);click('cancel');
  await until(()=>page.evaluate(()=>window.testResult==='blocked'));
  check('XHR Cancel blocks the outgoing body',await count()===before);
  await page.evaluate(()=>{const x=new XMLHttpRequest();x.open('POST','/xhr');x.send('WALLED_SENSITIVE xhr continue');});
  check('XHR retry produces a fresh confirmation',await waitDialog());click('continue');check('XHR Continue sends',await waitCount(before+1));
  // A cancelled prompt must be editable, and a change during confirmation
  // must not inherit the decision for the previous text.
  await reset();before=await count();
  await page.type('#composer','WALLED_SENSITIVE original');await page.keyboard.press('Enter');check('Prompt-change test opens native dialog',await waitDialog());
  await page.evaluate(()=>document.getElementById('composer').value='WALLED_SENSITIVE changed while waiting');click('continue');await sleep(250);
  check('Changing the prompt while dialog is open does not transmit it',await count()===before&&!dialog());
  await page.click('#composer-send');check('Changed prompt needs its own confirmation',await waitDialog());click('cancel');await sleep(150);check('Changed prompt Cancel blocks it',await count()===before);
  // Capture the earlier input event as well as change, including a worker
  // transport that is intentionally invisible to page fetch hooks.
  await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='worker-input';document.body.appendChild(input);input.addEventListener('input',async e=>{const b=await e.target.files[0].arrayBuffer();const worker=new Worker('/send-worker.js');worker.onmessage=()=>worker.terminate();worker.postMessage(b);});});
  const fi=await page.$('#worker-input');before=await count();await fi.uploadFile(path.join(__dirname,'assets/flagged.txt'));
  check('File input event is held before a worker upload starts',await waitDialog()&&await count()===before);click('cancel');await sleep(200);
  check('Worker file upload cannot start after Cancel',await count()===before);
  await fi.uploadFile(path.join(__dirname,'assets/flagged.txt'));check('Worker file retry is inspected',await waitDialog());click('continue');check('Worker file upload proceeds after Continue',await waitCount(before+1));
  const last=(await receipts()).at(-1),txtHash=createHash('sha256').update(fs.readFileSync(path.join(__dirname,'assets/flagged.txt'))).digest('hex');
  check('Worker upload retains exact original text-file bytes',last.sha256===txtHash&&last.url==='/worker-upload');
  for(const kind of ['drop','paste']){
    if(kind==='paste')await page.evaluate(()=>document.getElementById('drop-zone').addEventListener('paste',e=>{for(const f of e.clipboardData.files){const fd=new FormData();fd.append('file',f);fetch('/paste-upload',{method:'POST',body:fd}).catch(()=>{});}}));
    before=await count();
    const gesture=async()=>page.evaluate(kind=>{const dt=new DataTransfer();dt.items.add(new File(['WALLED_SENSITIVE gesture '+kind],'gesture.txt',{type:'text/plain'}));const e=kind==='drop'?new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}):new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt});document.getElementById('drop-zone').dispatchEvent(e);},kind);
    await gesture();check(kind+' upload is held before transmission',await waitDialog()&&await count()===before);click('cancel');await sleep(150);check(kind+' Cancel sends nothing',await count()===before);
    await gesture();check(kind+' retry asks again',await waitDialog());click('continue');check(kind+' Continue sends exactly once',await waitCount(before+1));await sleep(150);check(kind+' does not double-prompt',!dialog());
  }
  before=await count();
  await page.evaluate(()=>{window.testResult=null;const f=new File(['not a real PDF'],'broken.pdf',{type:'application/pdf'});const fd=new FormData();fd.append('file',f);fetch('/bad-pdf',{method:'POST',body:fd}).then(()=>window.testResult='sent').catch(()=>window.testResult='blocked');});
  check('Malformed PDF scan failure blocks instead of failing open',await until(()=>page.evaluate(()=>window.testResult==='blocked'))&&await count()===before);
  await page.evaluate(()=>{window.testResult=null;const f=new File([new Uint8Array(20*1024*1024+1)],'oversized.txt',{type:'text/plain'});const fd=new FormData();fd.append('file',f);fetch('/oversize',{method:'POST',body:fd}).then(()=>window.testResult='sent').catch(()=>window.testResult='blocked');});
  check('Oversized files are blocked, not silently skipped',await until(()=>page.evaluate(()=>window.testResult==='blocked'))&&await count()===before);
  await page.evaluate(async()=>{window.testResult=null;const b=await (await fetch('/assets/scanned-flagged.pdf')).blob();const fd=new FormData();fd.append('file',new File([b],'scanned-flagged.pdf',{type:'application/pdf'}));fetch('/scanned-pdf',{method:'POST',body:fd}).then(()=>window.testResult='sent').catch(()=>window.testResult='blocked');});
  check('Image-only PDF is scanned using page OCR',await waitDialog());click('cancel');await until(()=>page.evaluate(()=>window.testResult==='blocked'));check('Scanned-PDF Cancel blocks the upload',await count()===before);
  await page.evaluate(async()=>{window.testResult=null;const b=await (await fetch('/assets/clean.png')).blob();const fd=new FormData();fd.append('file',new File([b],'clean.png',{type:'image/png'}));fetch('/clean-image',{method:'POST',body:fd}).then(()=>window.testResult='sent').catch(()=>window.testResult='blocked');});
  check('Clean image passes OCR without a native dialog',await waitCount(before+1)&&!dialog());
  fs.writeFileSync(path.join(__dirname,'../evidence/extended-results.json'),JSON.stringify({results},null,2));
  console.log(results.length+'/'+results.length+' extended checks passed');return results;
};
