import {createServer} from 'node:http';
import {createReadStream,readFileSync,statSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('./site/',import.meta.url));
const base=resolve(root);
const port=4178, host=`127.0.0.1:${port}`;
const mime={'.js':'text/javascript','.html':'text/html; charset=utf-8','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.webp':'image/webp','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'};
createServer((req,res)=>{
  // Loopback only, reject DNS rebinding and foreign origins.
  if(req.headers.host!==host || (req.headers.origin && req.headers.origin!==`http://${host}`)){
    res.writeHead(403).end();return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
  let path;
  try{path=decodeURIComponent(new URL(req.url,`http://${host}`).pathname);}
  catch{res.writeHead(400).end();return;}
  if(path==='/__health'){
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify({app:'puuvilla-exhibit-v48',root:base,build:JSON.parse(readFileSync(resolve(base,'config.json'))).build}));return;
  }
  const file=resolve(base,'.'+(path.endsWith('/')?path+'index.html':path));
  if(!file.startsWith(base+sep)){res.writeHead(403).end();return;}
  try{
    const st=statSync(file);if(!st.isFile())throw Error();
    res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream',
      'content-length':st.size,'cache-control':/\.(html|json)$/.test(file)?'no-cache':'public, max-age=3600',
      'x-content-type-options':'nosniff'});
    if(req.method==='HEAD')res.end();else createReadStream(file).on('error',()=>res.destroy()).pipe(res);
  }catch{res.writeHead(404).end();}
}).listen(port,'127.0.0.1',()=>console.log(`Puuvilla local app: http://${host}`));
