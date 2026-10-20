import * as THREE from "three";
import { assetUrl } from "./embedded";

/**
 * 배경 선택 (가운데 아래 버튼): 겨울 마을 그림(기본) / 주황 그라디언트.
 * - 뒤(캐릭터 뒤): bg_far(맨 아래 하늘·설원) + village_left/right(왼쪽·오른쪽 아래) → 2D 캔버스 한 장(canvas)
 * - 앞(캐릭터 앞): branches_left/right — 좌상단·우상단 모서리. 평소엔 DOM 이미지(터치 통과),
 *   유화 획 필터가 켜지면 앞 캔버스(frontCanvas)에 같은 자리로 그려 필터가 캐릭터 위에 합성 → 가지까지 함께 칠해짐
 * 필터는 캐릭터를 배경 위에 합성해 불투명으로 내보내므로 이 캔버스들을 텍스처로 넘긴다.
 * 주의: three 는 텍스처를 처음 올린 크기로 GPU 저장소를 고정해서, 캔버스 크기가 바뀐 뒤 needsUpdate 만 하면
 * 새 그림이 무시됨(처음에 빈 캔버스가 올라가면 배경이 계속 검정) → 크기가 바뀌면 텍스처를 새로 만들고, 그림을 다 그린 뒤에만 넘김.
 * 선택은 그 기기에만(localStorage) — 공용 설정과 따로.
 */
export type BgStyle = "orange" | "winter";
export const BG_STYLES: BgStyle[] = ["orange", "winter"];
const KEY = "pubilla-mimic-bg";
const DIR = "./bg/";
/** 가지 폭 (CSS 와 같은 식): min(72vh, max(46vw, 34vh)) */
const branchW = (W: number, H: number) => Math.min(0.72 * H, Math.max(0.46 * W, 0.34 * H));

export class Backdrop {
  readonly canvas = document.createElement("canvas");
  readonly frontCanvas = document.createElement("canvas");
  private tex: THREE.CanvasTexture | null = null;
  private frontTex: THREE.CanvasTexture | null = null;
  private front = document.createElement("div");
  private imgs = new Map<string, HTMLImageElement>();
  private loading: Promise<void> | null = null;
  /** 그림을 다 받아 그렸는지 (그 전엔 텍스처를 넘기지 않음) */
  private drawn = false;
  /** 앞 장식을 필터 쪽에서 그리는 중 (DOM 가지는 숨김) */
  private frontBaked = false;
  style: BgStyle = "winter"; // 기본 = 겨울 마을 (가운데 아래 버튼으로 주황)
  /** 다시 그린 뒤 (필터 텍스처 갱신·한 프레임 다시 그리기용) */
  onChange: (() => void) | null = null;

  constructor(private grad: { top: string; bottom: string }) {
    this.canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;display:none;pointer-events:none";
    document.body.insertBefore(this.canvas, document.getElementById("app"));
    this.front.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:5;display:none";
    for (const side of ["left", "right"] as const) {
      const im = document.createElement("img");
      im.alt = "";
      im.decoding = "async";
      im.dataset.src = `${DIR}branches_${side}.webp`;
      // 가지 그림은 900×600 중 바깥 모서리 쪽 절반 남짓만 차 있음 → 화면 짧은 변 기준으로 크기
      im.style.cssText = `position:absolute;top:0;${side}:0;width:min(72vh,max(46vw,34vh));height:auto;user-select:none`;
      this.front.appendChild(im);
    }
    document.getElementById("app")!.after(this.front);
    try {
      const s = localStorage.getItem(KEY);
      if (s && (BG_STYLES as string[]).includes(s)) this.style = s as BgStyle;
    } catch {
      /* 저장소 막힘 */
    }
    addEventListener("resize", () => this.draw());
    void this.set(this.style, false);
  }

  get usesImage(): boolean {
    return this.style !== "orange";
  }

  /** 뒤 배경 텍스처 (그림 배경이 아니거나 아직 못 그렸으면 null → 필터는 주황 그라디언트) */
  get texture(): THREE.Texture | null {
    return this.usesImage && this.drawn ? this.tex : null;
  }

  /** 앞 장식 텍스처 — 이걸 가져가는 필터가 가지까지 합성 (호출하면 DOM 가지는 숨김) */
  frontTexture(): THREE.Texture | null {
    this.setFrontBaked(true);
    return this.usesImage && this.drawn ? this.frontTex : null;
  }

  /** 앞 장식을 DOM 으로 다시 보이기 (가지를 합성하지 않는 필터일 때) */
  setFrontBaked(on: boolean): void {
    if (this.frontBaked === on) return;
    this.frontBaked = on;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    const on = this.usesImage && this.drawn;
    this.canvas.style.display = on ? "block" : "none";
    this.front.style.display = on && !this.frontBaked ? "block" : "none";
  }

