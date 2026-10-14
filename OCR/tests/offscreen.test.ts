import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
function harness(options: {hang?:boolean;bytes?:number;width?:number;height?:number;text?:string}={}){
 let receive:Function, initialized=0,terminated=0,pixel=1;let closed=0;
 const timers=new Map<number,{fn:Function,ms:number}>();let next=0;
 const chrome={runtime:{id:'test',getURL:(s:string)=>`chrome-extension://test/${s}`,onMessage:{addListener:(f:Function)=>receive=f},sendMessage:async(m:any)=>{if(m.type==='CLOSE_OFFSCREEN')closed++}}};
 const canvas=()=>({width:0,height:0,getContext:()=>({drawImage(){},getImageData:()=>({width:2,height:2,data:new Uint8ClampedArray(16).fill(pixel)})}),toDataURL:()=> 'data:image/png;base64,'+'A'.repeat(options.bytes||16)});
 const Tesseract={createWorker:async()=>{initialized++;return {setParameters:async()=>{},recognize:async()=>options.hang?new Promise(()=>{}):{data:{text:options.text||'001234',confidence:90}},terminate:async()=>{terminated++}}}};
 const source=['core','provider','offscreen'].map(f=>stripTypeScriptTypes(readFileSync(new URL(`../extension/src/${f}.ts`,import.meta.url),'utf8'),{mode:'strip'}).replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'')).join('\n');
 vm.runInNewContext(source,{chrome,Tesseract,document:{createElement:canvas},performance,Uint8ClampedArray,Uint8Array,Blob,atob,fetch:async()=>{throw new Error('fetch is forbidden for screenshot decoding')},createImageBitmap:async()=>({width:options.width||10,height:options.height||10,close(){}}),setTimeout:(fn:Function,ms:number)=>{const id=++next;timers.set(id,{fn,ms});return id},clearTimeout:(id:number)=>timers.delete(id),console});
 const send=(type:string,extra:object={})=>new Promise<any>(resolve=>receive({target:'offscreen',type,requestId:'a',session:'s',...extra},{id:'test',url:'chrome-extension://test/background.js'},resolve));
 const crop=(phase='A')=>send('CROP',{phase,screenshot:'data:image/png;base64,AAAA',rect:{x:0,y:0,width:2,height:2},viewport:{width:10,height:10}});
 return {send,crop,timers,refresh(){pixel=2},get initialized(){return initialized},get terminated(){return terminated},get closed(){return closed}};
}
test('offscreen compares pixels and never initializes OCR for capture alone',async()=>{
 const h=harness();await h.send('BEGIN');await h.crop();assert.equal(h.initialized,0);
 assert.equal((await h.crop('B')).same,true);h.refresh();assert.equal((await h.crop('B')).error,'image_changed');
});
test('offscreen rejects crop limits before worker creation',async()=>{
 const h=harness({width:10_000,height:10_000});await h.send('BEGIN');assert.equal((await h.crop()).error,'image_too_large');assert.equal(h.initialized,0);
 const bytes=harness({bytes:2_000_000});await bytes.send('BEGIN');assert.equal((await bytes.crop()).error,'image_too_large');
});
test('offscreen terminates timed-out worker with recoverable error',async()=>{
 const h=harness({hang:true});await h.send('BEGIN',{settings:{timeoutMs:1000}});await h.crop();const response=h.send('OCR');
 await new Promise(r=>setImmediate(r));
 const timer=[...h.timers.values()].find(t=>t.ms===1000);assert.ok(timer);timer.fn();
 assert.equal((await response).error,'ocr_timeout');assert.equal(h.terminated,1);
});
test('idle release uses configured interval, closes document, then worker rebuilds',async()=>{
 const h=harness();await h.send('BEGIN',{settings:{idleMinutes:2}});await h.crop();assert.equal((await h.send('OCR')).text,'001234');
 await h.send('END');const idle=[...h.timers.values()].find(t=>t.ms===120_000);assert.ok(idle);await idle.fn();assert.equal(h.terminated,1);assert.equal(h.closed,1);
 await h.send('BEGIN');await h.crop();await h.send('OCR');assert.equal(h.initialized,2);
});
test('old offscreen request cannot write crop after cancellation',async()=>{
 const h=harness();await h.send('BEGIN');await h.crop();await h.send('END');assert.equal((await h.send('OCR')).error,'stale_request');
});

test('offscreen forwards English and digits modes to OCR across requests', async () => {
 const h=harness({text:'00AbZx'}); await h.send('BEGIN'); await h.crop();
 assert.equal((await h.send('OCR',{expectedLength:6,characterMode:'alphanumeric'})).status,'ok');
 await h.send('END'); await h.send('BEGIN'); await h.crop();
 assert.equal((await h.send('OCR',{expectedLength:6,characterMode:'digits'})).status,'review');
 await h.send('END');
});
