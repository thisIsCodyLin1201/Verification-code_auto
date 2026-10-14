import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
function harness(options: {getSettings?: Function; createOffscreen?: Function; injectionFails?: boolean} = {}) {
  let receive: Function, captureCount=0, ends=0, closes=0, begins=0;
  const events: Record<string,Function>={};
  const offscreenMessages: any[] = [];
  const launches: any[] = [], injections: any[] = [], badges: string[] = [];
  let focused=true, contentOk=true, cropSame=true;
  const chrome = {
    action:{onClicked:{addListener:(f:Function)=>events.clicked=f},setBadgeText:async(details:any)=>{badges.push(details.text)},setBadgeBackgroundColor:async()=>{},setTitle:async()=>{}},
    scripting:{executeScript:async(details:any)=>{injections.push(details);if(options.injectionFails)throw new Error('Cannot access this page');return [{frameId:0,documentId:'injected-document'}]}},
    runtime:{id:'test',getURL:(s:string)=>`chrome-extension://test/${s}`,ContextType:{OFFSCREEN_DOCUMENT:'OFFSCREEN_DOCUMENT'},getContexts:async()=>options.createOffscreen?[]:[{}],onMessage:{addListener:(fn:Function)=>receive=fn},sendMessage:async(m:any)=>{offscreenMessages.push(m);if(m.type==='CROP'&&m.phase==='B'&&!cropSame)return {ok:false,error:'image_changed'};if(m.type==='END')ends++;if(m.type==='BEGIN')begins++;return {ok:true,text:'001234'}}},
    storage:{local:{get:async()=>options.getSettings?options.getSettings():({settings:{}})}},
    tabs:{query:async()=>[{id:1,status:'complete'}],sendMessage:async(tabId:any,message:any,options:any)=>{if(message.type==='OPEN')launches.push({tabId,message,options});return {ok:contentOk}},captureVisibleTab:async()=>{captureCount++;return 'data:image/png;base64,AA=='},onActivated:{addListener:(f:Function)=>events.activated=f},onUpdated:{addListener:(f:Function)=>events.updated=f},onRemoved:{addListener:(f:Function)=>events.removed=f}},
    windows:{get:async()=>({focused}),onFocusChanged:{addListener:(f:Function)=>events.focus=f}},
    offscreen:{closeDocument:async()=>{closes++},Reason:{},createDocument:async()=>options.createOffscreen?.()},
  };
  const source = ['core','background'].map(f=>stripTypeScriptTypes(readFileSync(new URL(`../extension/src/${f}.ts`,import.meta.url),'utf8'),{mode:'strip'}).replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'')).join('\n');
  vm.runInNewContext(source,{chrome,setTimeout:(fn:Function)=>setTimeout(fn,0),Date,URL,console});
  const sender={id:'test',tab:{id:1,windowId:1},documentId:'document',frameId:0};
  const send=(type:string,extra:object={},senderOverride:object={})=>new Promise<any>(resolve=>receive({target:'background',type,requestId:'a',session:'session',...extra},{...sender,...senderOverride},resolve));
  return {send,events,offscreenMessages,launches,injections,badges,get closes(){return closes},get begins(){return begins},get captures(){return captureCount},get ends(){return ends},unfocus(){focused=false},replaceTarget(){contentOk=false},refresh(){cropSame=false}};
}
test('capture refuses changed targets, without taking screenshot',async()=>{
  const h=harness(); assert.equal((await h.send('BEGIN')).ok,true);h.replaceTarget();
  assert.equal((await h.send('CAPTURE',{phase:'A'})).ok,false);assert.equal(h.captures,0);
});
test('A/B mismatch fails; canceled request cannot later capture',async()=>{
  const h=harness();await h.send('BEGIN');assert.equal((await h.send('CAPTURE',{phase:'A'})).ok,true);h.refresh();
  assert.equal((await h.send('CAPTURE',{phase:'B'})).error,'image_changed');
  assert.equal((await h.send('CAPTURE',{phase:'B'})).error,'stale_request');assert.equal(h.captures,2);
});
test('tab switch invalidates active operation',async()=>{
  const h=harness();await h.send('BEGIN');h.events.activated({tabId:2});
  assert.equal((await h.send('OCR')).error,'stale_request');
});
test('document navigation invalidates active operation',async()=>{
  const h=harness();await h.send('BEGIN');h.events.updated(1,{status:'loading'});
  assert.equal((await h.send('OCR')).error,'stale_request');
});
test('duplicate begin is rejected without replacing the first request',async()=>{
  const h=harness();await h.send('BEGIN');assert.equal((await h.send('BEGIN',{requestId:'b'})).error,'busy');
  assert.equal((await h.send('HEARTBEAT')).ok,true);await h.send('END');assert.equal(h.ends,1);
});

