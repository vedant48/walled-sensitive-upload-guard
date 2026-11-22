'use strict';

// Optional live smoke test. Sends only the two public dummy prompts below.
// This is not the local npm test suite and does not test authenticated uploads.
const fs = require('node:fs');
const path = require('node:path');
const {spawn, execFileSync} = require('node:child_process');
const puppeteer = require('puppeteer-core');
const {start} = require('../app/main');
const native = require('./native');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const out = path.resolve(process.env.WALLED_EVIDENCE_DIR || path.join(__dirname, '../evidence/live'));
fs.mkdirSync(out, {recursive: true});
const output = name => path.join(out, name);

(async () => {
  process.env.DISPLAY = ':99';
  process.env.NO_AT_BRIDGE = '1';
  process.env.GTK_A11Y = 'none';
  const display = spawn('Xvfb', [':99', '-screen', '0', '1280x900x24'], {stdio: 'ignore'});
  let app, browser, recording, captureLog;
  const evidence = {at: new Date().toISOString(), sandbox: true, source: 'Actual standalone application, logged-out public dummy-data test', sites: {}};
  const observations = [];
  const requests = new Map();
  const watched = new Set();
  const waitForDialog = async () => {
    const deadline = Date.now() + 10000;
    while (!native.dialog() && Date.now() < deadline) await sleep(80);
    return Boolean(native.dialog());
  };
  try {
    await sleep(400);
    app = await start();
    const watch = async sessionId => {
      if (watched.has(sessionId)) return;
      watched.add(sessionId);
      await app.cdp.send('Network.enable', {}, sessionId).catch(() => {});
    };
    app.cdp.on('event', event => {
      if (event.method === 'Target.attachedToTarget') watch(event.params.sessionId);
      if (event.method !== 'Network.requestWillBeSent') return;
      const {request, requestId, timestamp} = event.params;
      if (!request.postData?.includes('WALLED_SENSITIVE')) return;
      const record = {requestId, timestamp, url: request.url, method: request.method};
      observations.push({...record, sessionId: event.sessionId});
      // A diagnostic client and the controller may observe the same request.
      // Count its protocol request ID and URL once, not once per attached session.
      requests.set(requestId + '\0' + request.url, record);
    });
    for (const sessionId of app.sessions.keys()) await watch(sessionId);
    captureLog = fs.openSync(output('capture.log'), 'w');
    recording = spawn('ffmpeg', ['-y', '-f', 'x11grab', '-video_size', '1280x900', '-framerate', '20', '-draw_mouse', '1', '-i', ':99', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output('chatgpt-raw.mp4')], {stdio: ['pipe', 'ignore', captureLog]});
    await app.open('https://chatgpt.com/');
    await sleep(5000);
    browser = await puppeteer.connect({transport: await require('./transport')(app.cdp), defaultViewport: null});
    const page = (await browser.pages()).find(candidate => candidate.url().includes('chatgpt.com'));
    if (!page) throw Error('ChatGPT tab did not open');
    await page.bringToFront();
    const chat = evidence.sites.chatgpt = {url: page.url(), guard: await page.evaluate(() => Boolean(window.__walledGuardReady))};
    const sessionId = [...app.sessions].find(([, meta]) => meta.type === 'page' && meta.targetId === page.target()._targetId)?.[0];
    if (sessionId) await app.cdp.send('Target.setAutoAttach', {autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{}]}, sessionId);
    const composer = '#mobile-composer-prompt, #prompt-textarea, textarea';
    await page.waitForSelector(composer, {visible: true, timeout: 10000});
    await page.type(composer, 'Reply with exactly READY. This is a public dummy test.', {delay: 15});
    await page.keyboard.press('Enter');
    await sleep(8500);
    chat.cleanText = await page.evaluate(() => document.body.innerText.slice(-5000));
    await page.screenshot({path: output('chatgpt-clean.png')});
    await page.click(composer);
    await page.type(composer, 'For this public dummy test, repeat WALLED_SENSITIVE.', {delay: 15});
    const before = requests.size;
    await page.keyboard.press('Enter');
    chat.cancelDialog = await waitForDialog();
    chat.markerRequestsBeforeDecision = requests.size - before;
    if (chat.cancelDialog) {
      execFileSync('ffmpeg', ['-y', '-f', 'x11grab', '-video_size', '1280x900', '-i', ':99', '-frames:v', '1', output('chatgpt-native.png')], {stdio: 'ignore'});
      await sleep(2500);
      native.click('cancel');
      await sleep(1000);
      chat.markerRequestsAfterCancel = requests.size - before;
      await page.click('button[aria-label="Send message"]');
      chat.continueDialog = await waitForDialog();
      if (chat.continueDialog) {
        await sleep(2000);
        native.click('continue');
        await sleep(10000);
      }
      chat.markerRequestsAfterContinue = requests.size - before;
    }
    chat.after = await page.evaluate(() => ({
      text: document.body.innerText.slice(-7000),
      responses: [...document.querySelectorAll('[data-message-author-role="assistant"] .markdown,.agent-turn .markdown,.prose,[data-assistant-markdown-root]')].slice(-8).map(element => ({
        text: element.innerText.slice(0, 400), color: getComputedStyle(element).color,
        childColor: element.querySelector('p') ? getComputedStyle(element.querySelector('p')).color : null
      }))
    }));
    await page.screenshot({path: output('chatgpt-result.png')});
    const add = await page.$('button[aria-label="Add files and more"]');
    if (add) {
      await add.click();
      await sleep(350);
      chat.uploadMenu = await page.evaluate(() => document.body.innerText.slice(-3500));
      await page.screenshot({path: output('chatgpt-upload-wall.png')});
      await page.keyboard.press('Escape');
    }
    evidence.markerNetworkObservations = observations;
    evidence.distinctMarkerRequests = [...requests.values()];
    evidence.sites.perplexity = {status: 'Actual-app route stopped after two failed Cloudflare checkbox attempts on 2026-11-22. Not retried by this test.'};
    const responses = chat.after.responses;
    evidence.passed = chat.guard && chat.cancelDialog && chat.continueDialog && chat.markerRequestsBeforeDecision === 0 && chat.markerRequestsAfterCancel === 0 && chat.markerRequestsAfterContinue > 0 && responses.some(item => item.text.includes('READY')) && responses.some(item => item.text.includes('WALLED_SENSITIVE')) && responses.every(item => item.color === 'rgb(109, 40, 217)' && item.childColor === 'rgb(109, 40, 217)');
    fs.writeFileSync(output('live-results.json'), JSON.stringify(evidence, null, 2));
    recording.stdin.write('q\n');
    await new Promise(resolve => recording.once('exit', resolve));
    recording = null;
    fs.closeSync(captureLog);
    captureLog = undefined;
    console.log(JSON.stringify({passed: evidence.passed, guard: chat.guard, markerRequestsBeforeDecision: chat.markerRequestsBeforeDecision, markerRequestsAfterCancel: chat.markerRequestsAfterCancel, markerRequestsAfterContinue: chat.markerRequestsAfterContinue, markerNetworkObservations: observations.length, responseColors: responses.map(item => item.color), output: out}));
    if (!evidence.passed) throw Error('Live ChatGPT smoke-test assertions did not all pass; inspect the saved evidence');
  } finally {
    if (recording) { recording.kill('SIGINT'); await new Promise(resolve => recording.once('exit', resolve)); }
    if (captureLog !== undefined) fs.closeSync(captureLog);
    if (browser) await browser.disconnect();
    if (app) await app.close();
    display.kill();
    await new Promise(resolve => display.once('exit', resolve));
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
