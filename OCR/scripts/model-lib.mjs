import { createHash } from 'node:crypto';
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';

// Official tessdata_best revision and Git object IDs; never substitute best_int.
export const model = Object.freeze({
  name: 'tessdata_best/eng',
  revision: 'e12c65a915945e4c28e237a9b52bc4a8f39a0cec',
  file: 'eng.traineddata',
  bytes: 15400601,
  blob: '176dc3220de7db34d3b3aecbfa42043a6038348b',
  licenseBlob: 'd9a10c0d8e868ebf8da0b3dc95bb0be634c34bfe',
});
export function verifyGitBlob(bytes, expected) {
  const hash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (hash !== expected) throw new Error('Official model asset integrity mismatch');
}
export function verifyModel(bytes) {
  if (bytes.length !== model.bytes) throw new Error('Model size mismatch; tessdata_best/eng is required');
  verifyGitBlob(bytes, model.blob);
}
export async function validateModel(dir) {
  verifyModel(await readFile(`${dir}/${model.file}`));
  verifyGitBlob(await readFile(`${dir}/LICENSE`), model.licenseBlob);
}
export async function installModel(dir, download) {
  await mkdir(dir, { recursive: true });
  for (const [file, check] of [[model.file, verifyModel], ['LICENSE', bytes => verifyGitBlob(bytes, model.licenseBlob)]]) {
    let bytes;
    try { bytes = await readFile(`${dir}/${file}`); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (bytes) { check(bytes); console.log(`Verified cached tessdata_best/${file}`); continue; }
    const url = `https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/${model.revision}/${file}`;
    bytes = Buffer.from(await (await download(url)).arrayBuffer());
    check(bytes);
    await writeFile(`${dir}/${file}.tmp`, bytes);
    await rename(`${dir}/${file}.tmp`, `${dir}/${file}`);
    console.log(`Downloaded and verified tessdata_best/${file}`);
  }
}
