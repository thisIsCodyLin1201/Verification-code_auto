import { readFile, writeFile, mkdir, cp, readdir, access, rm, rename } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { resolve } from 'node:path';
import { model, validateModel } from './model-lib.mjs';
import { packages, validatePackage, sha256 } from './asset-lib.mjs';
const root = resolve(import.meta.dirname, '..');
const uiOnly = process.argv.includes('--ui-only');
const destination = resolve(root, uiOnly ? 'dist-ui' : 'dist');
const out = destination + '.building';
const cache = `${root}/.vendor-cache`;
if (!uiOnly) {
  try { await validateModel(`${cache}/best-eng`); }
  catch (e) { throw new Error(`High-accuracy English model unavailable: ${e.message}. Double-click 安裝 Chrome 插件.command to download it. Existing dist is preserved.`); }
  for (const p of packages) {
    try { await validatePackage(`${cache}/${p.key}`, p); }
    catch (e) { throw new Error(`OCR assets unavailable or incomplete (${p.name}): ${e.message}. Run npm run assets, or double-click the Mac installer first.`); }
  }
  for (const file of ['api/dist/tesseract.min.js','api/dist/worker.min.js',...['tesseract-core','tesseract-core-simd','tesseract-core-lstm','tesseract-core-simd-lstm'].flatMap(name => [`core/${name}.wasm.js`,`core/${name}.wasm`]),'best-eng/eng.traineddata']) {
    try { await access(`${cache}/${file}`); } catch { throw new Error(`Missing OCR asset: ${file}. Run npm run assets first. UI-only build: npm run build:ui (OCR unavailable).`); }
  }
}
await rm(out,{recursive:true,force:true});
await mkdir(out,{recursive:true});
for (const f of await readdir(`${root}/extension/static`)) await cp(`${root}/extension/static/${f}`, `${out}/${f}`);
const source = async name => stripTypeScriptTypes(await readFile(`${root}/extension/src/${name}.ts`,'utf8'), {mode:'strip'});
for (const f of ['core','dom','provider','background','offscreen','popup','options']) {
  const js = (await source(f)).replaceAll(".ts'", ".js'");
  await writeFile(`${out}/${f}.js`,js);
}
// Explicit closed module graph for the non-module content script; no runtime loader or eval.
const bundle = [];
for (const f of ['core','dom','content']) {
  const js = (await source(f)).replace(/^import .*?;\s*$/gm, '').replace(/^export /gm,'');
  bundle.push(js);
}
await writeFile(`${out}/content.js`, `(() => {\n${bundle.join('\n')}\n})();\n`);
if (!uiOnly) {
  await mkdir(`${out}/vendor/core`,{recursive:true}); await mkdir(`${out}/vendor/lang`,{recursive:true});
  await cp(`${cache}/api/dist/tesseract.min.js`,`${out}/vendor/tesseract.min.js`);
  await cp(`${cache}/api/dist/worker.min.js`,`${out}/vendor/worker.min.js`);
  for (const f of await readdir(`${cache}/core`)) if (/^tesseract-core.*\.wasm(\.js)?$/.test(f)) await cp(`${cache}/core/${f}`,`${out}/vendor/core/${f}`);
  await cp(`${cache}/best-eng/eng.traineddata`,`${out}/vendor/lang/eng.traineddata`);
  await mkdir(`${out}/licenses`, {recursive:true});
  await cp(`${cache}/best-eng/LICENSE`, `${out}/licenses/tessdata-best-LICENSE`);
  for (const name of ['api','core']) for (const f of await readdir(`${cache}/${name}`)) if (/^licen[cs]e/i.test(f)) await cp(`${cache}/${name}/${f}`,`${out}/licenses/${name}-${f}`);
} else {
  await mkdir(`${out}/vendor`,{recursive:true});
  await writeFile(`${out}/vendor/tesseract.min.js`, '// OCR assets unavailable in this UI-only build. The provider returns assets_missing.\n');
}
const files = {};
async function inventory(dir, prefix='') {
  for (const entry of await readdir(dir, {withFileTypes:true})) {
    const name=prefix+entry.name;
    if (entry.isDirectory()) await inventory(`${dir}/${entry.name}`,name+'/');
    else files[name]=sha256(await readFile(`${dir}/${entry.name}`));
  }
}
await inventory(out);
await writeFile(`${out}/BUILD-STATUS.json`,JSON.stringify({ version:JSON.parse(await readFile(`${out}/manifest.json`,'utf8')).version, complete:!uiOnly, ocrAssetsBundled:!uiOnly, model:uiOnly ? null : model, compiler:'node:module stripTypeScriptTypes (syntax stripping, not type checking)', files },null,2)+'\n');
const backup=destination+'.previous';
await rm(backup,{recursive:true,force:true});
let backedUp=false;
try{await rename(destination,backup);backedUp=true}catch(e){if(e.code!=='ENOENT')throw e}
try{await rename(out,destination)}catch(e){if(backedUp)await rename(backup,destination);throw e}
await rm(backup,{recursive:true,force:true});
console.log(`${uiOnly?'UI ONLY — OCR unavailable':'Complete extension'}: ${destination}`);
