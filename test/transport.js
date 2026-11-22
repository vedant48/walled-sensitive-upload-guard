'use strict';
module.exports=async function testTransport(self){const {sessionId:root}=await self.send('Target.attachToBrowserTarget');const known=new Set([root]);
    const transport={onmessage:null,onclose:null,
    send(data){const m=JSON.parse(data);self.send(m.method,m.params,m.sessionId||root).then(result=>transport.onmessage?.(JSON.stringify({id:m.id,result,sessionId:m.sessionId}))).catch(error=>transport.onmessage?.(JSON.stringify({id:m.id,error:{code:-32000,message:error.message},sessionId:m.sessionId})));},
    close(){self.off('event',event);self.off('closed',closed);self.send('Target.detachFromTarget',{sessionId:root}).catch(()=>{});}};
    const event=m=>{if(!known.has(m.sessionId))return;if(m.method==='Target.attachedToTarget')known.add(m.params.sessionId);const outgoing={...m};if(outgoing.sessionId===root)delete outgoing.sessionId;transport.onmessage?.(JSON.stringify(outgoing));};
    const closed=()=>transport.onclose?.();self.on('event',event);self.on('closed',closed);return transport;
  };
