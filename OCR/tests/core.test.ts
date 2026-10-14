import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizedRect, cropCoordinates, equalPixels, validDigits, expectedLengthOf, checkLimits, defaults, settingsOf, pageKey, matchingProfiles, RequestGate, screenshotBlob } from '../extension/src/core.ts';
import type { Profile } from '../extension/src/core.ts';
test('crop uses actual horizontal and vertical screenshot ratios, including fractional zoom', () => {
  assert.deepEqual(cropCoordinates({x:10,y:20,width:30,height:40},{width:800,height:600},{width:1600,height:1200}),{x:20,y:40,width:60,height:80});
  assert.deepEqual(cropCoordinates({x:1.2,y:2.3,width:10.1,height:9.2},{width:800,height:600},{width:1000,height:1200}),{x:1,y:4,width:14,height:19});
});
test('drag directions normalize; empty/outside/NaN crops reject', () => {
  assert.deepEqual(normalizedRect(20,30,5,4), {x:5,y:4,width:15,height:26});
  for (const r of [{x:-1,y:0,width:3,height:3},{x:0,y:0,width:0,height:3},{x:99,y:0,width:3,height:3},{x:NaN,y:0,width:3,height:3}]) assert.throws(()=>cropCoordinates(r,{width:100,height:100},{width:200,height:200}),/invalid_crop/);
});
test('strict pixels detect one-channel refresh and dimension changes', () => {
  const a = new Uint8ClampedArray([1,2,3,255]);
  assert.equal(equalPixels(a,a.slice(),1,1,1,1),true);
  assert.equal(equalPixels(a,new Uint8ClampedArray([1,2,4,255]),1,1,1,1),false);
  assert.equal(equalPixels(a,a,1,1,2,1),false);
});
test('digits stay strings; expected length only validates, never pads', () => {
  assert.equal(validDigits('001234',6),true);
  for (const s of ['123','12O456','１２３４５６','','123456\n']) assert.equal(validDigits(s,6),false);
  assert.equal(validDigits('123\n'),false);
  assert.equal(expectedLengthOf(''),undefined);
  assert.equal(expectedLengthOf('6'),6);
  assert.throws(()=>expectedLengthOf('6.5'));
});
test('limits reject oversized files/pixels; malformed settings are bounded', () => {
  checkLimits(1000,100,40,defaults);
  assert.throws(()=>checkLimits(defaults.maxBytes+1,100,40,defaults),/image_too_large/);
  assert.throws(()=>checkLimits(100,2000,2000,defaults),/image_too_large/);
  assert.throws(()=>checkLimits(100,NaN,2000,defaults),/image_too_large/);
  assert.equal(settingsOf({idleMinutes:999,timeoutMs:0,maxPixels:NaN}).idleMinutes,30);
  assert.equal(settingsOf({maxPixels:NaN}).maxPixels,defaults.maxPixels);
});
test('profile matches exact origin/path, excludes query/hash and leaves ambiguity explicit', () => {
  assert.deepEqual(pageKey('https://example.com/login?q=secret#abc'),{origin:'https://example.com',pathname:'/login'});
  const p = {schemaVersion:1,origin:'https://example.com',pathname:'/login'} as Profile;
  assert.equal(matchingProfiles([p,p],'https://example.com/login?different=1').length,2);
  assert.equal(matchingProfiles([p],'https://example.com/login/').length,0);
  assert.throws(()=>pageKey('chrome://settings'));
});
test('one active request; canceled and prior document responses cannot commit', () => {
  const gate = new RequestGate(); gate.begin('a','doc1');
  assert.throws(()=>gate.begin('b','doc1'),/busy/);
  assert.throws(()=>gate.check('a','doc2'),/stale/);
  gate.cancel(); assert.throws(()=>gate.check('a','doc1'),/stale/);
  gate.begin('b','doc1'); assert.throws(()=>gate.check('a','doc1'),/stale/); gate.check('b','doc1');
});

test('screenshot data URLs decode locally without fetch; malformed/non-PNG URLs fail', async () => {
  const png = Buffer.from([137,80,78,71,13,10,26,10]);
  const blob = screenshotBlob('data:image/png;base64,' + png.toString('base64'));
  assert.equal(blob.type,'image/png');
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()),png);
  for (const input of ['https://example.com/image.png','data:image/jpeg;base64,AAAA','data:image/png;base64,','data:image/png;base64,%%%']) assert.throws(()=>screenshotBlob(input),/capture_failed/);
});
