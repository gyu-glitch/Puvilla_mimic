import { applyImageSettings, currentVideoTrack } from "./camera";
import type { Config } from "./config";

export interface ZoneFace {
  x: number;
  y: number;
  w: number;
  h: number;
  locked: boolean;
  inZone: boolean;
  held?: boolean;
  body?: boolean;
  pending?: boolean;
}

type Mode = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | null;

/**
 * 락온 영역 편집기 (개발용, `d` 키 오버레이와 같이 보임/숨김).
 * 오른쪽 아래 카메라 미리보기를 키우고 그 위에 노란 박스(락온 영역)와 얼굴 박스를 그린다.
 *   - 박스 안을 끌면 이동, 가장자리/모서리를 끌면 크기 조절
 *   - 초록 = 락온된 사람, 흰색 = 영역 안 다른 사람, 회색 = 영역 밖
 * 값은 cfg.presence.lockZone 을 직접 바꾼다 → 즉시 반영, '저장'으로 config.json 에 남김.
 */
export class LockZoneEditor {
  private wrap: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private mode: Mode = null;
  private start = { x: 0, y: 0, z: { x: 0, y: 0, w: 0, h: 0 } };

  /** 드래그를 놓았을 때 (자동 저장용) */
  onChange: (() => void) | null = null;

  constructor(private cfg: Config, video: HTMLVideoElement | HTMLCanvasElement, hasCamera: boolean) {
    this.wrap = document.createElement("div");
    this.wrap.id = "camWrap";
    this.wrap.style.cssText =
      "position:fixed;right:12px;bottom:12px;width:min(42vw,420px);border-radius:8px;overflow:hidden;" +
      "border:1px solid #444;background:#111;z-index:5;display:flex;flex-direction:column";
    document.body.appendChild(this.wrap);
    const view = document.createElement("div");
    view.style.cssText = "position:relative;width:100%;aspect-ratio:16/9;touch-action:none";
    this.wrap.appendChild(view);
    if (hasCamera) {
      video.style.cssText = "position:absolute;inset:0;width:100%;height:100%;max-width:none;max-height:none;object-fit:contain;border:0;border-radius:0;opacity:1";
      view.appendChild(video);
      const fitSource = () => {
        const width = "videoWidth" in video ? video.videoWidth : video.width;
        const height = "videoHeight" in video ? video.videoHeight : video.height;
        if (!width || !height) return;
        const aspect = width / height;
        view.style.aspectRatio = String(aspect);
        // Limit height as well as width so portrait footage and controls fit.
        this.wrap.style.width = `min(42vw,420px,${50 * aspect}vh)`;
        document.documentElement.style.setProperty("--camera-preview-height", `min(${42 / aspect}vw,${420 / aspect}px,50vh)`);
      };
      video.addEventListener("loadedmetadata", fitSource);
      video.addEventListener("resize", fitSource);
      fitSource();
    } else {
      const note = document.createElement("div");
      note.textContent = "카메라 없음 (sim) — 락온 영역만 편집 가능";
      note.style.cssText = "position:absolute;left:8px;top:6px;color:#888;font:12px system-ui";
      view.appendChild(note);
    }
    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;cursor:crosshair";
    view.appendChild(this.canvas);
    if (hasCamera) this.buildExposureControls();
    this.ctx = this.canvas.getContext("2d")!;

    this.canvas.addEventListener("pointerdown", (e) => this.down(e));
    this.canvas.addEventListener("pointermove", (e) => this.move(e));
    const up = (e: PointerEvent) => {
      if (this.mode) {
        this.canvas.releasePointerCapture(e.pointerId);
        this.onChange?.();
      }
      this.mode = null;
    };
    this.canvas.addEventListener("pointerup", up);
    this.canvas.addEventListener("pointercancel", up);
  }

