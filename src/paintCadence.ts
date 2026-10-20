/** Match the vendor paint tick before paying for its 3D source image. */
export class PaintCadence {
  private tick = -1;
  private key = "";
  reset(): void { this.tick = -1; this.key = ""; }
  take(seconds: number, fps: number, key: string, split: number): boolean {
    const tick = Math.floor(seconds * fps + 1e-6);
    const changed = tick !== this.tick || key !== this.key;
    this.tick = tick;
    this.key = key;
    // A split comparison exposes the unfiltered canvas: keep that side live.
    return split > 0 || changed;
  }
}