  async set(style: BgStyle, save = true): Promise<void> {
    this.style = style;
    if (save)
      try {
        localStorage.setItem(KEY, style);
      } catch {
        /* 저장 불가 */
      }
    if (style === "winter") await this.load();
    if (this.style !== style) return; // 받는 사이 다시 바뀜
    this.draw();
  }

  private load(): Promise<void> {
    this.loading ??= Promise.all(
      ["bg_far", "village_left", "village_right", "branches_left", "branches_right"].map(
        (n) =>
          new Promise<void>((res) => {
            const im = new Image();
            im.decoding = "async";
            im.onload = () => {
              this.imgs.set(n, im);
              res();
            };
            im.onerror = () => res(); // 하나 빠져도 나머지로
            im.src = assetUrl(`${DIR}${n}.webp`);
          }),
      ),
    ).then(() => {
      this.front.querySelectorAll("img").forEach((im) => (im.src = assetUrl(im.dataset.src!)));
    });
    return this.loading;
  }

  /** 캔버스 크기 맞추기 — 바뀌면 텍스처를 새로 (GPU 저장소 크기가 고정이라) */
  private fit(c: HTMLCanvasElement, cw: number, ch: number, which: "tex" | "frontTex"): void {
    if (c.width !== cw || c.height !== ch || !this[which]) {
      c.width = cw;
      c.height = ch;
      this[which]?.dispose();
      const t = new THREE.CanvasTexture(c);
      t.minFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      this[which] = t;
    }
  }

  draw(): void {
    if (!this.usesImage || !this.imgs.has("bg_far")) {
      this.applyVisibility();
      this.onChange?.();
      return;
    }
    const W = innerWidth, H = innerHeight;
    if (!W || !H) return;
    const pr = Math.min(devicePixelRatio || 1, 2);
    const cw = Math.round(W * pr), ch = Math.round(H * pr);
    this.fit(this.canvas, cw, ch, "tex");
    this.fit(this.frontCanvas, cw, ch, "frontTex");
    const g = this.canvas.getContext("2d")!;
    g.setTransform(pr, 0, 0, pr, 0, 0);
    const lg = g.createLinearGradient(0, 0, 0, H);
    lg.addColorStop(0, "#4a5fc0");
    lg.addColorStop(1, "#dfe6f7");
    g.fillStyle = lg;
    g.fillRect(0, 0, W, H);
    // 맨 아래: 하늘·설원 — 화면을 덮게(cover), 아래 정렬(설원이 항상 보이게), 가로 가운데
    const far = this.imgs.get("bg_far")!;
    const s = Math.max(W / far.width, H / far.height);
    const fw = far.width * s, fh = far.height * s;
    g.drawImage(far, (W - fw) / 2, H - fh, fw, fh);
    // 마을: 왼쪽 아래 / 오른쪽 아래, 바깥으로 살짝 걸치고 아래로 살짝 묻힘 (가운데는 캐릭터 자리)
    const vh = Math.min(H * 0.56, W * 0.52);
    for (const [n, side] of [["village_left", -1], ["village_right", 1]] as const) {
      const im = this.imgs.get(n);
      if (!im) continue;
      const h = vh * (im.height / 1100);
      const w = (im.width / im.height) * h;
      const x = side < 0 ? -w * 0.08 : W - w * 0.92;
      g.drawImage(im, x, H - h * 0.97, w, h);
    }
    // 앞 장식 (DOM 가지와 같은 자리·크기)
    const f = this.frontCanvas.getContext("2d")!;
    f.setTransform(pr, 0, 0, pr, 0, 0);
    f.clearRect(0, 0, W, H);
    const bw = branchW(W, H);
    for (const side of ["left", "right"] as const) {
      const im = this.imgs.get(`branches_${side}`);
      if (!im) continue;
      const bh = (im.height / im.width) * bw;
      f.drawImage(im, side === "left" ? 0 : W - bw, 0, bw, bh);
    }
    this.tex!.needsUpdate = true;
    this.frontTex!.needsUpdate = true;
    this.drawn = true;
    this.applyVisibility();
    this.onChange?.();
  }

  /** 다음 배경으로 */
  next(): BgStyle {
    const i = BG_STYLES.indexOf(this.style);
    const s = BG_STYLES[(i + 1) % BG_STYLES.length];
    void this.set(s);
    return s;
  }

  get gradient(): { top: string; bottom: string } {
    return this.grad;
  }
}
