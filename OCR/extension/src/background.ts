import { RequestGate, settingsOf, errorMessage } from './core.ts';
const gate = new RequestGate();
let active: { requestId: string; session: string; tabId: number; windowId: number; documentId: string; deadline: number; settings: ReturnType<typeof settingsOf> } | undefined;
let creating: Promise<void> | undefined;
let lastCapture = 0;
let captureBusy = false;
let cleanup: Promise<void> = Promise.resolve();
async function ensureOffscreen() {
  if (creating) return creating;
  creating = (async () => {
    if (!(await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [chrome.runtime.getURL('offscreen.html')] })).length) {
      await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: [chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.BLOBS], justification: 'Run a local OCR Web Worker and decode/crop screenshot blobs without page-thread OCR.' });
    }
  })();
  try { await creating; } finally { creating = undefined; }
}
async function offscreen(type: string, data: object) {
  const response = await chrome.runtime.sendMessage({ target: 'offscreen', type, ...data });
  if (!response?.ok) throw new Error(response?.error || 'ocr_failed');
  return response;
}
async function abort(reason = 'stale_request') {
  const old = active; active = undefined; gate.cancel();
  if (!old) return;
  cleanup = (async () => {
    await chrome.tabs.sendMessage(old.tabId, { target: 'content', type: 'ABORT', requestId: old.requestId, session: old.session, reason }, { documentId: old.documentId }).catch(() => {});
    // Creation can still be pending when cancellation arrives. Wait before closing it.
    await creating?.catch(() => {});
    // Closing terminates workers even when Tesseract initialization is stuck.
    await chrome.offscreen.closeDocument().catch(() => {});
  })();
  await cleanup;
}
async function assertActive(request: NonNullable<typeof active>) {
  gate.check(request.requestId, request.session);
  if (active !== request || Date.now() > request.deadline) throw new Error('stale_request');
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const win = await chrome.windows.get(request.windowId);
  if (tab?.id !== request.tabId || !win.focused || tab.status === 'loading') throw new Error('stale_request');
  const check = await chrome.tabs.sendMessage(request.tabId, { target: 'content', type: 'CHECK', requestId: request.requestId, session: request.session }, { documentId: request.documentId });
  if (!check?.ok) throw new Error('target_changed');
  gate.check(request.requestId, request.session);
}
async function launchOnTab(tab: chrome.tabs.Tab | undefined, mode: string) {
  if (!tab?.id || !/^https?:/.test(tab.url || '')) throw new Error('unsupported_page');
  const injected = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  const documentId = injected.find(frame => frame.frameId === 0)?.documentId;
  if (!documentId) throw new Error('stale_request');
  const response = await chrome.tabs.sendMessage(tab.id, { target: 'content', type: 'OPEN', mode }, { documentId });
  if (!response?.ok) throw new Error('stale_request');
  return response;
}
// No action popup: the user's toolbar click immediately activates image selection.
chrome.action.onClicked.addListener(async tab => {
  try {
    await launchOnTab(tab, 'new');
    await Promise.all([
      chrome.action.setBadgeText({ tabId: tab.id, text: '' }),
      chrome.action.setTitle({ tabId: tab.id, title: '點一下選取驗證碼圖片' }),
    ]);
  } catch (error) {
    await Promise.allSettled([
      chrome.action.setBadgeText({ tabId: tab.id, text: '!' }),
      chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#a83d27' }),
      chrome.action.setTitle({ tabId: tab.id, title: errorMessage(error) }),
    ]);
  }
});
async function handle(m: any, sender: chrome.runtime.MessageSender) {
  if (m.type === 'OPTIONS') { await chrome.runtime.openOptionsPage(); return {}; }
  if (m.type === 'LAUNCH') {
    if (sender.tab || sender.url !== chrome.runtime.getURL('popup.html')) throw new Error('stale_request');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return launchOnTab(tab, m.mode);
  }
  if (m.type === 'PROGRESS' || m.type === 'CLOSE_OFFSCREEN') {
    if (sender.tab || sender.url !== chrome.runtime.getURL('offscreen.html')) throw new Error('stale_request');
    if (m.type === 'CLOSE_OFFSCREEN') { if (!active) await chrome.offscreen.closeDocument().catch(() => {}); return {}; }
    if (active?.requestId === m.requestId && active.session === m.session) await chrome.tabs.sendMessage(active.tabId, { ...m, target: 'content' }, { documentId: active.documentId }).catch(() => {});
    return {};
  }
  if (!sender.tab?.id || sender.frameId !== 0 || !sender.documentId) throw new Error('stale_request');
  if (m.type === 'BEGIN') {
    if (active) throw new Error('busy');
    await cleanup;
    gate.begin(m.requestId, m.session);
    const request = { requestId: m.requestId, session: m.session, tabId: sender.tab.id, windowId: sender.tab.windowId, documentId: sender.documentId, deadline: Date.now()+180_000, settings: settingsOf() };
    // Publish ownership before any async settings/creation work so CANCEL can always find it.
    active = request;
    try {
      request.settings = settingsOf((await chrome.storage.local.get('settings')).settings);
      await assertActive(request);
      await ensureOffscreen();
      await assertActive(request);
      await offscreen('BEGIN', request);
      await assertActive(request);
      return {};
    }
    catch (e) { if (active === request) await abort(); throw e; }
  }
  gate.check(m.requestId, m.session);
  const request = active!;
  if (request.tabId !== sender.tab.id || request.documentId !== sender.documentId) throw new Error('stale_request');
  if (m.type === 'CANCEL') { await abort(); return {}; }
  if (m.type === 'END') {
    await offscreen('END', request);
    gate.check(m.requestId, m.session);
    active = undefined; gate.cancel(); return {};
  }
  await assertActive(request);
  if (m.type === 'HEARTBEAT') return {};
  if (m.type === 'OCR') {
    const result = await offscreen('OCR', { ...request, expectedLength: m.expectedLength, characterMode: m.characterMode });
    await assertActive(request); return result;
  }
  if (m.type === 'CAPTURE') {
    if (captureBusy) throw new Error('busy');
    captureBusy = true;
    let screenshot: string | undefined;
    try {
      // captureVisibleTab is limited to two calls per second.
      await new Promise(r => setTimeout(r, Math.max(0, 550-(Date.now()-lastCapture))));
      await assertActive(request);
      lastCapture = Date.now();
      screenshot = await chrome.tabs.captureVisibleTab(request.windowId, { format: 'png' });
      await assertActive(request);
      const result = await offscreen('CROP', { ...request, screenshot, phase: m.phase, rect: m.rect, viewport: m.viewport });
      screenshot = undefined;
      await assertActive(request); return result;
    } finally { screenshot = undefined; captureBusy = false; }
  }
  throw new Error('stale_request');
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m?.target !== 'background' || sender.id !== chrome.runtime.id) return;
  void handle(m, sender).then(data => reply({ ...data, ok: true }), async error => {
    if (active?.requestId === m.requestId && active?.session === m.session && active?.tabId === sender.tab?.id && active?.documentId === sender.documentId && m.type !== 'BEGIN') await abort(error.message);
    reply({ ok: false, error: error.message || 'capture_failed' });
  });
  return true;
});
chrome.tabs.onActivated.addListener(info => { if (active && info.tabId !== active.tabId) void abort(); });
chrome.tabs.onUpdated.addListener((id, change) => { if (active?.tabId === id && (change.status === 'loading' || change.url)) void abort(); });
chrome.tabs.onRemoved.addListener(id => { if (active?.tabId === id) void abort(); });
chrome.windows.onFocusChanged.addListener(id => { if (active && id !== active.windowId) void abort(); });
