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
  /** Pinky-to-index direction, when the pose model has a reliable hand span. */
  handAcrossL?: V3; handAcrossR?: V3;
  /** Wrist toward the index/pinky midpoint, independent of forearm direction. */
  handDirectionL?: V3; handDirectionR?: V3;
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
  private armState = {
    L: { active: false, since: -Infinity, samples: 0 },
    R: { active: false, since: -Infinity, samples: 0 },
  };

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

  private loseArm(s: "L" | "R"): void {
    const state = this.armState[s];
    state.active = false; state.since = -Infinity; state.samples = 0;
    for (const joint of ["elbow", "wrist", "handAcross", "handDirection"]) this.bank.resetPrefix(`${joint}${s}`);
  }

  private restArms(): BodyPose | null {
    for (const s of ["L", "R"] as const) this.loseArm(s);
    if (this.last) this.last = {
      ...this.last, armL: 0, armR: 0,
      handAcrossL: undefined, handAcrossR: undefined,
      handDirectionL: undefined, handDirectionR: undefined,
    };
    return this.last;
  }

  /** Ordinary inference skips hold briefly; a fresh missing detection releases arms immediately. */
  update(raw: RawPose | null, fresh: boolean, nowMs: number): BodyPose | null {
    if (!fresh) {
      if (nowMs - this.lastSeenMs >= Math.min(240, this.cfg.body.lostHoldMs)) this.restArms();
      return nowMs - this.lastSeenMs < this.cfg.body.lostHoldMs ? this.last : null;
    }
    if (!raw) {
      this.restArms();
      if (nowMs - this.lastSeenMs >= this.cfg.body.lostHoldMs) {
        this.last = null;
        this.bank.reset();
      }
      return this.last;
    }
    if (nowMs - this.lastSeenMs > 240) this.restArms();
    const mirror = this.cfg.camera.mirror;
    const w = raw.world;
    const usable = (i: number) => w[i] && [w[i].x, w[i].y, w[i].z, w[i].visibility].every(Number.isFinite);
    if (![LM.lShoulder, LM.rShoulder].every(usable) ||
        Math.min(w[LM.lShoulder].visibility, w[LM.rShoulder].visibility) < this.cfg.body.minVisibility) {
      return this.update(null, true, nowMs);
    }
    // 거울: 사람의 왼쪽(이미지 오른쪽) → 캐릭터 화면 왼쪽 = 캐릭터의 R(-x)
    const pick = (i: number): V3 => usable(i) ? [mirror ? -w[i].x : w[i].x, -w[i].y, -w[i].z] : [0, 0, 0];
    const side = mirror
      ? { L: [LM.rShoulder, LM.rElbow, LM.rWrist, LM.rHip], R: [LM.lShoulder, LM.lElbow, LM.lWrist, LM.lHip] }
      : { L: [LM.lShoulder, LM.lElbow, LM.lWrist, LM.lHip], R: [LM.rShoulder, LM.rElbow, LM.rWrist, LM.rHip] };
    const vis = (i: number) => usable(i) ? w[i].visibility : 0;
    const armConfidence = {
      L: Math.min(...side.L.slice(0, 3).map(vis)),
      R: Math.min(...side.R.slice(0, 3).map(vis)),
    };
    for (const s of ["L", "R"] as const) {
      const state = this.armState[s], ids = side[s].slice(0, 3);
      const threshold = Math.max(this.cfg.body.minVisibility, state.active ? .65 : .75);
      const inFrame = ids.every(i => !raw.image || (raw.image[i] &&
        Number.isFinite(raw.image[i].x) && Number.isFinite(raw.image[i].y) &&
        raw.image[i].x >= 0 && raw.image[i].x <= 1 && raw.image[i].y >= 0 && raw.image[i].y <= 1));
      const length = (a: number, b: number) => usable(a) && usable(b)
        ? Math.hypot(w[a].x-w[b].x, w[a].y-w[b].y, w[a].z-w[b].z) : 0;
      const upper = length(ids[0], ids[1]), fore = length(ids[1], ids[2]);
      // Reject collapsed/exploded inference, without limiting a valid arm's direction or lift.
      const plausible = upper >= .10 && upper <= .65 && fore >= .10 && fore <= .65 &&
        upper / fore >= .35 && upper / fore <= 2.5;
      if (armConfidence[s] < threshold || !inFrame || !plausible) this.loseArm(s);
      else if (!state.active) {
        if (!Number.isFinite(state.since) || nowMs - this.lastSeenMs > 240) {
          state.since = nowMs; state.samples = 0;
        }
        state.samples++;
        state.active = nowMs - state.since >= 180 && state.samples >= 3;
      }
      if (!state.active) armConfidence[s] = 0;
    }
    const t = nowMs / 1000;

    const pts: Record<(typeof KEYS)[number], V3> = {
      shoulderL: pick(side.L[0]), elbowL: pick(side.L[1]), wristL: pick(side.L[2]), hipL: pick(side.L[3]),
      shoulderR: pick(side.R[0]), elbowR: pick(side.R[1]), wristR: pick(side.R[2]), hipR: pick(side.R[3]),
    };
    for (const k of KEYS) {
      const armSide = k.endsWith("L") ? "L" : "R";
      if ((k.startsWith("elbow") || k.startsWith("wrist")) && armConfidence[armSide] < this.cfg.body.minVisibility) continue;
      const p = pts[k];
      pts[k] = [this.bank.filter(`${k}x`, p[0], t), this.bank.filter(`${k}y`, p[1], t), this.bank.filter(`${k}z`, p[2], t)];
    }
    for (const s of ["L", "R"] as const) {
      if (armConfidence[s] === 0) {
        // Keep finite coordinates for consumers, but never promote a stale arm to valid.
        // The character eases this arm to its original rest pose.
        for (const joint of ["elbow", "wrist"] as const) {
          const k = `${joint}${s}` as const, shoulder = `shoulder${s}` as const;
          pts[k] = this.last
            ? pts[shoulder].map((v, i) => v + this.last![k][i] - this.last![shoulder][i]) as V3
            : pts[shoulder].map((v, i) => v - (i === 1 ? (joint === "elbow" ? .27 : .52) : 0)) as V3;
        }
      }
    }

    this.lastSeenMs = nowMs;
    const hands: Pick<BodyPose,'handAcrossL'|'handAcrossR'|'handDirectionL'|'handDirectionR'> = {};
    for(const s of ['L','R'] as const){
      // MediaPipe Pose: left pinky/index 17/19, right pinky/index 18/20.
      const right = side[s][0] === LM.rShoulder;
      const pinky=right?18:17, index=right?20:19;
      if(Math.min(vis(pinky),vis(index),vis(side[s][2]),armConfidence[s]) < Math.max(.6,this.cfg.body.minVisibility))continue;
      const a=pick(index),b=pick(pinky),span=a.map((v,i)=>v-b[i]) as V3;
      const length=Math.hypot(...span);
      if(length<.015||length>.20)continue;
      hands[`handAcross${s}`]=span.map((v,i)=>this.bank.filter(`handAcross${s}${i}`,v/length,t)) as V3;
      const wrist=pick(side[s][2]),forward=a.map((v,i)=>(v+b[i])*.5-wrist[i]) as V3;
      const reach=Math.hypot(...forward);
      if(reach>=.025&&reach<=.18)
        hands[`handDirection${s}`]=forward.map((v,i)=>this.bank.filter(`handDirection${s}${i}`,v/reach,t)) as V3;
    }
    this.last = {
      ...pts,
      ...hands,
      armL: armConfidence.L,
      armR: armConfidence.R,
      hips: Math.min(vis(LM.lHip), vis(LM.rHip)),
    };
    return this.last;
  }
}
