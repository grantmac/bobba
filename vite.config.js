import {defineConfig} from 'vite';
import {randomUUID} from 'node:crypto';
export default defineConfig(({command})=>{
  const version=command==='build'?randomUUID():'development';
  return {
    define:{__ROOM_BUILD_ID__:JSON.stringify(version)},
    plugins:[{name:'room-version',generateBundle(){this.emitFile({type:'asset',fileName:'version.json',source:JSON.stringify({version})});}}],
    server:{fs:{deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/ADMIN-ENTRY.md']}}
  };
});
