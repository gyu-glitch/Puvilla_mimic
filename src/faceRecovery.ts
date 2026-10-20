import type { RawFace } from "./tracker";

type Input = HTMLVideoElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas;
type Crop = { x: number; y: number; size: number };
type Detect = (input: Input, timestamp: number) => RawFace[];
/** Original input coordinates; square side length relative to input height. */
export type FaceHint = { cx: number; cy: number; size: number };
export function faceMatchesHint(face: RawFace, hint: FaceHint, aspect: number): boolean {
  return Math.hypot((face.bbox.cx-hint.cx)*aspect,face.bbox.cy-hint.cy)<hint.size*.45;
}

/** Fallback for small faces under strongly colored venue lighting.
 * Only inference is cropped/desaturated; the preview and pose input stay intact.
 */
export class FaceRecovery {
  private canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private crop: Crop | null = null;
  private nextTile = 0;
  private lastSearch = -Infinity;
  private lastFull = -Infinity;
  private lastCropSeen = -Infinity;
  private lastTimestamp = -Infinity;
  private width = 0;
  private height = 0;
  mode = "full";

  reset(): void {
    this.crop = null;
    this.nextTile = 0;
    this.lastSearch = this.lastFull = -Infinity;
    this.lastCropSeen = -Infinity;
    this.mode = "full";
  }

  run(input: Input, now: number, detect: Detect, hint: FaceHint | null = null): RawFace[] {
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
    let scannedHint: Crop | null = null;
    let hintFaces: RawFace[] = [];
    if (hint && [hint.cx,hint.cy,hint.size].every(Number.isFinite) && hint.size>0) {
      const size=Math.min(width,height,hint.size*height);
      let crop={x:Math.max(0,Math.min(width-size,hint.cx*width-size/2)),
        y:Math.max(0,Math.min(height-size,hint.cy*height-size/2)),size};
      const previous=this.crop;
      if (previous && now-this.lastCropSeen<800 && size/previous.size>.8 && size/previous.size<1.25 &&
          Math.hypot(hint.cx*width-previous.x-previous.size/2,hint.cy*height-previous.y-previous.size/2)<previous.size*.18)
        crop=previous;
      // Follow the selected person's head. Unrelated full-frame faces must not
      // prevent an enlarged pass for this person, or steal its expression.
      scannedHint = crop;
      hintFaces = this.scan(input,crop,infer);
      const faces=hintFaces.filter(f=>faceMatchesHint(f,hint,width/height));
      if (faces.length) {
        this.crop=crop;this.lastCropSeen=now;this.mode="person";
        return faces;
      }
    }
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
      // An unsuccessful person pass may already have scanned this exact crop.
      // Reuse that observation; never rerun the same model on identical pixels.
      const faces = scannedHint && scannedHint.x === this.crop.x && scannedHint.y === this.crop.y && scannedHint.size === this.crop.size
        ? hintFaces : this.scan(input, this.crop, infer);
      if (faces.length) {
        this.lastCropSeen = now;
        // Keep the proven inference framing. A single successful full-frame
        // probe is not evidence that full-frame tracking will remain reliable.
        // Switching every second also changes the head-pose reference.
        return [...faces, ...fullFaces.filter(f => !faces.some(g => sameFaceBox(f, g)))];
      }
      // Retry this region at the incoming cadence after a brief missed frame.
      // Do not turn one miss into a center/left/right search taking 500–750ms.
      // Only current detections are returned; this is not a cached face hold.
      if (now - this.lastCropSeen < 800) {
        this.mode = "recovery-wait";
        return fullFaces;
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
    const crop = recoverySearchCrop(width, height, this.nextTile++);
    const faces = this.scan(input, crop, infer);
    if (faces.length) { this.crop = crop; this.lastCropSeen = now; }
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

/** Search broad regions first, then overlapping enlarged views. Small venue
 * faces can be invisible to the detector even in a full-height square.
 * This covers the whole input rather than assuming a fixed visitor location. */
export function recoverySearchCrop(width: number, height: number, index: number): Crop {
  const tile = index % 12;
  const size = Math.min(width, height) * (tile < 3 ? 1 : 0.75);
  if (tile < 3) {
    const offset = [0.5, 0, 1][tile];
    return { x: (width - size) * offset, y: (height - size) * offset, size };
  }
  const x = [0.5, 0, 1][(tile - 3) % 3];
  const y = [0, 0.5, 1][Math.floor((tile - 3) / 3)];
  return { x: (width - size) * x, y: (height - size) * y, size };
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
