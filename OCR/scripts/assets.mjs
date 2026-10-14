// Setup-time downloads only. Runtime OCR loads packaged extension resources.
import { installModel } from './model-lib.mjs';
import { mkdir, writeFile, readFile, cp, rm, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { packages, fixturePackages, validateDist, verifyArchive, validatePackage, readLock } from './asset-lib.mjs';
const root=resolve(import.meta.dirname,'..'), cache=`${root}/.vendor-cache`, lockPath=`${root}/assets.lock.json`;
const selected=process.argv.includes('--fixtures')?[...packages,...fixturePackages]:packages;
await mkdir(cache,{recursive:true});
async function download(url){
  let response;
  try{response=await fetch(url,{signal:AbortSignal.timeout(60_000)})}
  catch(e){throw new Error(`Download failed (${e.cause?.code || e.name}): ${url}`)}
  if(!response.ok)throw new Error(`HTTP ${response.status}: ${url}`);
  return response;
}
async function saveLock(lock){await writeFile(`${lockPath}.tmp`,JSON.stringify(lock,null,2)+'\n');await rename(`${lockPath}.tmp`,lockPath)}
try{
  const lock=await readLock(lockPath);
  for(const p of selected){
    const key=`${p.name}@${p.version}`, archive=`${cache}/${p.key}.tgz`, dir=`${cache}/${p.key}`, stage=`${cache}/${p.key}.installing`, backup=`${cache}/${p.key}.previous`;
    const dist=validateDist(lock[key] || (await (await download(`https://registry.npmjs.org/${encodeURIComponent(p.name)}/${p.version}`)).json()).dist);
    let bytes;
    try{bytes=await readFile(archive)}catch(e){if(e.code!=='ENOENT')throw e}
    if(bytes){verifyArchive(bytes,dist.integrity);console.log(`Verified cached ${key}`)}
    else{
      bytes=Buffer.from(await (await download(dist.tarball)).arrayBuffer());verifyArchive(bytes,dist.integrity);
      await writeFile(`${archive}.tmp`,bytes);await rename(`${archive}.tmp`,archive);console.log(`Downloaded and verified ${key}`);
    }
    lock[key]=dist;await saveLock(lock);
    // Re-extract verified archives, so edited cache files cannot silently enter the build.
    await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true});
    try{
      execFileSync('tar',['-xzf',archive,'-C',stage,'--strip-components=1']);await validatePackage(stage,p);
      await rm(backup,{recursive:true,force:true});
      let backedUp=false;
      try{await rename(dir,backup);backedUp=true}catch(e){if(e.code!=='ENOENT')throw e}
      try{await rename(stage,dir)}catch(e){if(backedUp)await rename(backup,dir);throw e}
      await rm(backup,{recursive:true,force:true});
    }finally{await rm(stage,{recursive:true,force:true})}
  }
  await installModel(`${cache}/best-eng`, download);
  if(process.argv.includes('--fixtures')){
    const dest=`${cache}/fixture`;await mkdir(dest,{recursive:true});
    for(const p of fixturePackages)await cp(`${cache}/${p.key}/${p.required[0]}`,`${dest}/${p.required[0].split('/').pop()}`);
  }
  console.log('Assets ready. Run npm run build.');
}catch(e){console.error(`Asset installation failed: ${e.message}\nVerified downloads are retained. Retry on a network-connected Mac. No fake OCR assets were generated.`);process.exitCode=1}
