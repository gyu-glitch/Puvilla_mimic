import type { RawFace } from "../src/tracker";

/** Learn one stable, open-eyed viewing pose per visitor, then freeze it.
 * No ongoing pitch following: a deliberate nod must remain a nod. */
export class FaceNeutral {
  private samples: { t: number; pitch: number; left: number; right: number }[] = [];
  private previous: RawFace | null = null;
  private base: { pitch: number; left: number; right: number } | null = null;
  get ready(): boolean { return this.base !== null; }
  reset(): void { this.samples = []; this.previous = null; this.base = null; }

  update(face: RawFace, now: number): void {
    if (this.base || face === this.previous) return;
    this.previous = face; // Cached worker results are not additional samples.
    const { pitch, yaw, roll, eyes } = face;
    if (![pitch, yaw, roll, eyes?.left, eyes?.right].every(Number.isFinite) ||
        Math.abs(yaw) > 25 || Math.abs(roll) > 18 ||
        eyes.left < .025 || eyes.right < .025) {
      this.samples = [];
      return;
    }
    this.samples.push({ t: now, pitch, left: eyes.left, right: eyes.right });
    this.samples = this.samples.filter(s => now - s.t <= 1100);
    if (this.samples.length < 8 || now - this.samples[0].t < 750) return;
    const quantile = (key: "pitch" | "left" | "right", q: number) => {
      const values = this.samples.map(s => s[key]).sort((a, b) => a - b);
      return values[Math.floor((values.length - 1) * q)];
    };
    // Reject entry motion and eye closures; an isolated large EAR outlier
    // cannot become the open-eye baseline.
    if (quantile("pitch", .9) - quantile("pitch", .1) > 5 ||
        quantile("left", .2) < quantile("left", .75) * .7 ||
        quantile("right", .2) < quantile("right", .75) * .7) return;
    this.base = { pitch: quantile("pitch", .5), left: quantile("left", .75), right: quantile("right", .75) };
  }

  pitch(raw: number): number { return this.base ? raw - this.base.pitch : 0; }
  blink(ear: number, side: "left" | "right"): number {
    if (!this.base || !Number.isFinite(ear) || ear <= 0) return 0;
    return Math.min(1, Math.max(0, (this.base[side] - ear) / (this.base[side] * .55)));
  }
}
