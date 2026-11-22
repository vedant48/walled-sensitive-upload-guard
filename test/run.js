'use strict';
const {spawn,execFileSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const puppeteer=require('puppeteer-core');
const {start}=require('../app/main');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const children=[];let app,browser;
async function main(){
  const xvfb=spawn('Xvfb',[':99','-screen','0','1280x900x24'],{stdio:'ignore'});children.push(xvfb);process.env.DISPLAY=':99';process.env.NO_AT_BRIDGE='1';process.env.GTK_A11Y='none';
  for(const [port,log] of [[8899,'server.log'],[8900,'server2.log']]){
    fs.writeFileSync(path.join(__dirname,log),'');const p=spawn(process.execPath,[path.join(__dirname,'server.js')],{env:{...process.env,PORT:String(port),LOG:path.join(__dirname,log)},stdio:'ignore'});children.push(p);
  }
  await sleep(500);
  app=await start({bench:true,testNoSandbox:process.env.WALLED_TEST_NO_SANDBOX==='1'});
  const checks=await require('./bootstrap')(app);
  if(process.env.WALLED_BOOT_ONLY)return;
  const tab=await app.open('http://127.0.0.1:8899/mock.html');
  await sleep(350);
  console.log('READY',await app.cdp.send('Runtime.evaluate',{expression:'!!window.__walledGuardReady',returnByValue:true},tab.sessionId));
  browser=await puppeteer.connect({transport:await require('./transport')(app.cdp),defaultViewport:null});
  const pages=await browser.pages();console.log('PAGES',pages.map(p=>p.url()));
  const page=pages.find(p=>p.url().includes('mock.html'));if(!page)throw Error('No bench page');
  page.on('console',m=>console.log('[page]',m.text().slice(0,300)));
  page.on('pageerror',e=>console.log('[pageerror]',e.message));
  checks.push(...await require('./e2e')({page,browser,app}));
  checks.push(...await require('./extended')({page,browser,app}));
  const version=await app.cdp.send('Browser.getVersion');
  const profile=app.profile;
  await browser.disconnect();browser=null;
  await app.close();app=null;
  const profileRemoved=!fs.existsSync(profile);if(!profileRemoved)throw Error('Temporary profile was not removed');
  fs.writeFileSync(path.join(__dirname,'../evidence/verification.json'),JSON.stringify({verifiedAt:new Date().toISOString(),node:process.version,chrome:version.product,platform:process.platform,testOnlySandboxBypass:process.env.WALLED_TEST_NO_SANDBOX==='1',liveSitesTested:false,passed:checks.filter(x=>x.ok).length,total:checks.length,temporaryProfileRemoved:profileRemoved,checks},null,2));
  console.log('Final local verification:',checks.length,'checks; temporary profile removed.');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.disconnect();if(app)await app.close();for(const c of children){if(c.exitCode===null){c.kill();await new Promise(r=>c.once('exit',r));}}});
