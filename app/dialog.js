'use strict';
const {execFile}=require('node:child_process');
const children=new Set();
function run(command,args,timeout=180000) {return new Promise(resolve=>{
  const child=execFile(command,args,{timeout,maxBuffer:65536},(error,stdout)=>{
    children.delete(child);resolve({code:error?(Number.isInteger(error.code)?error.code:-1):0,stdout:String(stdout||'')});
  });children.add(child);
});}
function describe({kind,name,text}) {
  const lines=['WALLED_SENSITIVE was detected in '+(kind==='file'?'a file upload.':'a text prompt.'),'',
    (kind==='file'?'File: ':'Prompt: ')+String(name||text||'(unnamed)').replace(/[\x00-\x08\x0e-\x1f]/g,'').slice(0,240),
    '', 'Continue sends the original content to the AI service.', 'Cancel blocks this attempt. You can edit or retry.'];
  return lines.join('\n');
}
async function confirm(payload,timeout=150000) {
  if(timeout<=0)return false;
  const text=describe(payload),title='Sensitive Upload Guard';
  if(process.platform==='darwin') {
    const script='on run argv\ntry\ndisplay dialog (item 1 of argv) with title (item 2 of argv) buttons {"Cancel", "Continue"} default button "Cancel" cancel button "Cancel" with icon caution\nreturn button returned of result\non error\nreturn "Cancel"\nend try\nend run';
    const r=await run('osascript',['-e',script,text,title],timeout);return r.code===0&&r.stdout.trim()==='Continue';
  }
  if(process.platform==='win32') {
    const b64=Buffer.from(text,'utf8').toString('base64');
    const script=`Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing;
$t=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}'));
$f=New-Object Windows.Forms.Form; $f.Text='Sensitive Upload Guard'; $f.Size=New-Object Drawing.Size(580,310); $f.StartPosition='CenterScreen'; $f.TopMost=$true;
$l=New-Object Windows.Forms.Label; $l.Text=$t; $l.Location=New-Object Drawing.Point(20,20); $l.Size=New-Object Drawing.Size(530,180); $f.Controls.Add($l);
$c=New-Object Windows.Forms.Button; $c.Text='Cancel'; $c.Location=New-Object Drawing.Point(325,215); $c.DialogResult=[Windows.Forms.DialogResult]::Cancel; $f.Controls.Add($c);
$y=New-Object Windows.Forms.Button; $y.Text='Continue'; $y.Location=New-Object Drawing.Point(425,215); $y.DialogResult=[Windows.Forms.DialogResult]::OK; $f.Controls.Add($y);
$f.AcceptButton=$c; $f.CancelButton=$c; $r=$f.ShowDialog(); if($r -eq [Windows.Forms.DialogResult]::OK){exit 0}else{exit 1}`;
    const r=await run('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],timeout);return r.code===0;
  }
  const r=await run('zenity',['--question','--no-markup','--title='+title,'--text='+text,'--ok-label=Continue','--cancel-label=Cancel','--default-cancel','--width=560'],timeout);
  // Unavailable dialog, dismissal and timeout all block. No alternate dialog
  // is opened after a user has cancelled.
  return r.code===0;
}
function close(){for(const child of children) child.kill();children.clear();}
module.exports={confirm,close,describe};
