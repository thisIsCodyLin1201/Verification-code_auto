import { validCode, characterModeOf } from '../extension/src/core.ts';
import http from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import os from 'node:os';
import { launchChrome } from './chrome.mjs';
const root=resolve(import.meta.dirname,'..');
const args=process.argv.slice(2), manifest=args[0];
if(!manifest){console.error('Usage: npm run evaluate -- /path/to/dataset.json [warm-runs>=20]');process.exit(1)}
const requestedRuns=Number(args[1]);
const runs=Number.isFinite(requestedRuns)?Math.min(1000,Math.max(20,Math.floor(requestedRuns))):20;
const corpus=JSON.parse(await readFile(resolve(manifest),'utf8'));
if(!Array.isArray(corpus.samples)||!corpus.samples.length||corpus.samples.some(s=>typeof s.file!=='string'||typeof s.label!=='string'||!validCode(s.label, undefined, characterModeOf(s.characterMode))))throw new Error('dataset requires samples [{file,label}] with ASCII English/digit string labels and optional characterMode');
const files=corpus.samples.map(s=>resolve(dirname(resolve(manifest)),s.file));
for(const file of files){if((await stat(file)).size>1_048_576)throw new Error(`Input exceeds 1 MB: ${file}`)}
const page=await readFile(`${root}/tests/evaluator.html`);
let server,chrome;
try{
 server=http.createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/'){res.setHeader('Content-Type','text/html');res.end(page);return}
  if(path==='/dataset.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({samples:corpus.samples.map((s,i)=>({file:'/sample/'+i,label:s.label,characterMode:characterModeOf(s.characterMode)})),runs}));return}
  let file;
  if(/^\/sample\/\d+$/.test(path))file=files[Number(path.split('/').pop())];
  else if(path.startsWith('/dist/')){file=resolve(root,'.'+path);if(!file.startsWith(root+'/dist/'))throw Error('bad path')}
  else if(path==='/evaluate-browser.js')file=`${root}/tests/evaluate-browser.js`;
  if(!file)throw Error('not found');
  res.setHeader('Content-Type',({'.js':'text/javascript','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));
 }catch{res.writeHead(404);res.end('Not found')}});
 await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes)});
 chrome=await launchChrome();const {targetId}=await chrome.send('Target.createTarget',{url:`http://127.0.0.1:${server.address().port}/`});
 const {sessionId}=await chrome.send('Target.attachToTarget',{targetId,flatten:true});
 await new Promise(r=>setTimeout(r,1000));
 const result=await chrome.send('Runtime.evaluate',{expression:'window.evaluation',awaitPromise:true,returnByValue:true},sessionId);
 if(result.exceptionDetails||!result.result?.value)throw new Error('Evaluation failed: '+JSON.stringify(result.exceptionDetails));
 const report={...result.result.value,environment:{os:os.platform(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0]?.model,node:process.version,browser:await chrome.send('Browser.getVersion')},dataset:{source:corpus.source||'unspecified',split:corpus.split||'unspecified',representative:corpus.representative===true},note:'Confidence is not accuracy. Browser-page benchmark; extension capture/offscreen integration and CPU/memory require separate validation.'};
 await writeFile(`${root}/reports/evaluation.local.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(e){console.error('Evaluation NOT VERIFIED: '+e.message);process.exitCode=1}
finally{await chrome?.close();server?.close()}
