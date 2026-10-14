import { cropCoordinates, equalPixels, checkLimits, settingsOf, screenshotBlob } from './core.ts';
import type { Settings } from './core.ts';
import { LocalProvider } from './provider.ts';
import type { WorkerLike } from './provider.ts';
declare const Tesseract: { createWorker: (lang: string, mode: number, options: object) => Promise<WorkerLike> };
let current: { requestId: string; session: string; canvas?: HTMLCanvasElement; pixels?: ImageData; settings: Settings; recognizing: boolean } | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const provider = new LocalProvider(async () => {
  if (typeof Tesseract === 'undefined') throw new Error('assets_missing');
  return Tesseract.createWorker('eng', 1, {
    workerPath: chrome.runtime.getURL('vendor/worker.min.js'),
    corePath: chrome.runtime.getURL('vendor/core'), langPath: chrome.runtime.getURL('vendor/lang'),
    workerBlobURL: false, gzip: false, cacheMethod: 'none',
    logger: (info: { status: string; progress: number }) => {
      if (current) void chrome.runtime.sendMessage({ target: 'background', type: 'PROGRESS', requestId: current.requestId, session: current.session, status: info.status, progress: info.progress }).catch(() => {});
    },
  });
});
function releaseImage() {
  if (current?.canvas) { current.canvas.width = 0; current.canvas.height = 0; }
  current = undefined;
}
function idle(minutes: number) {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    await provider.dispose();
    await chrome.runtime.sendMessage({ target: 'background', type: 'CLOSE_OFFSCREEN' }).catch(() => {});
  }, minutes * 60_000);
}
async function handle(m: any) {
  if (m.type === 'BEGIN') {
    // A surviving offscreen document may outlive its service worker. Clear old state.
    if (current?.recognizing) throw new Error('busy');
    releaseImage(); clearTimeout(idleTimer);
    current = { requestId: m.requestId, session: m.session, settings: settingsOf(m.settings), recognizing: false };
    return {};
  }
  if (!current || current.requestId !== m.requestId || current.session !== m.session) throw new Error('stale_request');
  const request = current;
  if (m.type === 'END') {
    const running = request.recognizing;
    releaseImage();
    if (running) await provider.dispose();
    idle(request.settings.idleMinutes);
    return {};
  }
  if (m.type === 'CROP') {
    let bitmap: ImageBitmap | undefined, canvas: HTMLCanvasElement | undefined;
    try {
      if (typeof m.screenshot !== 'string' || !m.screenshot.startsWith('data:image/png;base64,')) throw new Error('capture_failed');
      const blob = screenshotBlob(m.screenshot);
      m.screenshot = undefined;
      bitmap = await createImageBitmap(blob);
      const r = cropCoordinates(m.rect, m.viewport, { width: bitmap.width, height: bitmap.height });
      if (r.width * r.height > request.settings.maxPixels) throw new Error('image_too_large');
      canvas = document.createElement('canvas'); canvas.width = r.width; canvas.height = r.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bitmap, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
      bitmap.close(); bitmap = undefined;
      const pixels = ctx.getImageData(0, 0, r.width, r.height);
      if (current !== request) throw new Error('stale_request');
      if (m.phase === 'A') {
        if (request.canvas) throw new Error('stale_request');
        const preview = canvas.toDataURL('image/png');
        checkLimits(Math.floor((preview.length - preview.indexOf(',') - 1) * 3/4), r.width, r.height, request.settings);
        request.canvas = canvas; request.pixels = pixels; canvas = undefined;
        return { preview, width: r.width, height: r.height };
      }
      const a = request.pixels;
      if (!a || !equalPixels(a.data, pixels.data, a.width, a.height, r.width, r.height)) throw new Error('image_changed');
      return { same: true };
    } finally {
      m.screenshot = undefined; bitmap?.close();
      if (canvas) { canvas.width = 0; canvas.height = 0; }
    }
  }
  if (m.type === 'OCR') {
    if (request.recognizing || !request.canvas) throw new Error('busy');
    request.recognizing = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        provider.recognize(request.canvas, m.expectedLength, m.characterMode),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('ocr_timeout')), request.settings.timeoutMs); }),
      ]);
      if (current !== request) throw new Error('stale_request');
      return result;
    } catch (e) { await provider.dispose(); throw e; }
    finally { clearTimeout(timer); request.recognizing = false; }
  }
  throw new Error('stale_request');
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m?.target !== 'offscreen' || sender.id !== chrome.runtime.id || sender.tab || (sender.url && sender.url !== chrome.runtime.getURL('background.js'))) return;
  void handle(m).then(data => reply({ ok: true, ...data }), error => reply({ ok: false, error: error.message || 'ocr_failed' }));
  return true;
});
