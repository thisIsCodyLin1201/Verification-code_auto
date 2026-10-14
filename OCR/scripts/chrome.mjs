import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
export async function launchChrome() {
  const profile=await mkdtemp(`${tmpdir()}/ocr-eval-`);
  const executable=process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const child=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
  let socket;
  const close=async()=>{socket?.close();child.kill();await new Promise(r=>setTimeout(r,300));await rm(profile,{recursive:true,force:true,maxRetries:3})};
  try {
    const endpoint=await new Promise((resolve,reject)=>{let logs='';const timer=setTimeout(()=>reject(new Error('Chrome startup timed out')),15000);child.once('error',e=>{clearTimeout(timer);reject(e)});child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Chrome exited ${code}: ${logs.slice(-1200)}`))});child.stderr.on('data',d=>{logs+=d;const m=logs.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timer);resolve(m[1])}})});
    socket=new WebSocket(endpoint);await new Promise((yes,no)=>{socket.onopen=yes;socket.onerror=no});let next=0;const pending=new Map();
    socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(new Error(m.error.message));else p.resolve(m.result)}};
    const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,sessionId}))});
    return {send,close};
  } catch(e) {await close();throw e}
}
