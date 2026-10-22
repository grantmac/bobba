import {defineConfig} from 'vite';
const entryGuide=server=>{server.middlewares.use((request,response,next)=>{
  const path=request.url?.split('?')[0];
  if(['/connect','/connect/','/connect.md'].includes(path)){
    request.url='/connect.md';
    response.setHeader('Content-Type','text/plain; charset=utf-8');
    response.setHeader('Cache-Control','no-store');
  }
  next();
});};
export default defineConfig({
  plugins:[{name:'room-entry',configureServer:entryGuide,configurePreviewServer:entryGuide}],
  server:{fs:{deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/ADMIN-ENTRY.md']}}
});
