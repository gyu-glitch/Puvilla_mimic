import type { Config } from "./config";

export function quarterTurn(degrees: number): number {
  return Number.isFinite(degrees) ? ((Math.round(degrees / 90) * 90) % 360 + 360) % 360 : 0;
}

/** Rotate pixels before inference; CSS mirroring is only a preview convention. */
export function drawCameraInput(canvas: HTMLCanvasElement, source: CanvasImageSource,
  width: number, height: number, degrees: number): void {
  const turn = quarterTurn(degrees), sideways = turn % 180 !== 0;
  const w = sideways ? height : width, h = sideways ? width : height;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
    canvas.dispatchEvent(new Event("resize"));
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-turn * Math.PI / 180);
  ctx.drawImage(source, -width / 2, -height / 2, width, height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export class CameraInput {
  readonly canvas = document.createElement("canvas");
  private lastTime = -1;
  private lastTurn: number | null = null;
  private sourceWidth = 0;
  private sourceHeight = 0;

  constructor(private video: HTMLVideoElement, private cfg: Config["camera"]) {
    video.id = "cameraSource";
    video.style.display = "none";
    this.canvas.id = "cam";
    this.canvas.classList.toggle("mirror", cfg.mirror);
    document.body.appendChild(this.canvas);
    this.update();
  }

  /** True when the coordinate system changed; tracking state must start afresh. */
  update(): boolean {
    const v = this.video, turn = quarterTurn(this.cfg.inputRotation);
    if (v.readyState < 2 || !v.videoWidth || !v.videoHeight) return false;
    const changed = this.lastTurn !== null && (turn !== this.lastTurn ||
      this.sourceWidth !== v.videoWidth || this.sourceHeight !== v.videoHeight);
    if (changed || this.lastTurn === null || v.currentTime !== this.lastTime) {
      drawCameraInput(this.canvas, v, v.videoWidth, v.videoHeight, turn);
      this.lastTurn = turn; this.lastTime = v.currentTime;
      this.sourceWidth = v.videoWidth; this.sourceHeight = v.videoHeight;
    }
    this.canvas.classList.toggle("mirror", this.cfg.mirror);
    return changed;
  }
}
