import type { Config } from "./config";
import { log } from "./logger";
import { qualityParam } from "./mobile";

/**
 * 성능 단계: 렌더 해상도(픽셀 배율)와 털 셸 수.
 * 최고 단계로 시작하고, 실행 중 렌더가 계속 느리면(3초 이상 목표 fps 미만) 한 단계씩 내린다.
 */
// 해상도를 낮추면 윤곽·스카프가 계단처럼 깨지므로 털 층을 먼저 줄이고, 해상도는 1배 아래로 내리지 않음
const LEVELS = [
  { pixelRatio: 2, shells: 14 },
  { pixelRatio: 2, shells: 9 },
  { pixelRatio: 2, shells: 6 },
  { pixelRatio: 1.5, shells: 6 },
  { pixelRatio: 1.5, shells: 4 },
  { pixelRatio: 1, shells: 4 },
];

export class QualityGovernor {
  private level: number;
  private slowSince = 0;
  private apply: (pixelRatio: number, shells: number) => void;

  constructor(private cfg: Config["quality"], apply: (pixelRatio: number, shells: number) => void) {
    this.apply = apply;
    // 모든 기기 최고 단계로 시작 — 실제로 느릴 때만 내림 (성능 좋은 폰은 그대로 유지)
    this.level = Math.min(LEVELS.length - 1, Math.max(0, cfg.startLevel));
    this.set(this.level);
  }

  private set(i: number): void {
    this.level = i;
    const l = LEVELS[i];
    // ?quality=max 면 단계 0 의 해상도를 기기 화면 그대로(폰은 보통 ×2.6~3)
    const dpr = window.devicePixelRatio || 1;
    const pr = i === 0 && qualityParam().max ? Math.min(dpr, 3) : Math.min(l.pixelRatio, dpr);
    this.apply(pr, l.shells);
    log.info("quality", `단계 ${i}: 해상도 ×${l.pixelRatio} · 털 셸 ${l.shells}`);
  }

  /** 화면 표시용: 지금 단계 */
  get info(): string {
    const l = LEVELS[this.level];
    return `품질 ${this.level} (해상도 ×${l.pixelRatio} · 털 ${l.shells}층)`;
  }

  /**
   * 1초마다 렌더 fps·얼굴 추론 fps 를 넣어 줌.
   * 추론도 봄: 폰에선 털 렌더가 GPU 를 꽉 채우면 같은 GPU 를 쓰는 얼굴 인식이 밀려 초당 1~2회로 떨어짐(화면은 그려지는데 움직임이 뚝뚝)
   */
  update(renderFps: number, now: number, inferFps = Infinity): void {
    if (!this.cfg.auto || this.level >= LEVELS.length - 1) return;
    if (renderFps >= this.cfg.minFps && inferFps >= this.cfg.minInferFps) {
      this.slowSince = 0;
      return;
    }
    if (!this.slowSince) this.slowSince = now;
    else if (now - this.slowSince > 3000) {
      this.slowSince = 0;
      log.warn("quality", `느림: 렌더 ${renderFps.toFixed(0)}fps · 추론 ${Number.isFinite(inferFps) ? inferFps.toFixed(0) : "-"}fps → 한 단계 낮춤`);
      this.set(this.level + 1);
    }
  }
}

