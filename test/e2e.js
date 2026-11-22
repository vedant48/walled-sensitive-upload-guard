'use strict';
const path=require('node:path'),fs=require('node:fs');
const {dialog:dialogWid,click:clickDialog}=require('./native');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const dialogUp=()=>!!dialogWid();
const SERVER_LOG=path.join(__dirname,'server.log'),SERVER2_LOG=path.join(__dirname,'server2.log');
function readPosts(p){return fs.readFileSync(p,'utf8').trim().split('\n').filter(x=>/POST|PUT/.test(x));}
const serverPosts=()=>readPosts(SERVER_LOG),server2Posts=()=>readPosts(SERVER2_LOG);
module.exports=async function({page,browser,app}){
  const results = [];
  const check = (name, ok, extra = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  };

  async function waitForDialog(timeout = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (dialogUp()) return true;
      await sleep(500);
    }
    return false;
  }

  function dismissDialogs(){for(let i=0;i<5&&dialogUp();i++)clickDialog('cancel');}

  async function waitPosts(n, timeout = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (serverPosts().length >= n) return true;
      await sleep(400);
    }
    return false;
  }

  // 1. clean prompt passes
  let before = serverPosts().length;
  await page.click('#prompt-clean');
  check('clean prompt reaches server', await waitPosts(before + 1));

  // 2. flagged prompt + Cancel -> blocked
  dismissDialogs();
  await page.click('#prompt-flagged');
  check('dialog shown for flagged prompt', await waitForDialog());
  clickDialog('cancel');
  await sleep(1500);
  check('flagged prompt blocked on Cancel', serverPosts().length === before + 1);

  // 3. flagged prompt + Continue -> allowed
  dismissDialogs();
  await page.click('#prompt-flagged');
  await waitForDialog();
  clickDialog('continue');
  check('flagged prompt sent on Continue', await waitPosts(before + 2), serverPosts().slice(-1)[0]);

  // 4. clean text file passes
  before = serverPosts().length;
  await page.click('#file-clean');
  check('clean text file reaches server', await waitPosts(before + 1));

  // 5. flagged text file + Cancel -> blocked
  dismissDialogs();
  await page.click('#file-txt');
  check('dialog shown for flagged text file', await waitForDialog());
  clickDialog('cancel');
  await sleep(1500);
  check('flagged text file blocked on Cancel', serverPosts().length === before + 1);

  // 6. flagged PDF + Cancel -> blocked (deep scan via PDF.js)
  dismissDialogs();
  await page.click('#file-pdf');
  check('dialog shown for flagged PDF', await waitForDialog());
  clickDialog('cancel');
  await sleep(1500);
  check('flagged PDF blocked on Cancel', serverPosts().length === before + 1);

  // 7. flagged PNG + Continue -> OCR hit, allowed (also warms OCR)
  console.log('... OCR scan (first run may take ~20s)');
  dismissDialogs();
  await page.click('#file-png');
  let waited = 0;
  while (!dialogUp() && waited < 60000) {
    await sleep(1000);
    waited += 1000;
  }
  check('dialog shown for flagged PNG (OCR)', dialogUp(), waited + 'ms');
  clickDialog('continue');
  check('flagged PNG sent on Continue', await waitPosts(before + 2, 20000), serverPosts().slice(-1)[0]);

  // 8. raw PUT with marker bytes + Cancel -> blocked
  before = serverPosts().length;
  dismissDialogs();
  await page.click('#file-raw');
  check('dialog shown for raw PUT body', await waitForDialog());
  clickDialog('cancel');
  await sleep(1500);
  check('raw PUT blocked on Cancel', serverPosts().length === before);

  // ---- Gesture-gate tests (UI layer, transport-independent) ----
  // G1: flagged composer + Enter -> held before network; Cancel -> never sent
  before = serverPosts().length;
  dismissDialogs();
  await page.click('#composer');
  await page.type('#composer', 'gesture flagged WALLED_SENSITIVE one');
  await page.keyboard.press('Enter');
  check('gesture: dialog for flagged composer', await waitForDialog());
  check('gesture: nothing sent before decision', serverPosts().length === before);
  clickDialog('cancel');
  await sleep(1500);
  check('gesture: cancelled composer send never posted', serverPosts().length === before);

  // G2: same + Continue -> retriggered once, reaches server, no second dialog
  await page.click('#composer');
  await page.type('#composer', 'gesture flagged WALLED_SENSITIVE two');
  await page.keyboard.press('Enter');
  check('gesture: dialog for flagged composer (2)', await waitForDialog());
  clickDialog('continue');
  check('gesture: approved composer send posted', await waitPosts(before + 1), serverPosts().slice(-1)[0]);
  await sleep(1200);
  check('gesture: no double dialog after Continue', !dialogUp());

  // G3: file input flagged -> dialog; Cancel clears input, no upload
  before = serverPosts().length;
  dismissDialogs();
  const fi = await page.$('#file-input');
  await fi.uploadFile(path.join(__dirname, 'assets', 'flagged.txt'));
  check('gesture: dialog for flagged file input', await waitForDialog());
  clickDialog('cancel');
  await sleep(1500);
  const cleared = await page.evaluate(() => document.getElementById('file-input').files.length === 0);
  check('gesture: cancelled file input cleared, no upload', cleared && serverPosts().length === before);

  // G4: file input flagged + Continue -> upload posted
  const fi2 = await page.$('#file-input');
  await fi2.uploadFile(path.join(__dirname, 'assets', 'flagged.txt'));
  check('gesture: dialog for flagged file input (2)', await waitForDialog());
  clickDialog('continue');
  check('gesture: approved file upload posted', await waitPosts(before + 1), serverPosts().slice(-1)[0]);

  // G5: approving one file must NOT silently release a different same-name/same-size file
  before = serverPosts().length;
  dismissDialogs();
  await page.evaluate(() => {
    const mk = (ch) => new File(['WALLED_SENSITIVE ' + ch.repeat(32)], 'same.txt', { type: 'text/plain' });
    window.__fileA = mk('A');
    window.__fileB = mk('B');
    const dt = new DataTransfer();
    dt.items.add(window.__fileA);
    const inp = document.getElementById('file-input');
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
  check('collision: dialog for file A', await waitForDialog());
  clickDialog('continue');
  check('collision: file A posted after approval', await waitPosts(before + 1));
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(window.__fileB);
    const inp = document.getElementById('file-input');
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
  check('collision: same-name/size different file gets its OWN dialog', await waitForDialog());
  clickDialog('cancel');
  await sleep(1200);
  check('collision: second file never posted', serverPosts().length === before + 1);

  // G6: a consumed approval must NOT transfer to a different flagged payload
  before = serverPosts().length;
  dismissDialogs();
  await page.click('#composer');
  await page.type('#composer', 'gesture flagged WALLED_SENSITIVE three DIFFERENT');
  await page.keyboard.press('Enter');
  check('laundering: different flagged payload gets its own dialog', await waitForDialog());
  clickDialog('cancel');
  await sleep(1200);
  check('laundering: different payload never posted', serverPosts().length === before);

  // G7: mixed body - an approval for one field must NOT release a second
  // unapproved flagged field bundled into the same request body.
  before = serverPosts().length;
  dismissDialogs();
  await page.click('#composer');
  await page.type('#composer', 'gesture flagged WALLED_SENSITIVE mixed WITH_EXTRA');
  await page.keyboard.press('Enter');
  check('mixed: dialog for composer', await waitForDialog());
  clickDialog('continue');
  check('mixed: approved field + unapproved field gets its OWN dialog', await waitForDialog());
  clickDialog('cancel');
  await sleep(1200);
  check('mixed: bundled body never posted', serverPosts().length === before);

  // G8: destination binding - an approval granted on this origin must NOT
  // release the exact same approved text to a different origin.
  const before8 = serverPosts().length;
  const beforeCross = server2Posts().length;
  dismissDialogs();
  await page.click('#composer');
  await page.type('#composer', 'gesture flagged WALLED_SENSITIVE destination CROSS');
  await page.keyboard.press('Enter');
  check('cross-origin: dialog for composer', await waitForDialog());
  clickDialog('continue');
  check('cross-origin: same-origin send posted via approval', await waitPosts(before8 + 1), serverPosts().slice(-1)[0]);
  check('cross-origin: different origin gets its OWN dialog', await waitForDialog());
  clickDialog('cancel');
  await sleep(1200);
  check('cross-origin: nothing posted to the other origin', server2Posts().length === beforeCross);

  // 9. recolor applied
  const color = await page.evaluate(() => getComputedStyle(document.querySelector('.prose p')).color);
  check('AI response recolored', color === 'rgb(109, 40, 217)', color);


  const failed=results.filter(r=>!r.ok).length;
  fs.writeFileSync(path.join(__dirname,'../evidence/e2e-results.json'),JSON.stringify({date:new Date().toISOString(),results,passed:results.length-failed,total:results.length},null,2));
  console.log(`\n${results.length-failed}/${results.length} passed`);
  if(failed)throw Error(failed+' checks failed');
  return results;
};
