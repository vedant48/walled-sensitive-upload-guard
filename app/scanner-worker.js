'use strict';
const {parentPort}=require('node:worker_threads');
const {scanFile}=require('./scanner');
parentPort.on('message',async file=>{try{parentPort.postMessage({ok:true,result:await scanFile(file)});}catch{parentPort.postMessage({ok:false});}});
