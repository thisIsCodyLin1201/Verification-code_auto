import { spawn } from 'node:child_process';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
await mkdir(`${root}/reports`, { recursive: true });
let log = `本機 OCR 安裝 ${new Date().toISOString()}\nNode ${process.version}\n`;
function say(message) { console.log(message); log += message+'\n'; }
async function run(args) {
  return new Promise((yes, no) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: ['ignore','pipe','pipe'] });
    child.stdout.on('data', data => { process.stdout.write(data); log += data; });
    child.stderr.on('data', data => { process.stderr.write(data); log += data; });
    child.on('error', no);
    child.on('exit', (code, signal) => code === 0 ? yes() : no(new Error(`步驟失敗：${args.join(' ')}（${signal || code}）`)));
  });
}
try {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('需要 Node.js 24 或更新版本，請從 https://nodejs.org 安裝 LTS 版本。');
  say('1/4 下載並驗證本機 OCR 與測試資源（僅首次需要網路）…');
  await run(['scripts/assets.mjs','--fixtures']);
  say('2/4 執行程式測試…');
  await run(['--test', ...(await readdir(`${root}/tests`)).filter(f => f.endsWith('.test.ts')).map(f => `tests/${f}`)]);
  say('3/4 建立 Chrome 安裝資料夾…');
  await run(['scripts/build.mjs']);
  await run(['scripts/build.mjs','--ui-only']);
  say('4/4 驗證安裝檔案…');
  await run(['scripts/verify-build.mjs']);
  say(`\n安裝包建立成功：${root}/dist\n\n下一步：\n1. 用 Chrome 開啟 chrome://extensions\n2. 開啟「開發人員模式」\n3. 按「載入未封裝項目」，選擇上面的 dist 資料夾\n4. 將「本機驗證碼圖片助手」固定到工具列\n\n這表示資源已打包，不代表真實網站辨識已測試通過。\n可雙擊「啟動測試頁.command」進行試用。`);
} catch (error) {
  say(`\n未完成安裝：${error.message}\n請確認網路連線與 Node.js 版本，修正後再次雙擊安裝。\n已驗證下載的檔案會保留，重跑可續用；不會用假 OCR 代替。`);
  process.exitCode = 1;
} finally {
  await writeFile(`${root}/reports/setup-latest.log`,log);
  console.log(`執行紀錄：${root}/reports/setup-latest.log`);
}
