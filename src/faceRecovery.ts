import type { RawFace } from "./tracker";

type Input = HTMLVideoElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas;
type Crop = { x: number; y: number; size: number };
type Detect = (input: Input, timestamp: number) => RawFace[];

/** Fallback for small faces under strongly colored venue lighting.
 * Only inference is cropped/desaturated; the preview and pose input stay intact.
 */
export class FaceRecovery {
  private canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private crop: Crop | null = null;
  private nextTile = 0;
  private lastSearch = -Infinity;
  private lastFull = -Infinity;
  private lastTimestamp = -Infinity;
  private width = 0;
  private height = 0;
  mode = "full";

  reset(): void {
    this.crop = null;
    this.nextTile = 0;
    this.lastSearch = this.lastFull = -Infinity;
    this.mode = "full";
  }

  run(input: Input, now: number, detect: Detect): RawFace[] {
    const width = "videoWidth" in input ? input.videoWidth : input.width;
    const height = "videoHeight" in input ? input.videoHeight : input.height;
    if (!width || !height) return [];
    if (width !== this.width || height !== this.height) {
      this.reset(); this.width = width; this.height = height;
    }
    const infer = (image: Input) => {
      // VIDEO mode requires increasing timestamps, including fallback passes.
      this.lastTimestamp = Math.max(now, this.lastTimestamp + 0.1);
      return detect(image, this.lastTimestamp);
    };
    let checkedFull = false;
    let fullFaces: RawFace[] = [];
    if (!this.crop || now - this.lastFull >= 1000) {
      fullFaces = infer(input);
      this.lastFull = now;
      checkedFull = true;
      if (fullFaces.length && !this.crop) {
        this.mode = "full";
        return fullFaces;
      }
    }
    if (this.crop) {
      const faces = this.scan(input, this.crop, infer);
      if (faces.length) {
        // A full-frame face may be a bystander, not the recovered visitor.
        // Leave target selection to SignalProcessor with both current results.
        if (fullFaces.length && faces.every(f => fullFaces.some(g => sameFaceBox(f, g)))) {
          this.crop = null; this.mode = "full";
          return fullFaces;
        }
        return [...faces, ...fullFaces.filter(f => !faces.some(g => sameFaceBox(f, g)))];
      }
      this.crop = null;
      if (fullFaces.length) { this.mode = "full"; return fullFaces; }
      if (!checkedFull) {
        const faces = infer(input);
        this.lastFull = now;
        if (faces.length) { this.mode = "full"; return faces; }
      }
    }
    this.mode = "search";
    if (now - this.lastSearch < 250) return [];
    this.lastSearch = now;
    const size = Math.min(width, height);
    // Center, then both ends: recover across landscape and portrait sources.
    const offset = [0.5, 0, 1][this.nextTile++ % 3];
    const crop = { x: (width - size) * offset, y: (height - size) * offset, size };
    const faces = this.scan(input, crop, infer);
    if (faces.length) this.crop = crop;
    return faces;
  }

  private scan(input: Input, crop: Crop, infer: (input: Input) => RawFace[]): RawFace[] {
    if (!this.canvas) {
      this.canvas = typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(512, 512) : document.createElement("canvas");
      this.canvas.width = this.canvas.height = 512;
    }
    const ctx = this.canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    ctx.filter = "grayscale(1) contrast(1.3) brightness(1.2)";
    ctx.drawImage(input, crop.x, crop.y, crop.size, crop.size, 0, 0, 512, 512);
    ctx.filter = "none";
    const faces = infer(this.canvas);
    if (faces.length) this.mode = "recovery";
    return faces.map(f => remapRecoveryFace(f, crop, this.width, this.height));
  }
}

/** Geometric deduplication only; identity/lock association remains downstream. */
export function sameFaceBox(a: RawFace, b: RawFace): boolean {
  const p = a.bbox, q = b.bbox;
  const intersection = Math.max(0, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x)) *
    Math.max(0, Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y));
  const union = p.w * p.h + q.w * q.h - intersection;
  return union > 0 && intersection / union >= 0.35;
}

export function remapRecoveryFace(face: RawFace, crop: Crop, width: number, height: number): RawFace {
  const b = face.bbox;
  return { ...face, bbox: {
    x: (crop.x + b.x * crop.size) / width, y: (crop.y + b.y * crop.size) / height,
    w: b.w * crop.size / width, h: b.h * crop.size / height,
    cx: (crop.x + b.cx * crop.size) / width, cy: (crop.y + b.cy * crop.size) / height,
  } };
}
