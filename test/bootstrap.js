'use strict';
const fs=require('node:fs'),path=require('node:path');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async function(app){
  const results=[],check=(name,ok)=>{results.push({name,ok});console.log((ok?'PASS':'FAIL')+'  '+name);if(!ok)throw Error(name);};
  check('Chrome control uses an inherited pipe, without a debugging TCP port',app.chrome.spawnargs.includes('--remote-debugging-pipe')&&!app.chrome.spawnargs.some(x=>x.startsWith('--remote-debugging-port')));
  const {targetId}=await app.open('http://127.0.0.1:8899/bootstrap.html');
  let sid;
  for(let i=0;i<300;i++){sid=[...app.sessions].find(([,s])=>s.targetId===targetId&&s.ready)?.[0];if(sid){const r=await app.cdp.send('Runtime.evaluate',{expression:'window.wasGuardedAtFirstScript',returnByValue:true},sid);if(r.result?.value===true)break;}await sleep(20);}
  const boot=await app.cdp.send('Runtime.evaluate',{expression:'window.wasGuardedAtFirstScript===true',returnByValue:true},sid);
  check('Launcher-opened tab is guarded before its first application script',boot.result.value===true);
  const {frameTree}=await app.cdp.send('Page.getFrameTree',{},sid);
  check('Document-start probe ran on the intended local fixture',frameTree.frame.url==='http://127.0.0.1:8899/bootstrap.html');
  await app.cdp.send('Target.closeTarget',{targetId});
  const strict=await app.open('http://127.0.0.1:8899/strict.html');
  let color;
  for(let i=0;i<100;i++){const r=await app.cdp.send('Runtime.evaluate',{expression:"document.querySelector('.prose')?getComputedStyle(document.querySelector('.prose')).color:null",returnByValue:true},strict.sessionId);color=r.result.value;if(color==='rgb(109, 40, 217)')break;await sleep(20);}
  check('Response recolor works under style-src none without CSP changes',color==='rgb(109, 40, 217)');
  const mobile=await app.cdp.send('Runtime.evaluate',{expression:"getComputedStyle(document.querySelector('[data-assistant-markdown-root] p')).color",returnByValue:true},strict.sessionId);
  check('Current ChatGPT anonymous response markup is recolored',mobile.result.value==='rgb(109, 40, 217)');
  const ready=await app.cdp.send('Runtime.evaluate',{expression:'window.__walledGuardReady===true',returnByValue:true},strict.sessionId);
  check('Guard installs under script-src none without changing CSP',ready.result.value===true);
  await app.cdp.send('Target.closeTarget',{targetId:strict.targetId});
  fs.writeFileSync(path.join(__dirname,'../evidence/bootstrap-results.json'),JSON.stringify({results},null,2));
  return results;
};
