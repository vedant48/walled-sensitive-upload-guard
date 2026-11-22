'use strict';
const {execFileSync}=require('node:child_process');
function call(args){try{return execFileSync('xdotool',args,{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{return '';}}
function dialog(){const ids=call(['search','--onlyvisible','--name','^Sensitive Upload Guard$']).split('\n').filter(x=>/^\d+$/.test(x));return ids.at(-1)||'';}
function click(which){const id=dialog();if(!id)throw Error('Native dialog is not visible');call(['windowfocus',id]);if(which==='cancel'){call(['key','Escape']);return;}
  const geo=call(['getwindowgeometry','--shell',id]);const val=k=>Number(new RegExp('^'+k+'=(-?\\d+)','m').exec(geo)?.[1]);
  const x=val('X')+val('WIDTH')-58,y=val('Y')+val('HEIGHT')-25;
  if(!Number.isFinite(x)||!Number.isFinite(y))throw Error('Cannot locate native dialog');
  call(['mousemove',String(x),String(y)]);call(['click','1']);
}
module.exports={dialog,click,call};
