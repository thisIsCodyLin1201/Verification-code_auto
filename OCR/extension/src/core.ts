export type Rect = { x: number; y: number; width: number; height: number };
export type Viewport = { width: number; height: number };
export type Settings = { idleMinutes: number; maxBytes: number; maxPixels: number; timeoutMs: number };
export const defaults: Settings = { idleMinutes: 5, maxBytes: 1_048_576, maxPixels: 2_000_000, timeoutMs: 60_000 };
export function settingsOf(raw: Partial<Settings> = {}): Settings {
  const bounded = (v: unknown, fallback: number, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
  return { idleMinutes: bounded(raw.idleMinutes, 5, 1, 30), maxBytes: bounded(raw.maxBytes, defaults.maxBytes, 1024, 8_388_608), maxPixels: bounded(raw.maxPixels, defaults.maxPixels, 1000, 8_000_000), timeoutMs: bounded(raw.timeoutMs, 60_000, 1000, 120_000) };
}
export function normalizedRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2-x1), height: Math.abs(y2-y1) };
}
export function cropCoordinates(rect: Rect, viewport: Viewport, bitmap: Viewport): Rect {
  const nums = [...Object.values(rect), ...Object.values(viewport), ...Object.values(bitmap)];
  if (!nums.every(Number.isFinite) || viewport.width <= 0 || viewport.height <= 0 || bitmap.width <= 0 || bitmap.height <= 0 || rect.width < 2 || rect.height < 2 || rect.x < 0 || rect.y < 0 || rect.x + rect.width > viewport.width + 0.01 || rect.y + rect.height > viewport.height + 0.01) throw new Error('invalid_crop');
  const sx = bitmap.width / viewport.width, sy = bitmap.height / viewport.height;
  const x = Math.floor(rect.x * sx), y = Math.floor(rect.y * sy);
  return { x, y, width: Math.min(bitmap.width, Math.ceil((rect.x + rect.width) * sx)) - x, height: Math.min(bitmap.height, Math.ceil((rect.y + rect.height) * sy)) - y };
}
export function equalPixels(a: Uint8ClampedArray, b: Uint8ClampedArray, aw: number, ah: number, bw: number, bh: number): boolean {
  return aw === bw && ah === bh && a.length === b.length && a.every((v, i) => v === b[i]);
}
export type CharacterMode = 'alphanumeric' | 'digits';
export function characterModeOf(value: unknown = 'alphanumeric'): CharacterMode {
  if (value === 'alphanumeric' || value === 'digits') return value;
  throw new Error('invalid_character_mode');
}
export function recognitionWhitelist(mode: CharacterMode): string {
  return characterModeOf(mode) === 'digits' ? '0123456789' : '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
}
export function validCode(text: string, expectedLength?: number, mode: CharacterMode = 'alphanumeric'): boolean {
  const allowed = recognitionWhitelist(mode);
  return text.length > 0 && text.length <= 64 && [...text].every(c => allowed.includes(c)) && (expectedLength === undefined || text.length === expectedLength);
}
export function validDigits(text: string, expectedLength?: number): boolean {
  return validCode(text, expectedLength, 'digits');
}
export function expectedLengthOf(value: string): number | undefined {
  if (!value.trim()) return undefined;
  if (!/^\d+$/.test(value) || +value < 1 || +value > 64) throw new Error('invalid_length');
  return +value;
}
export function checkLimits(bytes: number, width: number, height: number, settings: Settings): void {
  if (![bytes, width, height].every(Number.isFinite) || bytes < 1 || width < 1 || height < 1 || bytes > settings.maxBytes || width * height > settings.maxPixels) throw new Error('image_too_large');
}
export type Locator = { selector: string; tag: string; kind: string };
export type ImageLocator = { locator: Locator; region?: Rect };
export type Profile = { schemaVersion: 1; profileId: string; origin: string; pathname: string; image: ImageLocator; field: Locator; expectedLength?: number; characterMode?: CharacterMode; preview: boolean };
export function pageKey(url: string): { origin: string; pathname: string } {
  const u = new URL(url);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('unsupported_page');
  return { origin: u.origin, pathname: u.pathname };
}
export function matchingProfiles(profiles: Profile[], url: string): Profile[] {
  const key = pageKey(url);
  return profiles.filter(p => p.schemaVersion === 1 && p.origin === key.origin && p.pathname === key.pathname);
}
export class RequestGate {
  current?: { requestId: string; session: string };
  begin(requestId: string, session: string): void {
    if (this.current) throw new Error('busy');
    this.current = { requestId, session };
  }
  check(requestId: string, session: string): void {
    if (this.current?.requestId !== requestId || this.current.session !== session) throw new Error('stale_request');
  }
  cancel(): void { this.current = undefined; }
}
export const messages: Record<string, string> = {
  pinch_zoom: '請先重設觸控手勢縮放，再重新選取；一般 Chrome 頁面縮放可用。',
  busy: '已有操作進行中，請先取消。', stale_request: '操作已失效，請重新辨識。', invalid_crop: '請選取完整可見、至少 2 × 2 像素的圖片。',
  image_too_large: '裁切圖片超過大小限制，請縮小範圍或調整設定。', invalid_length: '字元長度請留空或填入 1–64。',
  image_changed: '驗證碼已更新，請重新辨識。', target_changed: '圖片、欄位或頁面位置已變更，請重新配對或辨識。',
  unsupported_field: '僅支援可見、可寫的 text／tel／search 欄位。', fill_failed: '網站未保留填入值，請手動輸入。',
  invalid_character_mode: '請選擇英文＋數字或純數字模式。',
  invalid_result: '結果不符合所選字元種類或長度，請修正。', profile_invalid: '設定無效或匹配不唯一，請重新配對。',
  ocr_timeout: '本機 OCR 逾時，已終止引擎；請重試。', ocr_failed: '本機 OCR 失敗，請重試或手動輸入。',
  assets_missing: '缺少本機 OCR 資源。請執行 npm run assets 與 npm run build，再重新載入擴充功能。',
  capture_failed: '無法擷取目前分頁。請回到網頁並由工具列重新啟動。', unsupported_page: '請在一般 HTTP／HTTPS 網頁使用。',
};
export function errorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  return messages[code] || '操作失敗，請重新啟動；若持續失敗，請查看擴充功能錯誤。';
}

// Screenshot bytes are decoded directly: fetch(data:) would violate connect-src 'self'.
export function screenshotBlob(data: string): Blob {
  const prefix = 'data:image/png;base64,';
  if (typeof data !== 'string' || !data.startsWith(prefix)) throw new Error('capture_failed');
  let binary: string;
  try { binary = atob(data.slice(prefix.length)); } catch { throw new Error('capture_failed'); }
  if (!binary.length) throw new Error('capture_failed');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}
