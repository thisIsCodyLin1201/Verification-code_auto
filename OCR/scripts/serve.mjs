import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
export async function serve(port=8765){
 const root=resolve(import.meta.dirname,'..');let value='001234';
 const server=http.createServer(async(req,res)=>{
  try{
   const path=new URL(req.url,'http://localhost').pathname;
   if(path==='/toggle'&&req.method==='POST'){value=value==='001234'?'009876':'001234';res.end('ok');return}
   if(path==='/captcha.svg'){res.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'no-store'});res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="220" height="70"><rect width="220" height="70" fill="white"/><text x="18" y="49" font-size="40" font-family="Arial" font-weight="bold">${value}</text></svg>`);return}
   let file;
   if(path.startsWith('/dist-ui/'))file=resolve(root,'.'+path);
   else if(path.startsWith('/vendor/'))file=resolve(root,'.vendor-cache/fixture',path.slice(8));
   else file=resolve(root,'tests/fixture',path==='/'?'index.html':'.'+path);
   if(!file.startsWith(root+'/'))throw new Error('bad path');
   const data=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);
  }catch{res.writeHead(404);res.end('Not found')}
 });
 await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',yes)});return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){await serve();console.log('Fixture: http://127.0.0.1:8765 (Ctrl-C to stop)')}
