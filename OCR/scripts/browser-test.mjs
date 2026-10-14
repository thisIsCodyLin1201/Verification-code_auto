import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { serve } from './serve.mjs';
const executable=process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile=await mkdtemp(`${tmpdir()}/ocr-browser-`);let browser,server,socket;
try{
 server=await serve(0);const port=server.address().port;
 browser=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((resolve,reject)=>{let logs='';const t=setTimeout(()=>reject(new Error('Chrome startup timed out')),15000);browser.once('error',reject);browser.once('exit',code=>{clearTimeout(t);reject(new Error(`Chrome exited ${code}: ${logs.slice(-1200)}`))});browser.stderr.on('data',d=>{logs+=d;const m=logs.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(t);resolve(m[1])}})});
 socket=new WebSocket(endpoint);await new Promise((yes,no)=>{socket.onopen=yes;socket.onerror=no});let next=0;const pending=new Map();
 socket.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(new Error(m.error.message));else p.resolve(m.result)}};
 function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,sessionId}))})}
 const {targetId}=await send('Target.createTarget',{url:`http://127.0.0.1:${port}/`});const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 await new Promise(r=>setTimeout(r,1000));
 const result=await send('Runtime.evaluate',{expression:'window.runDomTests()',awaitPromise:true,returnByValue:true},sessionId);
 if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));
 const tests=result.result.value;console.log(JSON.stringify(tests,null,2));
 await writeFile(new URL('../reports/browser.local.json',import.meta.url),JSON.stringify({tests},null,2));
 if(tests.some(t=>t.passed===false))process.exitCode=1;
}catch(e){console.error(`Browser tests NOT VERIFIED: ${e.message}`);process.exitCode=1}
finally{socket?.close();browser?.kill();server?.close();await new Promise(r=>setTimeout(r,300));await rm(profile,{recursive:true,force:true,maxRetries:3})}