test('storage failure clears request ownership so the next attempt can start',async()=>{
  let reads=0;
  const h=harness({getSettings:async()=>{if(++reads===1)throw new Error('storage unavailable');return {settings:{}}}});
  assert.equal((await h.send('BEGIN')).ok,false);
  assert.equal((await h.send('BEGIN',{requestId:'next'})).ok,true);
});
test('cancellation while reading settings prevents delayed initialization from reviving request',async()=>{
  let release!:Function,reads=0;
  const h=harness({getSettings:()=>++reads===1?new Promise(resolve=>{release=resolve}):Promise.resolve({settings:{}})});
  const starting=h.send('BEGIN');await new Promise(r=>setImmediate(r));
  assert.equal((await h.send('CANCEL')).ok,true);
  release({settings:{}});assert.equal((await starting).error,'stale_request');assert.equal(h.begins,0);
  assert.equal((await h.send('BEGIN',{requestId:'new'})).ok,true);
});
test('cancel waits for pending offscreen creation then closes it without starting old OCR',async()=>{
  let release!:Function;
  const h=harness({createOffscreen:()=>new Promise(resolve=>{release=resolve})});
  const starting=h.send('BEGIN');await new Promise(r=>setImmediate(r));
  const canceling=h.send('CANCEL');await new Promise(r=>setImmediate(r));
  assert.equal(h.closes,0);release();
  assert.equal((await canceling).ok,true);assert.equal((await starting).ok,false);
  assert.equal(h.closes,1);assert.equal(h.begins,0);
});
test('message from wrong document cannot cancel current request',async()=>{
  const h=harness();await h.send('BEGIN');
  assert.equal((await h.send('CANCEL',{}, {documentId:'old-document'})).error,'stale_request');
  assert.equal((await h.send('HEARTBEAT')).ok,true);
});

test('toolbar click injects once and immediately selects image in the injected document',async()=>{
  const h=harness();await h.events.clicked({id:7,url:'https://example.com/login'});
  assert.equal(h.injections.length,1);
  assert.equal(h.launches.length,1);
  assert.equal(h.launches[0].tabId,7);
  assert.equal(h.launches[0].message.mode,'new');
  assert.equal(h.launches[0].options.documentId,'injected-document');
  assert.deepEqual(h.badges,['']);
});
test('unsupported page or denied injection shows toolbar error without opening selection',async()=>{
  const h=harness();await h.events.clicked({id:7,url:'chrome://extensions'});
  assert.equal(h.injections.length,0);assert.equal(h.launches.length,0);assert.deepEqual(h.badges,['!']);
  const denied=harness({injectionFails:true});await denied.events.clicked({id:7,url:'https://example.com/login'});
  assert.equal(denied.launches.length,0);assert.deepEqual(denied.badges,['!']);
});

test('background carries the selected alphabet and length to offscreen',async()=>{
 const h=harness();await h.send('BEGIN');await h.send('OCR',{characterMode:'alphanumeric',expectedLength:6});
 const message=h.offscreenMessages.find(m=>m.type==='OCR');
 assert.equal(message.characterMode,'alphanumeric');assert.equal(message.expectedLength,6);
 await h.send('END');
});
