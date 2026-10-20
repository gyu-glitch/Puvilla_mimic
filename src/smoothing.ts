/**
 * One Euro Filter — 느린 움직임은 강하게, 빠른 움직임은 약하게 스무딩.
 * minCutoff ↓ = 더 부드럽지만 지연 ↑ / beta ↑ = 빠른 움직임에서 지연 ↓
 * https://gery.casiez.net/1euro/
 */
export class OneEuro {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;

  constructor(public minCutoff = 1.0, public beta = 0.0, public dCutoff = 1.0) {}

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  /** @param t 초 단위 타임스탬프 */
  filter(x: number, t: number): number {
    if (this.xPrev === null || this.tPrev === null) {
      this.xPrev = x;
      this.tPrev = t;
      return x;
    }
    const dt = Math.max(1e-3, t - this.tPrev);
    this.tPrev = t;

    const dx = (x - this.xPrev) / dt;
    const aD = OneEuro.alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;

    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = OneEuro.alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;

    this.xPrev = xHat;
    this.dxPrev = dxHat;
    return xHat;
  }
}

/** 키별 OneEuro 묶음 — blendshape 52개 같은 걸 한 번에 */
export class OneEuroBank {
  private filters = new Map<string, OneEuro>();
  constructor(private minCutoff: number, private beta: number, private dCutoff: number) {}

  setParams(minCutoff: number, beta: number, dCutoff: number): void {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    for (const f of this.filters.values()) {
      f.minCutoff = minCutoff;
      f.beta = beta;
      f.dCutoff = dCutoff;
    }
  }

  filter(key: string, x: number, t: number): number {
    let f = this.filters.get(key);
    if (!f) {
      f = new OneEuro(this.minCutoff, this.beta, this.dCutoff);
      this.filters.set(key, f);
    }
    return f.filter(x, t);
  }

  reset(): void {
    for (const f of this.filters.values()) f.reset();
  }

  resetPrefix(prefix: string): void {
    for (const [key, f] of this.filters) if (key.startsWith(prefix)) f.reset();
  }
}