  private norm(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  private hit(p: { x: number; y: number }): Mode {
    const z = this.cfg.presence.lockZone;
    const r = this.canvas.getBoundingClientRect();
    const tx = 10 / r.width, ty = 10 / r.height;
    const nearL = Math.abs(p.x - z.x) < tx, nearR = Math.abs(p.x - (z.x + z.w)) < tx;
    const nearT = Math.abs(p.y - z.y) < ty, nearB = Math.abs(p.y - (z.y + z.h)) < ty;
    const insideX = p.x > z.x - tx && p.x < z.x + z.w + tx;
    const insideY = p.y > z.y - ty && p.y < z.y + z.h + ty;
    if (nearT && nearL) return "nw";
    if (nearT && nearR) return "ne";
    if (nearB && nearL) return "sw";
    if (nearB && nearR) return "se";
    if (nearT && insideX) return "n";
    if (nearB && insideX) return "s";
    if (nearL && insideY) return "w";
    if (nearR && insideY) return "e";
    if (p.x > z.x && p.x < z.x + z.w && p.y > z.y && p.y < z.y + z.h) return "move";
    return null;
  }

  private down(e: PointerEvent): void {
    const p = this.norm(e);
    this.mode = this.hit(p);
    if (!this.mode) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.start = { x: p.x, y: p.y, z: { ...this.cfg.presence.lockZone } };
  }

  private move(e: PointerEvent): void {
    const p = this.norm(e);
    if (!this.mode) {
      const m = this.hit(p);
      this.canvas.style.cursor =
        m === "move" ? "move" : m === "n" || m === "s" ? "ns-resize" : m === "e" || m === "w" ? "ew-resize"
        : m === "ne" || m === "sw" ? "nesw-resize" : m === "nw" || m === "se" ? "nwse-resize" : "crosshair";
      return;
    }
    const dx = p.x - this.start.x, dy = p.y - this.start.y;
    const s = this.start.z;
    let x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h;
    const MIN = 0.08;
    if (this.mode === "move") {
      const nx = Math.min(1 - s.w, Math.max(0, s.x + dx)), ny = Math.min(1 - s.h, Math.max(0, s.y + dy));
      x0 = nx; y0 = ny; x1 = nx + s.w; y1 = ny + s.h;
    } else {
      if (this.mode.includes("w")) x0 = Math.min(x1 - MIN, Math.max(0, s.x + dx));
      if (this.mode.includes("e")) x1 = Math.max(x0 + MIN, Math.min(1, s.x + s.w + dx));
      if (this.mode.includes("n")) y0 = Math.min(y1 - MIN, Math.max(0, s.y + dy));
      if (this.mode.includes("s")) y1 = Math.max(y0 + MIN, Math.min(1, s.y + s.h + dy));
    }
    const z = this.cfg.presence.lockZone;
    z.x = round3(x0);
    z.y = round3(y0);
    z.w = round3(x1 - x0);
    z.h = round3(y1 - y0);
  }

  /** 카메라 화면 아래: 노출·밝기 슬라이더 (어두우면 얼굴 인식·락온이 자주 풀림). 카메라가 지원하는 항목만 표시 */
  private buildExposureControls(): void {
    const track = currentVideoTrack();
    const caps = (track?.getCapabilities?.() ?? {}) as Record<string, { min: number; max: number; step?: number } | string[] | undefined>;
    const cc = this.cfg.camera;
    const panel = document.createElement("div");
    panel.style.cssText = "display:grid;grid-template-columns:auto 1fr 44px;gap:4px 8px;align-items:center;padding:6px 10px;font:12px system-ui;color:#ddd";
    // 숨기기/보이기 버튼 (상태는 config 에 저장)
    const toggle = document.createElement("button");
    toggle.style.cssText = "border:0;border-top:1px solid #333;background:#1b1b1b;color:#bbb;font:12px system-ui;padding:4px;cursor:pointer";
    const setHidden = (h: boolean) => {
      cc.controlsHidden = h;
      panel.style.display = h ? "none" : "grid";
      toggle.textContent = h ? "▲ 카메라 노출 조절 보이기" : "▼ 카메라 노출 조절 숨기기";
    };
    toggle.onclick = () => {
      setHidden(!cc.controlsHidden);
      this.onChange?.();
    };
    this.wrap.append(toggle, panel);
    setHidden(cc.controlsHidden);
    const apply = () => {
      cc.applyImageSettings = true;
      void applyImageSettings(cc);
    };
    const save = () => this.onChange?.();
    const rows: { show: () => boolean; els: HTMLElement[] }[] = [];
    const refresh = () => rows.forEach((r) => r.els.forEach((el) => (el.style.display = r.show() ? "" : "none")));

    if (caps.exposureMode) {
      const label = document.createElement("label");
      label.style.cssText = "grid-column:1 / span 3;display:flex;gap:6px;align-items:center;cursor:pointer";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = cc.autoExposure;
      cb.onchange = () => {
        cc.autoExposure = cb.checked;
        apply();
        refresh();
        save();
      };
      label.append(cb, "자동 노출 (끄면 노출 시간을 직접 조절)");
      panel.appendChild(label);
    }
    const slider = (name: string, key: "exposureTime" | "exposureCompensation" | "brightness" | "contrast", cap: string, show: () => boolean, unit = "") => {
      const c = caps[cap] as { min: number; max: number; step?: number } | undefined;
      if (!c || typeof c.min !== "number") return;
      const lab = document.createElement("span");
      lab.textContent = name;
      const input = document.createElement("input");
      input.type = "range";
      // 노출 시간은 웹캠이 2배 간격 단계(…312·625·1250…)로만 받는다 → 슬라이더도 그 단계로
      const log2 = key === "exposureTime" && c.min > 0;
      const toVal = (x: number) => (log2 ? c.min * Math.pow(2, Math.round(x)) : x);
      if (log2) {
        input.min = "0";
        input.max = String(Math.floor(Math.log2(c.max / c.min)));
        input.step = "1";
        input.value = String(Math.round(Math.log2(Math.max(c.min, cc[key]) / c.min)));
      } else {
        input.min = String(c.min);
        input.max = String(c.max);
        input.step = String(c.step || (c.max - c.min) / 100);
        input.value = String(Math.min(c.max, Math.max(c.min, cc[key])));
      }
      input.style.width = "100%";
      const val = document.createElement("span");
      const fmt = () => (val.textContent = `${Math.round(toVal(Number(input.value)) * 10) / 10}${unit}`);
      fmt();
      input.oninput = () => {
        cc[key] = toVal(Number(input.value));
        fmt();
        apply();
      };
      input.onchange = save;
      panel.append(lab, input, val);
      rows.push({ show, els: [lab, input, val] });
    };
    slider("노출 시간", "exposureTime", "exposureTime", () => !cc.autoExposure);
    slider("노출 보정", "exposureCompensation", "exposureCompensation", () => cc.autoExposure);
    slider("밝기", "brightness", "brightness", () => true);
    slider("대비", "contrast", "contrast", () => true);
    if (!panel.childElementCount) panel.textContent = "이 카메라는 노출 조절을 지원하지 않음";
    refresh();
  }

  draw(faces: ZoneFace[]): void {
    const c = this.canvas, g = this.ctx;
    const W = c.clientWidth, H = c.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    // 영역 밖 어둡게
    const z = this.cfg.presence.lockZone;
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.beginPath();
    g.rect(0, 0, W, H);
    g.rect(z.x * W, z.y * H, z.w * W, z.h * H);
    g.fill("evenodd");

    for (const f of faces) {
      g.lineWidth = f.locked ? 3 : 1.5;
      g.strokeStyle = f.pending ? "#aaaaaa" : f.held ? "#ffba55" : f.body ? "#56dcff" : f.locked ? "#3ee07a" : f.inZone ? "#ffffff" : "rgba(160,160,160,0.8)";
      g.setLineDash(f.held ? [4, 4] : []);
      g.strokeRect(f.x * W, f.y * H, f.w * W, f.h * H);
      g.setLineDash([]);
      if (f.locked || f.held || f.body) {
        g.fillStyle = f.pending ? "#aaaaaa" : f.held ? "#ffba55" : f.body ? "#56dcff" : "#3ee07a";
        g.font = "bold 12px system-ui";
        g.fillText(f.pending ? "후보 · 얼굴 확인 중" : f.body ? (f.held ? "사람 LOCK 유지" : "사람 LOCK · 얼굴 추적 중") : f.held ? "LOCK 유지 · 재검출 중" : "LOCK", f.x * W, f.y * H - 4);
      }
    }

    g.lineWidth = 2;
    g.setLineDash([6, 4]);
    g.strokeStyle = "#ffd23f";
    g.strokeRect(z.x * W, z.y * H, z.w * W, z.h * H);
    g.setLineDash([]);
    g.fillStyle = "#ffd23f";
    for (const [hx, hy] of [[z.x, z.y], [z.x + z.w, z.y], [z.x, z.y + z.h], [z.x + z.w, z.y + z.h]]) {
      g.fillRect(hx * W - 4, hy * H - 4, 8, 8);
    }
    g.font = "12px system-ui";
    g.fillText("락온 영역 — 끌어서 이동 · 모서리로 크기", z.x * W + 4, z.y * H + 14);
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
