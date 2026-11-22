#!/usr/bin/env node
'use strict';
// Local synthetic fixture only. Never handles real account traffic.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const ROOT=__dirname,PORT=Number(process.env.PORT||8899),LOG=process.env.LOG||path.join(ROOT,'server.log');
const receipts=[];const hash=b=>createHash('sha256').update(b).digest('hex');
function log(text){fs.appendFileSync(LOG,new Date().toISOString()+' '+text+'\n');}
const server=http.createServer((req,res)=>{
  if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PUT,OPTIONS','access-control-allow-headers':'content-type'});res.end();return;}
  if(req.url==='/receipts'){res.writeHead(200,{'content-type':'application/json','access-control-allow-origin':'*'});res.end(JSON.stringify(receipts));return;}
  if(req.method==='POST'||req.method==='PUT'){
    const chunks=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>{
      const body=Buffer.concat(chunks),receipt={method:req.method,url:req.url,bytes:body.length,sha256:hash(body),marker:body.includes('WALLED_SENSITIVE')};
      const ct=req.headers['content-type']||'';
      if(ct.includes('multipart/form-data')){
        const boundary=/boundary=(?:"([^"]+)"|([^;]+))/.exec(ct);if(boundary){
          const token=Buffer.from('--'+(boundary[1]||boundary[2]));let cursor=0;receipt.files=[];
          while(true){const start=body.indexOf(token,cursor);if(start<0)break;const headEnd=body.indexOf('\r\n\r\n',start);if(headEnd<0)break;
            const end=body.indexOf(token,headEnd+4);if(end<0)break;
            const headers=body.subarray(start+token.length+2,headEnd).toString();
            if(/filename=/.test(headers)){const data=body.subarray(headEnd+4,end-2);receipt.files.push({bytes:data.length,sha256:hash(data)});}
            cursor=end;
          }
        }
      }
      receipts.push(receipt);log(req.method+' '+req.url+' bytes='+body.length+' marker='+receipt.marker);
      res.writeHead(200,{'content-type':'application/json','access-control-allow-origin':'*'});res.end(JSON.stringify({received:body.length}));
    });return;
  }
  const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
  const target=path.resolve(ROOT,'.'+(pathname==='/'?'/mock.html':pathname));
  if(!target.startsWith(ROOT+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(target,(error,data)=>{
    if(error){res.writeHead(404);res.end('not found');return;}
    const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.pdf':'application/pdf','.txt':'text/plain'};
    const headers={'content-type':types[path.extname(target)]||'application/octet-stream'};
    if(pathname==='/strict.html')headers['content-security-policy']="default-src 'self'; script-src 'none'; style-src 'none'";
    res.writeHead(200,headers);res.end(data);
  });
});
server.listen(PORT,'127.0.0.1',()=>log('Local fixture server on port '+PORT));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>process.exit(0)));
