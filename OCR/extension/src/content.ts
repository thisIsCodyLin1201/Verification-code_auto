import { defaults, validCode, characterModeOf, expectedLengthOf, pageKey, matchingProfiles, normalizedRect, errorMessage } from './core.ts';
import type { Rect, Profile, ImageLocator, CharacterMode } from './core.ts';
import { rectOf, sameRect, visible, writable, imageAt, imageKind, locatorFor, resolveLocator, fieldState, setField } from './dom.ts';

// One isolated-world instance per document, including repeated toolbar invocations.
const marker = '__localVerificationOcrV1';
if (!(globalThis as any)[marker]) {
  (globalThis as any)[marker] = true;
  initialize();
}
function initialize() {
  const session = crypto.randomUUID();
  const host = document.createElement('div');
  host.id = 'local-verification-ocr';
  host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    :host{color-scheme:light}*{box-sizing:border-box} [hidden]{display:none!important}
    #panel{position:fixed;right:20px;top:20px;width:330px;max-height:calc(100vh - 40px);overflow:auto;pointer-events:auto;background:#fff;color:#172d36;border:1px solid #cad9dc;border-radius:18px;box-shadow:0 12px 50px #122e3933;padding:20px;font:14px/1.55 system-ui,sans-serif}
    h2{font-size:18px;margin:0 0 4px}p{margin:8px 0}small{color:#5b727b}button,input,select{font:inherit}button{border:1px solid #c7d7db;background:#f4f8f8;color:#143c45;border-radius:8px;padding:8px 11px;cursor:pointer}button:hover{background:#e4f1ef}button:disabled{opacity:.45;cursor:default}.primary{background:#136e64;color:white;border-color:#136e64}.row{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0}input:not([type=checkbox]),select{width:100%;padding:8px;border:1px solid #a9bec4;border-radius:7px;background:white;color:#172d36}label{display:block;margin:10px 0}#result{font-size:24px;letter-spacing:4px}#status{background:#edf5f4;padding:10px;border-radius:9px;overflow-wrap:anywhere}#preview{display:block;max-width:100%;max-height:130px;object-fit:contain;border:1px solid #cbd9dd;margin:12px auto}#overlay{position:fixed;inset:0;pointer-events:auto;cursor:crosshair;background:#083d4c0c}#highlight{position:fixed;border:3px solid #168577;background:#37baaa15;pointer-events:none}#selectionTools{position:fixed;bottom:82px;left:50%;transform:translateX(-50%);display:flex;gap:8px;pointer-events:auto;background:white;padding:9px;border:1px solid #cad9dc;border-radius:12px;font:14px system-ui}#hint{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:12px 20px;background:#123c45;color:white;border-radius:10px;font:15px system-ui;pointer-events:none}
  </style><div id="overlay" hidden></div><div id="highlight" hidden></div><div id="hint" hidden></div><div id="selectionTools" hidden><button id="selectionRegion">改用框選</button><button id="selectionSaved">已存設定／面板</button><button id="selectionCancel">取消</button></div>
  <section id="panel" hidden aria-label="本機英數 OCR"><h2>驗證碼圖片助手</h2><small>本機辨識 · 圖片不離開裝置 · 不提交表單</small>
  <p id="status" role="status" aria-live="polite">請先配對圖片與輸入欄。</p>
  <div class="row"><button id="pick">點選圖片</button><button id="region">框選區域</button><button id="field">選取欄位</button></div>
  <select id="profiles" aria-label="此頁設定" hidden></select><button id="confirmRegion" hidden>確認保存的框選範圍</button>
  <label>辨識字元<select id="characterMode"><option value="alphanumeric">英文＋數字（大小寫）</option><option value="digits">純數字</option></select></label>
  <label>字元長度（選填）<input id="length" inputmode="numeric" maxlength="2" placeholder="不限制"></label>
  <label><input id="preferPreview" type="checkbox" checked> 預設先預覽</label>
  <div class="row"><button id="save">記住此頁設定</button><button id="delete">刪除此頁設定</button></div>
  <div class="row"><button id="run" class="primary">辨識並填入</button><button id="review">先預覽</button></div>
  <img id="preview" hidden alt="本次裁切圖片"><div id="editor" hidden><label>辨識結果（可修正）<input id="result" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="64"></label><button id="fill" class="primary">檢查圖片並填入</button></div>
  <div class="row"><button id="cancel">取消／關閉</button><button id="options">管理設定</button></div></section>`;
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => shadow.getElementById(id) as T;
  const panel = $('panel'), overlay = $('overlay'), highlight = $('highlight'), hint = $('hint'), selectionTools = $('selectionTools');
  let selection: 'image' | 'region' | 'field' | undefined;
  let drag: { x: number; y: number } | undefined;
  let selectedImage: { element?: Element; rect?: Rect; descriptor?: ImageLocator; confirmed: boolean } | undefined;
  let field: HTMLInputElement | undefined;
  let pairedHref = location.href;
  let profiles: Profile[] = [];
  let pairingId: string | undefined;
  let selectionEpoch = 0;
  let request: { id: string; image: Element | undefined; field: HTMLInputElement; crop: Rect; imageRect?: Rect; fieldRect: Rect; state: string; attributes: string; href: string; x: number; y: number; width: number; height: number; expectedLength?: number; characterMode: CharacterMode; writing: boolean; timer?: ReturnType<typeof setInterval>; deadline?: ReturnType<typeof setTimeout> } | undefined;
  const status = (text: string) => { $('status').textContent = text; };
  const rpc = async (type: string, data: object = {}, id = request?.id) => {
    const response = await chrome.runtime.sendMessage({ target: 'background', type, session, requestId: id, ...data });
    if (!response?.ok) throw new Error(response?.error || 'stale_request');
    return response;
  };
  const show = () => { if (!host.isConnected) document.documentElement.append(host); panel.hidden = false; };
  function cleanPreview() { const img = $<HTMLImageElement>('preview'); img.removeAttribute('src'); img.hidden = true; $('editor').hidden = true; $<HTMLInputElement>('result').value = ''; }
  function finishSelection() { selection = undefined; drag = undefined; overlay.hidden = highlight.hidden = hint.hidden = selectionTools.hidden = true; panel.hidden = false; }
  function controls(busy: boolean) {
    for (const id of ['pick','region','field','save','delete','run','review','length','characterMode','preferPreview','profiles','confirmRegion']) ($<HTMLButtonElement>(id)).disabled = busy;
  }
  function cancel(reason?: string) {
    selectionEpoch++;
    const old = request; request = undefined;
    if (old) { clearInterval(old.timer); clearTimeout(old.deadline); void rpc('CANCEL', {}, old.id).catch(() => {}); }
    host.style.setProperty('visibility', 'visible', 'important');
    finishSelection(); cleanPreview(); controls(false);
    if (!reason) { selectedImage = undefined; field = undefined; }
    if (reason) { show(); status(reason); } else { panel.hidden = true; }
  }
  function cropRect(): Rect {
    if (window.visualViewport && (Math.abs(window.visualViewport.scale - 1) > 0.01 || window.visualViewport.offsetLeft || window.visualViewport.offsetTop)) throw new Error('pinch_zoom');
    if (!selectedImage || !selectedImage.confirmed || pairedHref !== location.href) throw new Error('profile_invalid');
    if (!selectedImage.element) return selectedImage.rect!;
    if (!visible(selectedImage.element)) throw new Error('target_changed');
    const r = rectOf(selectedImage.element), region = selectedImage.descriptor?.region;
    return region ? { x: r.x+region.x*r.width, y: r.y+region.y*r.height, width: region.width*r.width, height: region.height*r.height } : r;
  }
  function check(id = request?.id) {
    const r = request;
    if (!r || r.id !== id || location.href !== r.href || document.hidden || scrollX !== r.x || scrollY !== r.y || innerWidth !== r.width || innerHeight !== r.height) throw new Error('stale_request');
    if (field !== r.field || !writable(r.field) || !sameRect(rectOf(r.field), r.fieldRect) || (r.writing ? fieldState(r.field, false) !== r.attributes : fieldState(r.field) !== r.state)) throw new Error('target_changed');
    if (r.image && (!r.image.isConnected || selectedImage?.element !== r.image || !visible(r.image) || !sameRect(rectOf(r.image), r.imageRect!))) throw new Error('target_changed');
    if (!sameRect(cropRect(), r.crop)) throw new Error('target_changed');
    const descriptor = selectedImage?.descriptor;
    if (descriptor && resolveLocator(descriptor.locator) !== r.image) throw new Error('target_changed');
  }
  async function capture(phase: 'A' | 'B', id: string) {
    check(id);
    host.style.setProperty('visibility', 'hidden', 'important');
    try {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      check(id);
      const result = await rpc('CAPTURE', { phase, rect: request!.crop, viewport: { width: innerWidth, height: innerHeight } }, id);
      check(id); return result;
    } finally { if (!request || request.id === id) host.style.setProperty('visibility', 'visible', 'important'); }
  }
  async function fillResult(id: string) {
    check(id);
    const text = $<HTMLInputElement>('result').value.trim();
    if (!validCode(text, request!.expectedLength, request!.characterMode)) { status(errorMessage(new Error('invalid_result'))); return; }
    $<HTMLButtonElement>('fill').disabled = true;
    try {
      status('正在重新擷取圖片，檢查有無更新…');
      await capture('B', id); check(id);
      // No asynchronous work between this final guard and native setter.
      request!.writing = true;
      await setField(request!.field, text, () => check(id));
      check(id);
      await rpc('END', {}, id);
      check(id);
      const done = request; request = undefined;
      clearInterval(done?.timer); clearTimeout(done?.deadline);
      cleanPreview(); controls(false); status('已填入。請自行確認並提交網頁。');
    } catch (e) { if (request?.id === id) cancel(errorMessage(e)); }
    finally { $<HTMLButtonElement>('fill').disabled = false; }
  }
  async function run(preview: boolean) {
    if (request) return;
    cleanPreview();
    let id: string | undefined;
    try {
      if (!writable(field || null)) throw new Error('unsupported_field');
      const crop = cropRect();
      const expectedLength = expectedLengthOf($<HTMLInputElement>('length').value);
      const characterMode = characterModeOf($<HTMLSelectElement>('characterMode').value);
      id = crypto.randomUUID();
      request = { id, image: selectedImage?.element, field: field!, crop, imageRect: selectedImage?.element ? rectOf(selectedImage.element) : undefined, fieldRect: rectOf(field!), state: fieldState(field!), attributes: fieldState(field!, false), href: location.href, x: scrollX, y: scrollY, width: innerWidth, height: innerHeight, expectedLength, characterMode, writing: false };
      controls(true); status('正在擷取目前圖片…');
      request.timer = setInterval(() => { try { check(id); } catch (e) { if (request?.id === id) cancel(errorMessage(e)); } }, 100);
      request.deadline = setTimeout(() => { if (request?.id === id) cancel('操作超過 3 分鐘，暫存已清除，請重新辨識。'); }, 180_000);
      await rpc('BEGIN', {}, id); check(id);
      const image = await capture('A', id);
      const img = $<HTMLImageElement>('preview'); img.src = image.preview; img.hidden = false;
      status('本機 OCR 引擎初始化／辨識中…');
      const result = await rpc('OCR', { expectedLength, characterMode }, id); check(id);
      $<HTMLInputElement>('result').value = result.text;
      $('editor').hidden = false;
      if (preview || result.status !== 'ok' || !validCode(result.text, expectedLength, characterMode)) {
        status(result.warnings?.length ? result.warnings.join(' ') : '請確認或修正結果；填入前會再次檢查圖片。');
      } else await fillResult(id);
    } catch (e) { if (!id || request?.id === id) cancel(errorMessage(e)); }
  }
  function paint(r: Rect) { highlight.hidden = false; highlight.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px`; }
  function startSelection(mode: 'image' | 'region' | 'field') {
    if (request) return;
    show(); cleanPreview(); $('confirmRegion').hidden = true; selection = mode; drag = undefined; selectionEpoch++;
    if (mode !== 'field') { selectedImage = undefined; field = undefined; pairingId = undefined; }
    panel.hidden = true; overlay.hidden = hint.hidden = selectionTools.hidden = false; highlight.hidden = true;
    hint.textContent = mode === 'image' ? '點選圖片（不觸發網站點擊）· Esc 取消' : mode === 'region' ? '拖曳框選圖片 · Esc 取消' : '點選可寫入的文字欄位 · Esc 取消';
  }
  function fieldAt(x: number, y: number) { const top = document.elementsFromPoint(x,y).find(el => el !== host); return top && writable(top) ? top : undefined; }
  function regionSelection(r: Rect) {
    if (r.width < 2 || r.height < 2) throw new Error('invalid_crop');
    const candidates = document.elementsFromPoint(r.x+r.width/2,r.y+r.height/2).filter(el => el !== host && el !== document.body && el !== document.documentElement);
    for (const el of candidates) {
      const b = rectOf(el), locator = locatorFor(el, imageKind(el));
      if (locator && visible(el) && b.x <= r.x && b.y <= r.y && b.x+b.width >= r.x+r.width && b.y+b.height >= r.y+r.height) {
        selectedImage = { element: el, confirmed: true, descriptor: { locator, region: { x: (r.x-b.x)/b.width, y: (r.y-b.y)/b.height, width: r.width/b.width, height: r.height/b.height } } }; return;
      }
    }
    selectedImage = { rect: r, confirmed: true };
  }
  // Window capture guards stop propagation before website target handlers; the overlay is the event target.
  // A website's previously registered window-capture handlers may still observe selection (documented limitation).
  for (const type of ['pointerdown','pointerup','pointermove','mousedown','mouseup','click','dblclick','contextmenu']) {
    window.addEventListener(type, event => {
      if (!selection || !event.composedPath().includes(host) || event.composedPath().includes(selectionTools)) return;
      const e = event as MouseEvent;
      e.preventDefault(); e.stopImmediatePropagation();
      try {
        if (type === 'pointermove') {
          if (selection === 'region' && drag) paint(normalizedRect(drag.x,drag.y,e.clientX,e.clientY));
          else { const el = selection === 'field' ? fieldAt(e.clientX,e.clientY) : imageAt(e.clientX,e.clientY,host); if (el) paint(rectOf(el)); else highlight.hidden = true; }
        }
        if (type === 'pointerdown' && selection === 'region') drag = { x: e.clientX, y: e.clientY };
        // Finish on click, after both pointerup and mouseup have been swallowed.
        if (type === 'click') {
          if (selection === 'field') {
            const target = fieldAt(e.clientX,e.clientY);
            if (!target) { hint.textContent = errorMessage(new Error('unsupported_field')); return; }
            field = target; pairedHref = location.href; finishSelection();
            status(selectedImage?.descriptor ? '配對完成。可記住設定，或開始辨識。' : '配對完成。此框選／圖片沒有穩定定位，僅供本次使用。');
          } else {
            if (selection === 'image') {
              const el = imageAt(e.clientX,e.clientY,host);
              if (!el) { hint.textContent = '未找到完整可見圖片。Esc 後可改用框選。'; return; }
              const locator = locatorFor(el, imageKind(el));
              selectedImage = { element: el, confirmed: true, descriptor: locator ? { locator } : undefined };
            } else if (drag) regionSelection(normalizedRect(drag.x,drag.y,e.clientX,e.clientY)); else return;
            pairedHref = location.href;
            finishSelection();
            // Delay prevents this selection click from becoming a field selection.
            const epoch = selectionEpoch;
            setTimeout(() => { if (selectionEpoch === epoch && selectedImage && !selection && !panel.hidden) startSelection('field'); }, 0);
          }
        }
      } catch (e) { finishSelection(); status(errorMessage(e)); }
    }, true);
  }
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && host.isConnected && (!panel.hidden || selection || request)) { e.preventDefault(); e.stopImmediatePropagation(); cancel(); } }, true);
  const changed = () => {
    if (request) cancel(errorMessage(new Error('target_changed')));
    else if (selection || selectedImage?.rect) { selectedImage = undefined; field = undefined; cancel('頁面位置已變更，請重新選取。'); }
  };
  window.addEventListener('scroll', e => { if (!e.composedPath().includes(host)) changed(); }, true);
  window.addEventListener('resize', changed);
  window.visualViewport?.addEventListener('resize', changed);
  window.visualViewport?.addEventListener('scroll', changed);
  window.addEventListener('pagehide', () => cancel());
  document.addEventListener('visibilitychange', () => { if (document.hidden && request) cancel(errorMessage(new Error('stale_request'))); });
  new MutationObserver(() => { if (request) { try { check(); } catch (e) { cancel(errorMessage(e)); } } }).observe(document.documentElement, { childList: true, attributes: true, subtree: true });
  setInterval(() => {
    const id = request?.id;
    if (id) void rpc('HEARTBEAT', {}, id).catch(e => { if (request?.id === id) cancel(errorMessage(e)); });
  }, 15_000);
  async function loadProfile(p: Profile) {
    try {
      selectedImage = { element: resolveLocator(p.image.locator), descriptor: p.image, confirmed: !p.image.region };
      field = resolveLocator(p.field) as HTMLInputElement; pairedHref = location.href; pairingId = p.profileId;
      $<HTMLInputElement>('length').value = p.expectedLength?.toString() || '';
      $<HTMLSelectElement>('characterMode').value = characterModeOf(p.characterMode);
      $<HTMLInputElement>('preferPreview').checked = p.preview;
      $('confirmRegion').hidden = !p.image.region;
      if (p.image.region) {
        selectedImage.confirmed = true; paint(cropRect()); selectedImage.confirmed = false;
        status('已載入容器內比例框選。請確認綠框範圍後再辨識。');
      } else status('已載入此頁配對，可以開始辨識。');
    } catch (e) { selectedImage = undefined; field = undefined; status(errorMessage(e)); }
  }
  async function open(mode: string) {
    show();
    if (request) { status('目前操作尚未結束，請先完成或取消。'); return; }
    if (mode === 'new') { startSelection('image'); return; }
    const all = (await chrome.storage.local.get('profiles')).profiles || [];
    profiles = matchingProfiles(all, location.href);
    const menu = $<HTMLSelectElement>('profiles'); menu.replaceChildren(); menu.hidden = profiles.length < 2;
    if (profiles.length > 1) {
      selectedImage = undefined; field = undefined;
      menu.add(new Option('選擇此頁設定', ''));
      profiles.forEach((p,i) => menu.add(new Option(`設定 ${i+1} · ${p.image.locator.selector}`, p.profileId)));
      status('此頁有多個設定，請明確選擇。'); return;
    }
    if (profiles.length === 1) await loadProfile(profiles[0]);
    if (!selectedImage || !field) { status('請先點選或框選圖片，再選取輸入欄。'); return; }
    if (mode === 'run' && selectedImage.confirmed) await run(profiles[0]?.preview ?? true);
    if (mode === 'preview' && selectedImage.confirmed) await run(true);
  }
  // Selection tools remain clickable above the overlay without reaching website handlers.
  for (const type of ['pointerdown','pointerup','mousedown','mouseup','click','dblclick','contextmenu']) selectionTools.addEventListener(type, e => e.stopPropagation());
  $('selectionRegion').onclick = () => startSelection('region');
  $('selectionSaved').onclick = () => { finishSelection(); void open('saved').catch(e => status(errorMessage(e))); };
  $('selectionCancel').onclick = () => cancel();
  $('pick').onclick = () => startSelection('image');
  $('region').onclick = () => startSelection('region');
  $('field').onclick = () => startSelection('field');
  $('run').onclick = () => void run(false);
  $('review').onclick = () => void run(true);
  $('fill').onclick = () => { if (request) void fillResult(request.id); };
  $('cancel').onclick = () => cancel();
  $('options').onclick = () => { cancel(); void chrome.runtime.sendMessage({ target: 'background', type: 'OPTIONS' }); };
  $('confirmRegion').onclick = () => { if (selectedImage) selectedImage.confirmed = true; highlight.hidden = true; $('confirmRegion').hidden = true; status('框選已確認，可以開始辨識。'); };
  $('profiles').onchange = () => { const p = profiles.find(p => p.profileId === $<HTMLSelectElement>('profiles').value); if (p) void loadProfile(p); };
  $('save').onclick = async () => {
    try {
      if (!selectedImage?.descriptor || !field || !writable(field)) throw new Error('profile_invalid');
      const locator = locatorFor(field, 'field'); if (!locator) throw new Error('profile_invalid');
      if (resolveLocator(selectedImage.descriptor.locator) !== selectedImage.element || resolveLocator(locator) !== field) throw new Error('profile_invalid');
      const key = pageKey(location.href), expectedLength = expectedLengthOf($<HTMLInputElement>('length').value);
      const p: Profile = { schemaVersion: 1, profileId: pairingId || crypto.randomUUID(), ...key, image: selectedImage.descriptor, field: locator, expectedLength, characterMode: characterModeOf($<HTMLSelectElement>('characterMode').value), preview: $<HTMLInputElement>('preferPreview').checked };
      const all: Profile[] = (await chrome.storage.local.get('profiles')).profiles || [];
      await chrome.storage.local.set({ profiles: [...all.filter(q => q.profileId !== p.profileId), p] });
      pairingId = p.profileId; status('已記住 origin＋精確路徑與元素設定，不含圖片或辨識記錄。');
    } catch (e) { status(errorMessage(e)); }
  };
  $('delete').onclick = async () => {
    const all: Profile[] = (await chrome.storage.local.get('profiles')).profiles || [], key = pageKey(location.href);
    await chrome.storage.local.set({ profiles: all.filter(p => p.origin !== key.origin || p.pathname !== key.pathname) });
    profiles = []; pairingId = undefined; $('profiles').hidden = true; status('已刪除此頁所有設定。');
  };
  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (m?.target !== 'content' || sender.id !== chrome.runtime.id) return;
    if (m.type === 'OPEN') { void open(m.mode).catch(e => status(errorMessage(e))); reply({ ok: true }); return; }
    if (m.session !== session || m.requestId !== request?.id) { reply({ ok: false }); return; }
    if (m.type === 'CHECK') { try { check(m.requestId); reply({ ok: true }); } catch { reply({ ok: false }); } }
    if (m.type === 'ABORT') cancel(errorMessage(new Error(m.reason)));
    if (m.type === 'PROGRESS') status(/recognizing/i.test(m.status) ? `本機辨識中… ${Math.round((m.progress || 0)*100)}%` : '本機 OCR 引擎初始化中…');
  });
}
