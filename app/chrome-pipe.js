'use strict';
const {EventEmitter}=require('node:events');
// Chrome's debugging pipe is inherited by this process only. No TCP listener.
class ChromePipe extends EventEmitter {
  constructor(child){super();this.child=child;this.seq=0;this.pending=new Map();this.buffer='';
    child.stdio[4].setEncoding('utf8');child.stdio[4].on('data',chunk=>{this.buffer+=chunk;let i;
      while((i=this.buffer.indexOf('\0'))!==-1){const text=this.buffer.slice(0,i);this.buffer=this.buffer.slice(i+1);if(text)this.receive(JSON.parse(text));}
    });
    child.stdio[3].on('error',()=>{try{child.kill();}catch{}});
    child.once('close',()=>{for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Chrome closed'));}this.pending.clear();this.emit('closed');});
  }
  receive(message){if(message.id){const p=this.pending.get(message.id);if(!p)return;this.pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(message.error.message)):p.resolve(message.result||{});}
    else this.emit('event',message);}
  send(method,params={},sessionId){return new Promise((resolve,reject)=>{
    const id=++this.seq,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Chrome command timed out: '+method));},30000);
    this.pending.set(id,{resolve,reject,timer});
    const msg={id,method,params};if(sessionId)msg.sessionId=sessionId;
    this.child.stdio[3].write(JSON.stringify(msg)+'\0',error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(error);}});
  });}

}
module.exports={ChromePipe};
