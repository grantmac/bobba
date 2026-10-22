// Stringified into a sandboxed iframe. Keep self-contained; user code runs only in its worker.
export function assetProgramBridge(workerSource){
  let connected=false;
  window.addEventListener('message',event=>{
    if(connected||event.source!==parent||!event.ports[0])return;connected=true;
    const port=event.ports[0],url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
    const worker=new Worker(url);
    let count=0;
    const stop=message=>{worker.terminate();URL.revokeObjectURL(url);port.postMessage({type:'error',message});};
    setInterval(()=>{count=0;},1000);
    worker.onmessage=({data})=>{
      URL.revokeObjectURL(url);
      if(++count>100){stop('Program sent too many messages.');return;}
      try{if(JSON.stringify(data).length>20000){stop('Program output is too large.');return;}port.postMessage(data);}catch{stop('Invalid program output.');}
    };
    worker.onerror=event=>stop(event.message||'Program failed to load.');
    port.onmessage=({data})=>{
      if(data.type==='terminate'){worker.terminate();URL.revokeObjectURL(url);port.close();return;}
      worker.postMessage(data);
    };
    port.postMessage({type:'ready'});
  });
}
