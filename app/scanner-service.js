'use strict';
const path=require('node:path');
const {Worker}=require('node:worker_threads');
class Scanner {
  constructor(){this.worker=null;this.chain=Promise.resolve();this.stopped=false;}
  scan(file,deadline=Date.now()+120000){const task=this.chain.then(()=>this.perform(file,deadline));this.chain=task.catch(()=>{});return task;}
  async perform(file,deadline){
    if(this.stopped)throw Error('Scanner stopped');
    const timeout=Math.min(120000,deadline-Date.now());if(timeout<=0)throw Error('Inspection expired');
    if(!this.worker)this.worker=new Worker(path.join(__dirname,'scanner-worker.js'),{resourceLimits:{maxOldGenerationSizeMb:512}});
    const worker=this.worker;
    return new Promise((resolve,reject)=>{
      const finish=(err,result)=>{clearTimeout(timer);worker.off('message',message);worker.off('error',error);worker.off('exit',exit);err?reject(err):resolve(result);};
      const message=m=>m.ok?finish(null,m.result):finish(Error('File inspection failed'));
      const error=e=>{this.worker=null;finish(e);};const exit=()=>{this.worker=null;finish(Error('Scanner exited'));};
      const timer=setTimeout(()=>{this.worker=null;finish(Error('File inspection timed out'));worker.terminate();},timeout);
      worker.once('message',message);worker.once('error',error);worker.once('exit',exit);worker.postMessage(file);
    });
  }
  async close(){this.stopped=true;if(this.worker){await this.worker.terminate();this.worker=null;}}
}
module.exports={Scanner};
