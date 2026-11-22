'use strict';
const {spawn,execFileSync}=require('node:child_process');const fs=require('node:fs'),path=require('node:path');
const puppeteer=require('puppeteer-core');const {start}=require('../app/main');const {dialog,click}=require('./native');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const children=[];let app,browser,recorder;
async function main(){
  process.env.DISPLAY=':99';process.env.NO_AT_BRIDGE='1';process.env.GTK_A11Y='none';
  children.push(spawn('Xvfb',[':99','-screen','0','1280x900x24'],{stdio:'ignore'}));
  fs.writeFileSync(path.join(__dirname,'server.log'),'');children.push(spawn(process.execPath,[path.join(__dirname,'server.js')],{env:{...process.env,PORT:'8899'},stdio:'ignore'}));await sleep(500);
  app=await start({bench:true,testNoSandbox:process.env.WALLED_TEST_NO_SANDBOX==='1'});
  const demoTab=await app.open('http://127.0.0.1:8899/demo.html');
  browser=await puppeteer.connect({transport:await require('./transport')(app.cdp),defaultViewport:null});
  const pages=await browser.pages(),page=pages.find(p=>p.url().includes('demo.html')),home=pages.find(p=>p.url()===app.home);
  await home.bringToFront();await sleep(400);await home.screenshot({path:'/downloads/walled-standalone-dashboard.png'});
  const log=fs.openSync('/tmp/walled-demo-ffmpeg.log','w');
  recorder=spawn('ffmpeg',['-y','-f','x11grab','-video_size','1280x800','-framerate','20','-draw_mouse','1','-i',':99+0,90','-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-movflags','+faststart','/downloads/walled-standalone-demo.mp4'],{stdio:['pipe','ignore',log]});
  await sleep(5000);await page.bringToFront();await sleep(2500);
  const step=async text=>{await page.evaluate(t=>window.demoStep(t),text);await sleep(500);};
  async function prompt(text){await page.click('#composer');await page.type('#composer',text,{delay:24});await sleep(400);await page.click('#composer-send');}
  async function native(which,screenshot){const end=Date.now()+30000;while(!dialog()&&Date.now()<end)await sleep(70);if(!dialog())throw Error('No native dialog');await sleep(3800);
    if(screenshot)execFileSync('ffmpeg',['-y','-f','x11grab','-video_size','1280x800','-i',':99+0,90','-frames:v','1',screenshot],{stdio:'ignore'});
    click(which);await sleep(2200);
  }
  await step('1 / Clean prompt: no marker, no confirmation, one server receipt.');await prompt('Summarize these public release notes.');await sleep(2800);
  await step('2 / Sensitive prompt: hold before transmission. Cancel leaves the receipt count unchanged.');await prompt('Summarize WALLED_SENSITIVE quarterly figures.');await native('cancel','/downloads/walled-standalone-native.png');
  await step('3 / Retry and Continue: the original prompt is released once.');await page.click('#composer-send');await native('continue');
  await step('4 / Text-file contents trigger the same native dialog. Cancel blocks the upload.');await page.click('#txt');await native('cancel');
  await step('5 / PDF text extraction finds the marker before the upload.');await page.click('#pdf');await native('cancel');
  await step('6 / Image OCR runs locally. Continue releases the original image bytes.');await page.click('#png');await native('continue');
  await step('7 / Image-only PDF: render the page, then inspect it with local OCR.');await page.click('#scanned');await native('cancel');
  await step('8 / Both response-selector fixtures are violet. These are synthetic answers, not live-site proof.');await sleep(5000);
  await step('Local fixtures only. Actual ChatGPT prompt evidence is separate; live uploads and Perplexity remain unverified.');await page.screenshot({path:'/downloads/walled-standalone-bench.png'});await sleep(5000);
  const receipt=await(await fetch('http://127.0.0.1:8899/receipts')).json();fs.writeFileSync(path.join(__dirname,'../evidence/demo-receipts.json'),JSON.stringify(receipt,null,2));
  recorder.stdin.write('q\n');await new Promise(resolve=>recorder.once('exit',resolve));recorder=null;fs.closeSync(log);console.log('Demo saved; receipts:',receipt.length);
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(recorder){recorder.kill('SIGINT');await new Promise(resolve=>recorder.once('exit',resolve));}
  if(browser)await browser.disconnect();if(app)await app.close();for(const c of children){if(c.exitCode===null){c.kill();await new Promise(r=>c.once('exit',r));}}
});
