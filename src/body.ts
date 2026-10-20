import type { Config } from "./config";
import type { RawPose } from "./poseTracker";
import { OneEuroBank } from "./smoothing";

export type V3 = [number, number, number];

/**
 * 상반신 신호. 캐릭터 공간 (+x = 캐릭터 왼쪽 = 화면 오른쪽, +y 위, +z 관객 쪽), 단위 m, 엉덩이 중심 원점.
 * 미러는 이미 반영됨 — 화면 왼쪽에 보이는 사람 팔이 캐릭터의 화면 왼쪽 팔(R)로 간다.
 * 리그는 이 점들로 몸통 회전·팔 방향을 계산한다 (character/puuvilla.ts).
 */
export interface BodyPose {
  shoulderL: V3; shoulderR: V3;
  elbowL: V3; elbowR: V3;
  wristL: V3; wristR: V3;
  hipL: V3; hipR: V3;
  /** 0~1 신뢰도 */
  armL: number;
  armR: number;
  hips: number;
}

// MediaPipe Pose 인덱스 (사람 기준 left/right)
const LM = { lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16, lHip: 23, rHip: 24 };
const KEYS = ["shoulderL", "shoulderR", "elbowL", "elbowR", "wristL", "wristR", "hipL", "hipR"] as const;

export class BodyProcessor {
  private bank: OneEuroBank;
  private lastSeenMs = -Infinity;
  private last: BodyPose | null = null;

  constructor(private cfg: Config) {
    const b = cfg.body;
    this.bank = new OneEuroBank(b.minCutoff, b.beta, cfg.smoothing.dCutoff);
  }

  applySmoothingParams(): void {
    this.bank.setParams(this.cfg.body.minCutoff, this.cfg.body.beta, this.cfg.smoothing.dCutoff);
  }

  /**
   * 여러 몸 중 얼굴 대상과 같은 사람을 고른다: 코가 대상 얼굴 bbox 안(가로 ±얼굴 폭)에 있는 몸.
   * 얼굴 대상이 없으면 가장 가까운(어깨 폭이 큰) 몸.
   */
  static pickForFace(poses: RawPose[], face: { cx: number; cy: number; h: number } | null): RawPose | null {
    if (!poses.length) return null;
    if (!face) return poses.reduce((a, b) => (b.shoulderW > a.shoulderW ? b : a));
    let best: RawPose | null = null, bestD = Infinity;
    for (const p of poses) {
      const d = Math.hypot(p.nose.x - face.cx, (p.nose.y - face.cy) * 0.7);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return bestD < Math.max(0.08, face.h * 0.6) ? best : null;
  }

  /** fresh=false 면 이전 값 유지(홀드 시간 내) */
  update(raw: RawPose | null, fresh: boolean, nowMs: number): BodyPose | null {
    if (!fresh) return nowMs - this.lastSeenMs < this.cfg.body.lostHoldMs ? this.last : null;
    if (!raw) {
      if (nowMs - this.lastSeenMs >= this.cfg.body.lostHoldMs) {
        this.last = null;
        this.bank.reset();
      }
      return this.last;
    }
    const mirror = this.cfg.camera.mirror;
    const w = raw.world;
    // 거울: 사람의 왼쪽(이미지 오른쪽) → 캐릭터 화면 왼쪽 = 캐릭터의 R(-x)
    const pick = (i: number): V3 => [mirror ? -w[i].x : w[i].x, -w[i].y, -w[i].z];
    const side = mirror
      ? { L: [LM.rShoulder, LM.rElbow, LM.rWrist, LM.rHip], R: [LM.lShoulder, LM.lElbow, LM.lWrist, LM.lHip] }
      : { L: [LM.lShoulder, LM.lElbow, LM.lWrist, LM.lHip], R: [LM.rShoulder, LM.rElbow, LM.rWrist, LM.rHip] };
    const vis = (i: number) => w[i].visibility;
    const t = nowMs / 1000;

    const pts: Record<(typeof KEYS)[number], V3> = {
      shoulderL: pick(side.L[0]), elbowL: pick(side.L[1]), wristL: pick(side.L[2]), hipL: pick(side.L[3]),
      shoulderR: pick(side.R[0]), elbowR: pick(side.R[1]), wristR: pick(side.R[2]), hipR: pick(side.R[3]),
    };
    for (const k of KEYS) {
      const p = pts[k];
      pts[k] = [this.bank.filter(`${k}x`, p[0], t), this.bank.filter(`${k}y`, p[1], t), this.bank.filter(`${k}z`, p[2], t)];
    }
    const shouldersOk = Math.min(vis(LM.lShoulder), vis(LM.rShoulder));
    if (shouldersOk < this.cfg.body.minVisibility) return nowMs - this.lastSeenMs < this.cfg.body.lostHoldMs ? this.last : null;

    this.lastSeenMs = nowMs;
    this.last = {
      ...pts,
      armL: Math.min(vis(side.L[1]), vis(side.L[2])),
      armR: Math.min(vis(side.R[1]), vis(side.R[2])),
      hips: Math.min(vis(LM.lHip), vis(LM.rHip)),
    };
    return this.last;
  }
}
