import { errorMessage } from './core.ts';
for (const mode of ['run', 'preview', 'new']) document.getElementById(mode)!.onclick = async () => {
  try {
    const response = await chrome.runtime.sendMessage({ target: 'background', type: 'LAUNCH', mode });
    if (!response?.ok) throw new Error(response?.error || 'capture_failed');
    window.close();
  } catch (e) { document.getElementById('status')!.textContent = errorMessage(e); }
};
document.getElementById('manage')!.onclick = () => void chrome.runtime.openOptionsPage();

void (async () => {
  try {
    const build = await (await fetch(chrome.runtime.getURL('BUILD-STATUS.json'))).json();
    if (!build.complete || !build.ocrAssetsBundled) {
      document.getElementById('status')!.textContent = '目前是介面測試版。請雙擊桌面 OCR 裡的「安裝 Chrome 插件.command」，完成後載入 dist。';
      for (const id of ['run','preview']) (document.getElementById(id) as HTMLButtonElement).disabled = true;
    }
  } catch { document.getElementById('status')!.textContent = '無法確認安裝完整性，請重新建立並載入 dist。'; }
})();
