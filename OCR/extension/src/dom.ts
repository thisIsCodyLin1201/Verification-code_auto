import type { Rect, Locator } from './core.ts';
export function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}
export function sameRect(a: Rect, b: Rect): boolean {
  return ['x', 'y', 'width', 'height'].every(k => Math.abs(a[k as keyof Rect] - b[k as keyof Rect]) < 0.1);
}
export function visible(el: Element): boolean {
  const r = rectOf(el), s = getComputedStyle(el);
  const inset = Math.min(2, r.width / 4, r.height / 4);
  const points = [[r.x+r.width/2,r.y+r.height/2],[r.x+inset,r.y+inset],[r.x+r.width-inset,r.y+inset],[r.x+inset,r.y+r.height-inset],[r.x+r.width-inset,r.y+r.height-inset]];
  const uncovered = points.every(([x,y]) => {
    const top = document.elementsFromPoint(x,y).find(e => e.id !== 'local-verification-ocr');
    return top === el || !!top && el.contains(top);
  });
  return uncovered && el.isConnected && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && s.visibility === 'visible' && r.width >= 2 && r.height >= 2 && r.x >= 0 && r.y >= 0 && r.x+r.width <= innerWidth && r.y+r.height <= innerHeight;
}
export function writable(el: Element | null): el is HTMLInputElement {
  return el instanceof HTMLInputElement && ['text','tel','search'].includes(el.type) && !el.disabled && !el.readOnly && !el.matches(':disabled') && !el.closest('[inert]') && visible(el);
}
export function imageKind(el: Element): string {
  if (el instanceof HTMLImageElement) return 'img';
  if (el instanceof HTMLCanvasElement) return 'canvas';
  if (getComputedStyle(el).backgroundImage !== 'none') return 'background';
  return 'container';
}
export function imageAt(x: number, y: number, host: Element): Element | undefined {
  let el = document.elementsFromPoint(x, y).find(e => e !== host);
  for (let i = 0; el && i < 4; i++, el = el.parentElement || undefined) if (imageKind(el) !== 'container' && visible(el)) return el;
}
export function locatorFor(el: Element, kind: string): Locator | undefined {
  const unique = (selector: string) => {
    try { const hits = document.querySelectorAll(selector); return hits.length === 1 && hits[0] === el; } catch { return false; }
  };
  // Never derive a selector from field values, text, src, URLs, or positional nth-child guesses.
  const own = (e: Element): string[] => {
    const out: string[] = [], tag = e.tagName.toLowerCase();
    for (const attr of ['id', 'data-testid', 'name']) {
      const value = e.getAttribute(attr);
      if (value && value.length <= 80 && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value)) out.push(`${tag}[${attr}="${value}"]`);
    }
    return out;
  };
  const tag = el.tagName.toLowerCase();
  for (const s of own(el)) if (unique(s)) return { selector: s, tag, kind };
  let parent = el.parentElement, chain = tag;
  for (let i = 0; parent && i < 3; i++, parent = parent.parentElement) {
    for (const s of own(parent)) if (unique(`${s} > ${chain}`)) return { selector: `${s} > ${chain}`, tag, kind };
    chain = `${parent.tagName.toLowerCase()} > ${chain}`;
  }
}
export function resolveLocator(locator: Locator): Element {
  let hits: NodeListOf<Element>;
  try { hits = document.querySelectorAll(locator.selector); } catch { throw new Error('profile_invalid'); }
  if (hits.length !== 1 || hits[0].tagName.toLowerCase() !== locator.tag) throw new Error('profile_invalid');
  const el = hits[0];
  if (locator.kind === 'field' ? !writable(el) : imageKind(el) !== locator.kind || !visible(el)) throw new Error('profile_invalid');
  return el;
}
export function fieldState(el: HTMLInputElement, includeValue = true): string {
  return JSON.stringify([el.type, el.disabled, el.readOnly, el.maxLength, el.pattern, includeValue ? el.value : null, el.getAttribute('aria-disabled'), el.matches(':disabled'), !!el.closest('[inert]')]);
}
export async function setField(el: HTMLInputElement, value: string, guard: () => void): Promise<void> {
  guard();
  if (!writable(el)) throw new Error('unsupported_field');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('fill_failed');
  setter.call(el, value);
  el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: value }));
  guard();
  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  await new Promise(r => setTimeout(r, 80));
  guard();
  if (el.value !== value || !el.checkValidity()) throw new Error('fill_failed');
}
