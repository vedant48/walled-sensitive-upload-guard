/* Runs at document start in the managed browser tabs. No extension API. */
function installGuard({binding,origins,css}) {
  if(!origins.includes(location.origin)||window!==window.top||window.__walledGuardReady) return;
  const sendToDesktop=window[binding];
  if(typeof sendToDesktop!=='function') return;
  const MARKER='WALLED_SENSITIVE',MAX=20*1024*1024,TTL=15000;
  const fetchOriginal=window.fetch.bind(window);
  const replayEvents=new WeakSet(),inFlight=new WeakSet();
  const approvals=[];
  const blocked=()=>new DOMException('Blocked by Sensitive Upload Guard. Edit the content or retry.','AbortError');
  const rejected=detail=>({proceed:false,detail});
  let noticeTimer;
  const status=detail=>{
    console.info('[Sensitive Upload Guard]',detail);
    if(!document.body)return;
    let notice=document.getElementById('walled-guard-notice');
    if(!notice){notice=document.createElement('div');notice.id='walled-guard-notice';notice.setAttribute('role','status');document.body.appendChild(notice);}
    notice.textContent='Sensitive Upload Guard · '+detail;notice.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>notice.hidden=true,5000);
  };
  function originOf(value){try{return new URL(value,location.href).origin;}catch{return null;}}
  async function digest(bytes){
    if(!crypto.subtle) throw Error('Secure file hashing is unavailable');
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  function b64(bytes){let s='';const a=new Uint8Array(bytes);for(let i=0;i<a.length;i+=32768)s+=String.fromCharCode(...a.subarray(i,i+32768));return btoa(s);}
  async function fileItem(file,name){
    if(file.size>MAX)throw Error('File exceeds 20 MiB inspection limit');
    const bytes=await file.arrayBuffer();
    return {type:'file',name:name||file.name||'(binary body)',mime:file.type||'',bytes,key:'f:'+await digest(bytes)};
  }
  function textItems(value,label='text prompt'){
    const out=[];
    function walk(x){if(typeof x==='string'){if(x.includes(MARKER))out.push({type:'text',text:x,name:label,key:'t:'+x});}
      else if(Array.isArray(x))x.forEach(walk);else if(x&&typeof x==='object')Object.values(x).forEach(walk);}
    if(typeof value==='string'){try{walk(JSON.parse(value));}catch{walk(value);}}
    else walk(value);
    return out;
  }
  async function collect(body){
    if(body==null)return [];
    if(typeof body==='string')return textItems(body);
    if(body instanceof URLSearchParams)return [...body.values()].flatMap(x=>textItems(x));
    if(body instanceof FormData){const out=[];for(const [k,v] of body.entries()){
      if(typeof v==='string')out.push(...textItems(v,k));else out.push(await fileItem(v,v.name||k));
    }return out;}
    if(body instanceof Blob)return [await fileItem(body)];
    if(body instanceof ArrayBuffer||ArrayBuffer.isView(body)){
      const bytes=body instanceof ArrayBuffer?body:body.buffer.slice(body.byteOffset,body.byteOffset+body.byteLength);
      return [await fileItem(new Blob([bytes],{type:'application/octet-stream'}))];
    }
    throw Error('Unsupported outgoing request body');
  }
  function consume(items,origin){
    const now=Date.now();for(let i=approvals.length-1;i>=0;i--)if(approvals[i].until<=now)approvals.splice(i,1);
    const used=[];
    for(const item of items){const i=approvals.findIndex((a,idx)=>!used.includes(idx)&&a.origin===origin&&a.key===item.key);if(i<0)return false;used.push(i);}
    used.sort((a,b)=>b-a).forEach(i=>approvals.splice(i,1));return true;
  }
  function remember(items){for(const item of items)approvals.push({origin:location.origin,key:item.key,until:Date.now()+TTL});}
  async function inspect(items,origin=location.origin,canConsume=true){
    if(!items.length)return {proceed:true};
    if(canConsume&&consume(items,origin))return {proceed:true};
    try{
      const safe=items.map(x=>x.type==='file'?{type:'file',name:x.name,mime:x.mime,dataB64:b64(x.bytes)}:{type:'text',name:x.name,text:x.text});
      status('Checking content locally…');
      let timer;
      try{const result=await Promise.race([sendToDesktop(safe).then(x=>x&&x.proceed===true?x:rejected(x?.detail||'Cancelled')),new Promise(resolve=>{timer=setTimeout(()=>resolve(rejected('Inspection timed out')),180000);})]);status(result.proceed?'Inspection complete.':result.detail||'Blocked. Nothing sent.');return result;}
      finally{clearTimeout(timer);}
    }catch{return rejected('Inspector unavailable');}
  }
  async function requestItems(input,init){
    if(init?.body!=null)return collect(init.body);
    if(input instanceof Request&&!['GET','HEAD'].includes(input.method)){
      const clone=input.clone(),ct=clone.headers.get('content-type')||'';
      if(ct.includes('multipart/form-data'))return collect(await clone.formData());
      if(ct.startsWith('text/')||ct.includes('json')||ct.includes('x-www-form-urlencoded')){
        const text=await clone.text();return ct.includes('x-www-form-urlencoded')?collect(new URLSearchParams(text)):collect(text);
      }
      return collect(await clone.blob());
    }return [];
  }
  window.fetch=async function(input,init){
    const url=input instanceof Request?input.url:input;
    const origin=originOf(url);
    if(origin){let result;try{result=await inspect(await requestItems(input,init),origin);}catch{throw blocked();}
      if(!result.proceed){status(result.detail);throw blocked();}}
    return fetchOriginal(input,init);
  };
  const xhrOpen=XMLHttpRequest.prototype.open,xhrSend=XMLHttpRequest.prototype.send,xhrAbort=XMLHttpRequest.prototype.abort;
  const xhrState=new WeakMap();
  XMLHttpRequest.prototype.open=function(method,url,...args){xhrState.set(this,{method:String(method).toUpperCase(),origin:originOf(url),aborted:false});return xhrOpen.call(this,method,url,...args);};
  XMLHttpRequest.prototype.abort=function(){const s=xhrState.get(this);if(s)s.aborted=true;return xhrAbort.call(this);};
  XMLHttpRequest.prototype.send=function(body){
    const xhr=this,s=xhrState.get(xhr);
    if(!s||['GET','HEAD'].includes(s.method)||body==null)return xhrSend.call(xhr,body);
    (async()=>{try{const v=await inspect(await collect(body),s.origin);if(v.proceed&&!s.aborted)return xhrSend.call(xhr,body);}catch{}
      xhrAbort.call(xhr);xhr.dispatchEvent(new ProgressEvent('error'));xhr.dispatchEvent(new ProgressEvent('loadend'));})();
  };
  const wsSend=WebSocket.prototype.send;
  WebSocket.prototype.send=function(body){
    if(typeof body==='string'&&!body.includes(MARKER))return wsSend.call(this,body);
    const ws=this;
    (async()=>{try{const v=await inspect(await collect(body),originOf(ws.url.replace(/^ws/,'http')));if(v.proceed&&ws.readyState===1)wsSend.call(ws,body);}catch{status('WebSocket content blocked');}})();
  };
  function composer(el){return el instanceof HTMLElement&&(el.tagName==='TEXTAREA'||el.isContentEditable);}
  function textOf(el){return el?.tagName==='TEXTAREA'?el.value:el?.innerText||'';}
  function findComposer(){return document.querySelector('#prompt-textarea,#mobile-composer-prompt,textarea,[contenteditable="true"]');}
  function sendButton(){
    const named=document.querySelector('button[aria-label*="send" i],button[data-testid*="send" i],button[aria-label*="submit" i],button[type="submit"]');
    if(named)return named;
    // Perplexity has used an unlabeled final arrow button near its composer.
    // Keep the fallback within that small control cluster, not the whole page.
    let scope=findComposer();
    for(let i=0;scope?.parentElement&&i<5;i++){
      scope=scope.parentElement;
      const buttons=[...scope.querySelectorAll('button')].filter(b=>!b.disabled&&b.offsetParent!==null);
      if(buttons.length&&buttons.length<=8)return buttons.at(-1);
    }
    return null;
  }
  function stop(e){e.preventDefault();e.stopImmediatePropagation();}
  function replay(target,event){replayEvents.add(event);target.dispatchEvent(event);}
  async function gatePrompt(e,el,button){
    const text=textOf(el);if(!text.includes(MARKER))return;
    stop(e);if(inFlight.has(el))return;inFlight.add(el);
    try{
      const items=[{type:'text',name:text,text,key:'t:'+text}];
      const v=await inspect(items,location.origin,false);
      if(!v.proceed){status(v.detail);return;}
      // Never grant a time-window that releases another prompt or action.
      if(textOf(el)!==text){status('Prompt changed while awaiting confirmation. Send again.');return;}
      remember(items);
      const btn=button||sendButton();
      if(btn)replay(btn,new MouseEvent('click',{bubbles:true,cancelable:true,composed:true}));
      else replay(el,new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true,composed:true}));
    }catch{status('Prompt inspection failed. Nothing sent.');}finally{inFlight.delete(el);}
  }
  window.addEventListener('keydown',e=>{
    if(replayEvents.has(e)||e.key!=='Enter'||e.shiftKey||e.isComposing||!composer(e.target))return;
    gatePrompt(e,e.target,null);
  },true);
  window.addEventListener('click',e=>{
    if(replayEvents.has(e))return;
    const btn=e.target?.closest?.('button');if(!btn||btn!==sendButton())return;
    const el=findComposer();if(el)gatePrompt(e,el,btn);
  },true);
  async function gateFiles(files,target,replayAction,cancel){
    if(inFlight.has(target))return;
    inFlight.add(target);
    try{
      const items=await Promise.all(files.map(f=>fileItem(f)));
      const v=await inspect(items,location.origin,false);
      if(!v.proceed){status(v.detail);cancel?.();return;}
      remember(items);replayAction();
    }catch{status('File could not be inspected. Upload blocked.');cancel?.();}finally{inFlight.delete(target);}
  }
  const inputStates=new WeakMap();
  function inputGate(e){
    const input=e.target;
    if(replayEvents.has(e)||!(input instanceof HTMLInputElement)||input.type!=='file'||!input.files?.length)return;
    stop(e);
    // Browsers emit input before change. Hold both until scanning completes.
    if(inputStates.has(input))return;
    inputStates.set(input,true);
    const files=[...input.files];
    gateFiles(files,input,()=>{
      try{
        // Recreate the exact approved selection, even if it changed mid-dialog.
        const dt=new DataTransfer();files.forEach(f=>dt.items.add(f));input.files=dt.files;
        replay(input,new Event('input',{bubbles:true,composed:true}));
        replay(input,new Event('change',{bubbles:true}));
      }finally{inputStates.delete(input);}
    },()=>{input.value='';inputStates.delete(input);});
  }
  window.addEventListener('input',inputGate,true);window.addEventListener('change',inputGate,true);
  for(const kind of ['drop','paste'])window.addEventListener(kind,e=>{
    if(replayEvents.has(e))return;
    const transfer=kind==='drop'?e.dataTransfer:e.clipboardData;
    if(!transfer?.files?.length)return;
    stop(e);const files=[...transfer.files],target=e.target;
    gateFiles(files,target,()=>{
      const dt=new DataTransfer();files.forEach(f=>dt.items.add(f));
      const event=kind==='drop'?new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}):new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt});
      replay(target,event);
    });
  },true);
  // Response styles are installed by the desktop controller as an inspector
  // stylesheet. No inline style or change to the site's CSP is required.
  Object.defineProperty(window,'__walledGuardReady',{value:true});
  status('Protection active for covered prompt and upload gestures in this managed tab.');
}
module.exports={installGuard};
