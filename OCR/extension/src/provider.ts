import type { CharacterMode } from './core.ts';
import { validCode, characterModeOf, recognitionWhitelist } from './core.ts';
export type OcrResult = { text: string; engine: string; status: 'review' | 'ok'; latencyMs: number; warnings: string[] };
export interface OcrProvider { recognize(image: HTMLCanvasElement, expectedLength?: number, characterMode?: CharacterMode): Promise<OcrResult>; dispose(): Promise<void> }
export type WorkerLike = { setParameters: (p: Record<string,string>) => Promise<unknown>; recognize: (image: HTMLCanvasElement) => Promise<{ data: { text: string; confidence: number } }>; terminate: () => Promise<unknown> };
export class LocalProvider implements OcrProvider {
  worker?: WorkerLike;
  initializing?: Promise<WorkerLike>;
  generation = 0;
  busy = false;
  factory: () => Promise<WorkerLike>;
  constructor(factory: () => Promise<WorkerLike>) { this.factory = factory; }
  async getWorker(): Promise<WorkerLike> {
    if (this.worker) return this.worker;
    if (!this.initializing) {
      const epoch = this.generation;
      this.initializing = this.factory().then(async worker => {
        if (epoch !== this.generation) { await worker.terminate(); throw new Error('stale_request'); }
        this.worker = worker;
        await worker.setParameters({ tessedit_pageseg_mode: '7', user_defined_dpi: '300' });
        return worker;
      }).catch(async e => {
        if (epoch === this.generation) {
          const failed = this.worker;
          this.worker = undefined; this.initializing = undefined;
          if (failed) await failed.terminate().catch(() => {});
        }
        throw e;
      });
    }
    return this.initializing;
  }
  async recognize(image: HTMLCanvasElement, expectedLength?: number, characterMode: CharacterMode = 'alphanumeric'): Promise<OcrResult> {
    const mode = characterModeOf(characterMode);
    if (this.busy) throw new Error('busy');
    this.busy = true;
    const epoch = this.generation, start = performance.now();
    try {
      const worker = await this.getWorker();
      if (epoch !== this.generation) throw new Error('stale_request');
      // A reused worker must receive the current request's alphabet every time.
      await worker.setParameters({ tessedit_char_whitelist: recognitionWhitelist(mode) });
      const results: { text: string; confidence: number }[] = [];
      // Fixed, bounded experiments. No length guessing, padding, or character substitution.
      for (const mode of ['original','upscale','gray']) {
        if (epoch !== this.generation) throw new Error('stale_request');
        let canvas = image;
        if (mode !== 'original') {
          canvas = document.createElement('canvas');
          const scale = Math.min(3, Math.max(1, Math.sqrt(2_000_000 / (image.width * image.height))));
          canvas.width = Math.floor(image.width * scale); canvas.height = Math.floor(image.height * scale);
          const ctx = canvas.getContext('2d')!;
          ctx.filter = mode === 'gray' ? 'grayscale(1)' : 'none';
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        }
        try {
          const { data } = await worker.recognize(canvas);
          results.push({ text: data.text.trim().replace(/\s/g, ''), confidence: data.confidence });
        } finally { if (canvas !== image) { canvas.width = 0; canvas.height = 0; } }
      }
      if (epoch !== this.generation) throw new Error('stale_request');
      const valid = results.filter(r => validCode(r.text, expectedLength, mode));
      const candidate = valid[0]?.text || results[0]?.text || '';
      const agreed = valid.length === 3 && valid.every(r => r.text === candidate && r.confidence >= 70);
      return { text: candidate, engine: 'tesseract.js-local/tessdata_best-eng', status: agreed ? 'ok' : 'review', latencyMs: performance.now()-start, warnings: agreed ? [] : ['辨識版本不一致、內容無效或品質不足，請人工修正。'] };
    } finally { if (epoch === this.generation) this.busy = false; }
  }
  async dispose(): Promise<void> {
    this.generation++;
    const worker = this.worker;
    this.worker = undefined; this.initializing = undefined; this.busy = false;
    if (worker) await worker.terminate();
  }
}
