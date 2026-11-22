#!/usr/bin/env node
'use strict';
const {spawn}=require('node:child_process');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {ChromePipe}=require('./chrome-pipe');const {Scanner}=require('./scanner-service');const dialog=require('./dialog');
const {installGuard}=require('./hook');
function findChrome(){
  const paths=process.platform==='darwin'?['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']:
    process.platform==='win32'?[path.join(process.env.PROGRAMFILES||'C:\\Program Files','Google/Chrome/Application/chrome.exe'),path.join(process.env.LOCALAPPDATA||'','Google/Chrome/Application/chrome.exe')]:['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'];
  const executable=process.env.CHROME_PATH||paths.find(p=>fs.existsSync(p));
  if(!executable||!fs.existsSync(executable))throw Error('Chrome was not found. Install Chrome, or set CHROME_PATH to its executable.');return executable;
}
async function start({bench=false,testNoSandbox=false}={}) {
  if(testNoSandbox&&!bench)throw Error('Sandbox bypass is permitted only for the local test bench');
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'walled-guard-'));fs.chmodSync(profile,0o700);
  const args=['--remote-debugging-pipe','--user-data-dir='+profile,'--no-first-run','--no-default-browser-check','--disable-extensions','--new-window','--window-size=1280,900','--window-position=0,0','--disable-background-networking','about:blank'];
  if(testNoSandbox)args.unshift('--no-sandbox');
  const chrome=spawn(findChrome(),args,{detached:process.platform!=='win32',stdio:['ignore','ignore','pipe','pipe','pipe'],env:process.env});
  let chromeError='';chrome.stderr.on('data',b=>{chromeError=(chromeError+b.toString()).slice(-2000);});
  const cdp=new ChromePipe(chrome),scanner=new Scanner();
  const sessions=new Map(),targets=new Map(),stats={checked:0,continued:0,blocked:0,errors:0};
  const binding='__guard_'+crypto.randomBytes(12).toString('hex'),reply=binding+'_reply';
  const home=pathToFileURL(path.join(__dirname,'home.html')).href;
  const allowed=['https://chatgpt.com','https://www.perplexity.ai','https://perplexity.ai'];
  if(bench)allowed.push('http://127.0.0.1:8899','http://127.0.0.1:8900');
  const css=fs.readFileSync(path.join(__dirname,'recolor.css'),'utf8');
  const bootstrap=`(()=>{if(!globalThis[${JSON.stringify(reply)}]){const pending=new Map();let seq=0;const raw=globalThis[${JSON.stringify(binding)}];
    Object.defineProperty(globalThis,${JSON.stringify(reply)},{value:(id,result)=>{const p=pending.get(id);if(p){pending.delete(id);p(result);}}});
    const request=(kind,body)=>new Promise(resolve=>{const id=++seq;pending.set(id,resolve);raw(JSON.stringify({id,kind,...body}));setTimeout(()=>{if(pending.has(id)){pending.delete(id);resolve({proceed:false,detail:'Inspector timeout'});}},180000);});
    globalThis[${JSON.stringify(binding)}]=(items)=>request('inspect',{items});
    if(location.href===${JSON.stringify(home)})Object.defineProperty(globalThis,'guardOpen',{value:site=>request('open',{site})});
    }
    (${installGuard.toString()})(${JSON.stringify({binding,origins:allowed,css})});})();`;
  let closing=false,dialogChain=Promise.resolve(),homeSession;
  async function update(){if(homeSession&&!closing)try{await cdp.send('Runtime.evaluate',{expression:'window.renderStats?.('+JSON.stringify({...stats,bench})+')'},homeSession);}catch{}}
  async function inspect(items){
    if(!Array.isArray(items)||!items.length||items.length>16)return {proceed:false,detail:'Inspection limit exceeded'};
    const deadline=Date.now()+150000;
    let hits=[],total=0;
    try{
      for(const item of items){
        if(item.type==='text'){
          if(typeof item.text!=='string'||item.text.length>1024*1024)throw Error('Prompt inspection limit exceeded');
          if(item.text.includes('WALLED_SENSITIVE'))hits.push({kind:'text',name:item.text});
        }else if(item.type==='file'){
          if(typeof item.dataB64!=='string')throw Error('Invalid file');
          total+=item.dataB64.length;if(total>56*1024*1024)throw Error('Batch inspection limit exceeded');
          const result=await scanner.scan({dataB64:item.dataB64,name:String(item.name||'').slice(0,240),mime:String(item.mime||'').slice(0,160)},deadline);
          if(result.hit)hits.push({kind:'file',name:String(item.name||'(unnamed file)').slice(0,240)});
        }else throw Error('Unsupported inspection item');
      }
      stats.checked++;
      if(!hits.length){await update();return {proceed:true};}
      const label={...hits[0]};if(hits.length>1)label.name+=' (+'+(hits.length-1)+' flagged items)';
      const task=dialogChain.then(()=>closing?false:dialog.confirm(label,deadline-Date.now()));dialogChain=task.catch(()=>false);
      const allow=await task;allow?stats.continued++:stats.blocked++;await update();
      return {proceed:allow,detail:allow?'Continued by user':'Cancelled by user'};
    }catch{stats.errors++;stats.blocked++;await update();return {proceed:false,detail:'Could not inspect this content. Nothing was sent. Check format and limits.'};}
  }
  async function onBinding(event){
    const meta=sessions.get(event.sessionId);if(!meta)return;
    let message;
    try{
      if(event.params.name!==binding||event.params.payload.length>57*1024*1024)return;
      message=JSON.parse(event.params.payload);
      if(!Number.isSafeInteger(message.id))return;
      const context=meta.contexts.get(event.params.executionContextId);
      if(!context?.auxData?.isDefault)throw Error('Unexpected execution world');
      const {frameTree}=await cdp.send('Page.getFrameTree',{},event.sessionId);
      if(context.auxData.frameId!==frameTree.frame.id)throw Error('Only the main frame is supported');
      const url=frameTree.frame.url;let result;
      if(message.kind==='open'&&url===home){
        const dest={chatgpt:'https://chatgpt.com/',perplexity:'https://www.perplexity.ai/',bench:bench?'http://127.0.0.1:8899/mock.html':null}[message.site];
        if(!dest)throw Error('Unknown destination');
        await open(dest);result={ok:true};
      }else if(message.kind==='inspect'&&allowed.includes(new URL(url).origin))result=await inspect(message.items);
      else throw Error('This page is outside the guarded scope');
      await cdp.send('Runtime.callFunctionOn',{executionContextId:event.params.executionContextId,functionDeclaration:`function(id,result){globalThis[${JSON.stringify(reply)}]?.(id,result);}`,arguments:[{value:message.id},{value:result}]},event.sessionId);
    }catch{
      if(message?.id)try{await cdp.send('Runtime.callFunctionOn',{executionContextId:event.params.executionContextId,functionDeclaration:`function(id){globalThis[${JSON.stringify(reply)}]?.(id,{proceed:false,detail:'Inspection unavailable'});}`,arguments:[{value:message.id}]},event.sessionId);}catch{}
    }
  }
  async function attach(event){
    const {sessionId,targetInfo}=event.params;
    // Diagnostic clients may attach an extra session to an existing target.
    // Exactly one inspector owns each target; duplicate bindings would show
    // two dialogs for one operation.
    if(targets.has(targetInfo.targetId)){
      await cdp.send('Runtime.runIfWaitingForDebugger',{},sessionId).catch(()=>{});return;
    }
    const meta={targetId:targetInfo.targetId,type:targetInfo.type,parentSession:event.sessionId,contexts:new Map()};sessions.set(sessionId,meta);targets.set(targetInfo.targetId,sessionId);
    try{
      // Launcher tabs start blank. Install their binding and document-start
      // hook before open() navigates to a supported destination.
      if(!['page','iframe'].includes(targetInfo.type))await cdp.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter:[{}]},sessionId);
      if(['page','iframe'].includes(targetInfo.type)){
        await cdp.send('Runtime.addBinding',{name:binding},sessionId);
        await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:bootstrap,runImmediately:true},sessionId);
        await cdp.send('Page.enable',{},sessionId);
        await cdp.send('Runtime.enable',{},sessionId);
        await cdp.send('DOM.enable',{},sessionId);await cdp.send('CSS.enable',{},sessionId);
        // Existing blank targets attached at startup have already loaded.
        // Injection takes effect on their next navigation as well.
        meta.ready=true;
      }
      await cdp.send('Runtime.runIfWaitingForDebugger',{},sessionId);
    }catch{
      // Do not run a supported page with a half-installed inspector.
      if(['page','iframe'].includes(targetInfo.type))await cdp.send('Target.closeTarget',{targetId:targetInfo.targetId}).catch(()=>{});
      else await cdp.send('Runtime.runIfWaitingForDebugger',{},sessionId).catch(()=>{});
    }
  }
  cdp.on('event',event=>{
    if(event.method==='Target.attachedToTarget')attach(event);
    else if(event.method==='Runtime.executionContextCreated')sessions.get(event.sessionId)?.contexts.set(event.params.context.id,event.params.context);
    else if(event.method==='Runtime.executionContextDestroyed')sessions.get(event.sessionId)?.contexts.delete(event.params.executionContextId);
    else if(event.method==='Runtime.executionContextsCleared')sessions.get(event.sessionId)?.contexts.clear();
    else if(event.method==='Runtime.bindingCalled')onBinding(event);
    else if(event.method==='Page.frameNavigated'){
      const frame=event.params.frame;
      if(frame.url===home){homeSession=event.sessionId;setTimeout(update,250);}
      let origin;try{origin=new URL(frame.url).origin;}catch{}
      if(!frame.parentId&&allowed.includes(origin)){
        // Inspector stylesheets work with strict style-src policies without
        // editing the site's CSP headers or weakening browser security.
        cdp.send('CSS.createStyleSheet',{frameId:frame.id,force:true},event.sessionId)
          .then(sheet=>cdp.send('CSS.setStyleSheetText',{styleSheetId:sheet.styleSheetId,text:css},event.sessionId)).catch(()=>{stats.errors++;update();});
      }
    }
    else if(event.method==='Target.detachedFromTarget'){const meta=sessions.get(event.params.sessionId);if(meta)targets.delete(meta.targetId);sessions.delete(event.params.sessionId);}
  });
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  async function open(url){
    const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank'});
    let sessionId;
    for(let i=0;i<300;i++){sessionId=targets.get(targetId);if(sessionId&&sessions.get(sessionId)?.ready)break;await sleep(10);}
    if(!sessionId||!sessions.get(sessionId)?.ready)throw Error('Could not initialize guarded tab');
    await cdp.send('Page.navigate',{url},sessionId);await cdp.send('Target.activateTarget',{targetId});return {targetId,sessionId};
  }
  async function close(){
    if(closing)return;closing=true;dialog.close();await scanner.close();
    try{await cdp.send('Browser.close');}catch{}
    if(chrome.exitCode===null)await new Promise(resolve=>{const timer=setTimeout(()=>{chrome.kill('SIGKILL');resolve();},4000);chrome.once('exit',()=>{clearTimeout(timer);resolve();});});
    if(process.platform!=='win32')try{process.kill(-chrome.pid,'SIGKILL');}catch{}
    try{fs.rmSync(profile,{recursive:true,force:true});}catch{console.warn('Temporary profile could not be deleted: '+profile);}
  }
  chrome.once('error',e=>{console.error('Could not start Chrome: '+e.message);close();});
  cdp.once('closed',()=>{if(!closing)close();});
  try{
    await cdp.send('Target.setDiscoverTargets',{discover:true,filter:[{}]});
    await cdp.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter:[{type:'tab',exclude:true},{type:'browser_ui',exclude:true},{}]});
    await open(home);
  }catch(e){await close();throw Error(e.message+' '+chromeError.slice(-400));}
  return {cdp,chrome,profile,stats,open,close,sessions,home};
}
if(require.main===module){
  const bench=process.argv.includes('--bench');
  let running;
  const fatal=async()=>{console.error('The guard controller stopped unexpectedly. Restart the app before sending sensitive content.');if(running)await running.close();process.exit(1);};
  process.once('uncaughtException',fatal);process.once('unhandledRejection',fatal);
  start({bench,testNoSandbox:bench&&process.env.WALLED_TEST_NO_SANDBOX==='1'}).then(app=>{
    running=app;
    console.log('Sensitive Upload Guard is running. Use its desktop window. Press Ctrl+C to exit.');
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
  }).catch(e=>{console.error(e.message);process.exitCode=1;});
}
module.exports={start,findChrome};
