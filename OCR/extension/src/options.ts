import { settingsOf } from './core.ts';
import type { Profile } from './core.ts';
const input = (id: string) => document.getElementById(id) as HTMLInputElement;
async function load() {
  const stored = await chrome.storage.local.get(['settings', 'profiles']), s = settingsOf(stored.settings);
  input('idle').value = String(s.idleMinutes); input('bytes').value = String(s.maxBytes/1024);
  input('pixels').value = String(s.maxPixels); input('timeout').value = String(s.timeoutMs/1000);
  const list = document.getElementById('profiles')!; list.replaceChildren();
  for (const p of (stored.profiles || []) as Profile[]) {
    const li = document.createElement('li'); li.textContent = `${p.origin}${p.pathname} · ${p.image.locator.selector} → ${p.field.selector}`;
    const button = document.createElement('button'); button.textContent = '刪除';
    button.onclick = async () => { const all = (await chrome.storage.local.get('profiles')).profiles || []; await chrome.storage.local.set({ profiles: all.filter((q: Profile) => q.profileId !== p.profileId) }); await load(); };
    li.append(button); list.append(li);
  }
  if (!list.children.length) list.textContent = '尚無保存的設定。';
}
document.getElementById('settings')!.onsubmit = async e => {
  e.preventDefault();
  const settings = settingsOf({ idleMinutes: +input('idle').value, maxBytes: +input('bytes').value*1024, maxPixels: +input('pixels').value, timeoutMs: +input('timeout').value*1000 });
  await chrome.storage.local.set({ settings }); document.getElementById('status')!.textContent = '已儲存；下次辨識生效。';
};
void load();
