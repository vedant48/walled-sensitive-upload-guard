self.onmessage=async e=>{await fetch('/worker-upload',{method:'POST',body:e.data});self.postMessage('sent');};
