// Stringified into a sandboxed iframe. Keep self-contained; user code runs only in its worker.
export function assetProgramBridge(workerSource){
  let connected=false;
  window.addEventListener('message',event=>{
    if(connected||event.source!==parent||!event.ports[0])return;connected=true;
    const port=event.ports[0],url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
    const worker=new Worker(url);
    let count=0,windowStart=performance.now(),stopped=false;
    const stop=(message,recoverable=false)=>{if(stopped)return;stopped=true;worker.terminate();URL.revokeObjectURL(url);port.postMessage({type:'error',message,recoverable});};
    worker.onmessage=({data})=>{
      if(stopped)return;
      URL.revokeObjectURL(url);
      // Hidden iframe timers can run only once a minute after five minutes away.
      // Measure the message window directly; a throttled reset timer falsely
      // counts a minute of normal worker heartbeats as a one-second flood.
      const now=performance.now();if(now-windowStart>=1000){count=0;windowStart=now;}
      if(++count>100){stop('Program sent too many messages.',true);return;}
      try{if(JSON.stringify(data).length>20000){stop('Program output is too large.');return;}port.postMessage(data);}catch{stop('Invalid program output.');}
    };
    worker.onerror=event=>stop(event.message||'Program failed to load.',true);
    port.onmessage=({data})=>{
      if(data.type==='terminate'){stopped=true;worker.terminate();URL.revokeObjectURL(url);port.close();return;}
      if(stopped)return;
      worker.postMessage(data);
    };
    port.postMessage({type:'ready'});
  });
}
