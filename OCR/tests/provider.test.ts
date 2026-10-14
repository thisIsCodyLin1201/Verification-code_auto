import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalProvider } from '../extension/src/provider.ts';
import { validCode, characterModeOf, recognitionWhitelist } from '../extension/src/core.ts';
import type { WorkerLike } from '../extension/src/provider.ts';
const canvas = () => ({ width:120,height:40,getContext:()=>({drawImage(){},filter:''}) }) as unknown as HTMLCanvasElement;
(globalThis as any).document = { createElement: canvas };
function mock(text='001234') {
  let terminated=0, calls=0;
  const worker: WorkerLike = {setParameters:async()=>{},recognize:async()=>{calls++;return {data:{text,confidence:90}}},terminate:async()=>{terminated++}};
  return {worker,get terminated(){return terminated},get calls(){return calls}};
}
test('worker initializes on demand, uses three bounded variants, and is reused', async () => {
  let created=0; const w=mock(), p=new LocalProvider(async()=>{created++;return w.worker});
  assert.equal(created,0);
  assert.equal((await p.recognize(canvas(),6)).text,'001234');
  assert.equal((await p.recognize(canvas(),6)).status,'ok');
  assert.equal(created,1); assert.equal(w.calls,6);
  await p.dispose(); assert.equal(w.terminated,1);
  await p.recognize(canvas()); assert.equal(created,2); await p.dispose();
});
test('uncertain or incorrect length remains review, without invented digits', async () => {
  const w=mock('123'), p=new LocalProvider(async()=>w.worker);
  const result=await p.recognize(canvas(),6);
  assert.equal(result.status,'review'); assert.equal(result.text,'123'); await p.dispose();
});
test('parallel recognition rejects; cancellation discards delayed worker initialization', async () => {
  let resolve!: (w:WorkerLike)=>void;
  const p=new LocalProvider(()=>new Promise(r=>{resolve=r}));
  const first=p.recognize(canvas());
  await assert.rejects(p.recognize(canvas()),/busy/);
  await p.dispose(); const w=mock(); resolve(w.worker);
  await assert.rejects(first,/stale_request/); assert.equal(w.terminated,1);
});
test('initialization failure can recover on the next user request', async () => {
  let attempts=0; const w=mock();
  const p=new LocalProvider(async()=>{if (++attempts===1) throw new Error('init failed');return w.worker});
  await assert.rejects(p.recognize(canvas()),/init failed/);
  assert.equal((await p.recognize(canvas())).text,'001234'); await p.dispose();
});

test('parameter initialization failure terminates partial worker before retry', async () => {
  const failed=mock(), working=mock();
  failed.worker.setParameters=async()=>{throw new Error('parameter failure')};
  let attempts=0;
  const p=new LocalProvider(async()=>++attempts===1?failed.worker:working.worker);
  await assert.rejects(p.recognize(canvas()),/parameter failure/);
  assert.equal(failed.terminated,1);
  assert.equal((await p.recognize(canvas())).text,'001234');
  assert.equal(attempts,2); await p.dispose();
});

test('English codes preserve case and leading zeros; validation rejects other characters', () => {
  for (const text of ['Ab09Zx', '00aB', 'ABC', 'xyz']) assert.equal(validCode(text), true);
  for (const text of ['', 'AB-12', 'ＡB12', '中123', 'abc\n', 'a'.repeat(65)]) assert.equal(validCode(text), false);
  assert.equal(validCode('Ab09Zx', 5), false);
  assert.equal(validCode('Ab09Zx', 6, 'digits'), false);
  assert.equal(validCode('001234', 6, 'digits'), true);
  assert.equal(characterModeOf(undefined), 'alphanumeric');
  assert.throws(() => characterModeOf('unknown'), /invalid_character_mode/);
});
test('English recognition returns unchanged text and whitelist resets on a reused worker', async () => {
  const w = mock('00AbZx'), parameters: Record<string,string>[] = [];
  w.worker.setParameters = async p => { parameters.push(p); };
  const p = new LocalProvider(async () => w.worker);
  assert.equal((await p.recognize(canvas(), 6)).text, '00AbZx');
  assert.equal((await p.recognize(canvas(), 6)).status, 'ok');
  assert.equal((await p.recognize(canvas(), 6, 'digits')).status, 'review');
  assert.equal(parameters.at(-1)?.tessedit_char_whitelist, '0123456789');
  assert.equal((await p.recognize(canvas(), 6, 'alphanumeric')).status, 'ok');
  assert.equal(parameters.at(-1)?.tessedit_char_whitelist, recognitionWhitelist('alphanumeric'));
  await p.dispose();
});
test('case disagreement requires review and never auto-capitalizes', async () => {
  const w = mock(); let i = 0;
  w.worker.recognize = async () => ({ data: { text: ['aB0123', 'AB0123', 'aB0123'][i++], confidence: 99 } });
  const p = new LocalProvider(async () => w.worker), result = await p.recognize(canvas(), 6);
  assert.equal(result.text, 'aB0123'); assert.equal(result.status, 'review'); await p.dispose();
});
test('invalid character mode rejects before worker initialization', async () => {
  let created = 0; const p = new LocalProvider(async () => { created++; return mock().worker; });
  await assert.rejects(p.recognize(canvas(), undefined, 'unknown' as any), /invalid_character_mode/);
  assert.equal(created, 0);
});
