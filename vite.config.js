import {defineConfig} from 'vite';
import {randomUUID} from 'node:crypto';
const entryGuide=server=>{server.middlewares.use((request,response,next)=>{
  const path=request.url?.split('?')[0];
  if(['/connect','/connect/','/connect.md'].includes(path)){
    request.url='/connect.md';
    response.setHeader('Content-Type','text/plain; charset=utf-8');
    response.setHeader('Cache-Control','no-store');
  }
  next();
});};
export default defineConfig(({command})=>{
  const version=command==='build'?randomUUID():'development';
  return {
    define:{__ROOM_BUILD_ID__:JSON.stringify(version)},
    plugins:[{name:'room-entry',configureServer:entryGuide,configurePreviewServer:entryGuide},{name:'room-version',generateBundle(){this.emitFile({type:'asset',fileName:'version.json',source:JSON.stringify({version})});}}],
    server:{fs:{deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/ADMIN-ENTRY.md']}}
  };
});
