import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { validateDist,verifyArchive,readLock } from '../scripts/asset-lib.mjs';
import { model, verifyGitBlob, verifyModel, installModel } from '../scripts/model-lib.mjs';
import { verifyBuild } from '../scripts/verify-build.mjs';
const data=Buffer.from('integrity test fixture');
const integrity='sha512-'+createHash('sha512').update(data).digest('base64');
test('asset installer accepts only official HTTPS registry metadata with SHA-512',()=>{
  assert.equal(validateDist({tarball:'https://registry.npmjs.org/a/-/a.tgz',integrity}).integrity,integrity);
  for(const tarball of ['http://registry.npmjs.org/a.tgz','https://registry.npmjs.org.example.com/a.tgz','https://someone@registry.npmjs.org/a.tgz'])assert.throws(()=>validateDist({tarball,integrity}));
  assert.throws(()=>validateDist({tarball:'https://registry.npmjs.org/a.tgz',integrity:'sha1-abc'}));
});
test('asset installer detects corrupt cached downloads',()=>{
  verifyArchive(data,integrity);
  assert.throws(()=>verifyArchive(Buffer.from('changed'),integrity),/integrity mismatch/);
});
test('invalid existing lock fails rather than silently replacing checksums',async()=>{
  const dir=await mkdtemp(`${tmpdir()}/ocr-lock-test-`);
  try{assert.deepEqual(await readLock(`${dir}/absent.json`),{});await writeFile(`${dir}/lock.json`,'broken');await assert.rejects(readLock(`${dir}/lock.json`),/Cannot read asset lock/)}finally{await rm(dir,{recursive:true,force:true})}
});
test('build verifier refuses UI-only package and missing OCR resources',async()=>{
  const dir=await mkdtemp(`${tmpdir()}/ocr-verify-test-`);
  try{
    await writeFile(`${dir}/BUILD-STATUS.json`,JSON.stringify({complete:false}));await assert.rejects(verifyBuild(dir),/incomplete/);
    await writeFile(`${dir}/BUILD-STATUS.json`,JSON.stringify({complete:true,ocrAssetsBundled:true,files:{}}));await assert.rejects(verifyBuild(dir),/Missing packaged resource/);
  }finally{await rm(dir,{recursive:true,force:true})}
});

test('model installer detects modified bytes and refuses integer-model substitutes', () => {
 const hash=createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
 verifyGitBlob(data,hash);
 assert.throws(()=>verifyGitBlob(Buffer.from('modified'),hash),/integrity mismatch/);
 assert.throws(()=>verifyModel(data),/size mismatch/);
 assert.throws(()=>verifyModel(Buffer.alloc(model.bytes)),/integrity mismatch/);
});
test('failed model download leaves no usable model file',async()=>{
 const dir=await mkdtemp(`${tmpdir()}/ocr-model-test-`);
 try{
  await assert.rejects(installModel(dir,async()=>({arrayBuffer:async()=>data})),/size mismatch/);
  const {readdir}=await import('node:fs/promises');assert.deepEqual(await readdir(dir),[]);
 }finally{await rm(dir,{recursive:true,force:true})}
});
