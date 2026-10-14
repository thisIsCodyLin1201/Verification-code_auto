import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { model, verifyModel, verifyGitBlob } from './model-lib.mjs';
import { sha256, engines } from './asset-lib.mjs';
export async function verifyBuild(dir){
  const status=JSON.parse(await readFile(`${dir}/BUILD-STATUS.json`,'utf8'));
  if(status.complete!==true||status.ocrAssetsBundled!==true)throw new Error('This is a UI-only/incomplete build');
  const required=['vendor/tesseract.min.js','vendor/worker.min.js','vendor/lang/eng.traineddata','licenses/tessdata-best-LICENSE',...engines.flatMap(n=>[`vendor/core/${n}.wasm.js`,`vendor/core/${n}.wasm`])];
  for(const f of required)if(!status.files?.[f])throw new Error(`Missing packaged resource: ${f}`);
  for(const [f,expected] of Object.entries(status.files||{})){
    const path=resolve(dir,f);
    if(!path.startsWith(resolve(dir)+'/'))throw new Error('Invalid inventory path');
    if(sha256(await readFile(path))!==expected)throw new Error(`Build content changed: ${f}`);
  }
  if(status.model?.blob!==model.blob || status.model?.name!==model.name || status.model?.revision!==model.revision)throw new Error('Unexpected OCR model');
  verifyModel(await readFile(`${dir}/vendor/lang/eng.traineddata`));
  verifyGitBlob(await readFile(`${dir}/licenses/tessdata-best-LICENSE`),model.licenseBlob);
  const manifest=JSON.parse(await readFile(`${dir}/manifest.json`,'utf8'));
  if(manifest.manifest_version!==3||manifest.host_permissions?.length)throw new Error('Unexpected manifest permissions');
  for(const p of manifest.permissions)if(!['activeTab','scripting','storage','offscreen'].includes(p))throw new Error(`Unexpected permission: ${p}`);
  return {files:Object.keys(status.files).length,version:manifest.version};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  try{const result=await verifyBuild(resolve(import.meta.dirname,'../dist'));console.log(`Verified ${result.files} packaged files. Chrome extension ${result.version}.`)}
  catch(e){console.error(`Build verification failed: ${e.message}`);process.exitCode=1}
}
