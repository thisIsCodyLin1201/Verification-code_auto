import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
export const engines = ['tesseract-core','tesseract-core-simd','tesseract-core-lstm','tesseract-core-simd-lstm'];
export const packages = [
  {name:'tesseract.js',version:'6.0.1',key:'api',required:['dist/tesseract.min.js','dist/worker.min.js']},
  {name:'tesseract.js-core',version:'6.0.0',key:'core',required:engines.flatMap(n=>[`${n}.wasm.js`,`${n}.wasm`])},
];
export const fixturePackages = [
  {name:'react',version:'18.3.1',key:'react',required:['umd/react.production.min.js']},
  {name:'react-dom',version:'18.3.1',key:'react-dom',required:['umd/react-dom.production.min.js']},
  {name:'vue',version:'3.5.13',key:'vue',required:['dist/vue.global.prod.js']},
];
export function validateDist(dist) {
  if (!dist || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(dist.integrity || '')) throw new Error('Missing or invalid registry SHA-512 integrity');
  const url = new URL(dist.tarball);
  if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.username || url.password || url.port) throw new Error('Archive must use HTTPS on registry.npmjs.org');
  return { tarball:url.href, integrity:dist.integrity };
}
export function verifyArchive(bytes, integrity) {
  const actual='sha512-'+createHash('sha512').update(bytes).digest('base64');
  if(actual!==integrity) throw new Error('Archive integrity mismatch; remove the named cached .tgz and retry');
}
export async function validatePackage(dir,pkg) {
  const meta=JSON.parse(await readFile(`${dir}/package.json`,'utf8'));
  if(meta.name!==pkg.name||meta.version!==pkg.version)throw new Error(`Package identity mismatch: ${pkg.name}@${pkg.version}`);
  for(const file of pkg.required){
    const bytes=await readFile(`${dir}/${file}`);
    if(bytes.length<100)throw new Error(`Empty/incomplete asset: ${file}`);
    if(file.endsWith('.wasm')&&!bytes.subarray(0,4).equals(Buffer.from([0,97,115,109])))throw new Error(`Invalid WASM: ${file}`);
    if(file.endsWith('.gz')&&(bytes[0]!==31||bytes[1]!==139))throw new Error(`Invalid gzip: ${file}`);
  }
}
export async function readLock(path) {
  try { return JSON.parse(await readFile(path,'utf8')); }
  catch(e){if(e.code==='ENOENT')return {};throw new Error(`Cannot read asset lock: ${e.message}`)}
}
export function sha256(bytes){return createHash('sha256').update(bytes).digest('hex')}
