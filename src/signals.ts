import type { Config } from "./config";
import type { RawFace, TrackResult } from "./tracker";
import { OneEuro, OneEuroBank } from "./smoothing";
import { log } from "./logger";

export type Expression = "neutral" | "smile" | "surprise";

/** 스무딩·타깃 선택·접근 판정을 거친, 캐릭터가 바로 쓰는 신호 */
export interface FaceSignal {
  present: boolean; // 추적 대상 얼굴이 있음(홀드 포함)
  near: boolean; // 접근 판정(히스테리시스 적용)
  bboxH: number; // face height relative to input short side (presence threshold)
  cx: number; // 0~1, 미러 반영
  yaw: number; // deg, 미러 반영
  pitch: number;
  roll: number;
  blend: Record<string, number>; // 스무딩된 blendshape
  expression: Expression;
  faceCount: number;
}

const USED_BLENDS = [
  "eyeBlinkLeft", "eyeBlinkRight", "eyeWideLeft", "eyeWideRight",
  "jawOpen", "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft", "mouthFrownRight",
  "mouthPucker", "mouthFunnel", "browInnerUp", "browDownLeft", "browDownRight",
  "browOuterUpLeft", "browOuterUpRight", "cheekPuff", "eyeSquintLeft", "eyeSquintRight",
  "mouthClose",
] as const;

export class SignalProcessor {
  private fYaw: OneEuro;
  private fPitch: OneEuro;
  private fRoll: OneEuro;
  private fBbox: OneEuro;
  private fCx: OneEuro;
  private blends: OneEuroBank;
  private blinkFilters: OneEuroBank;

  private near = false;
  private lastSeenMs = -Infinity;
  private lockMissSinceMs = 0; // 락온 대상을 못 찾기 시작한 시각
  private lastFaces: RawFace[] = [];
  private lastTarget: { cx: number; cy: number; h: number } | null = null;
  private exprCandidate: Expression = "neutral";
  private exprSinceMs = 0;
  private expression: Expression = "neutral";
  private sig: FaceSignal = emptySignal();

  constructor(private cfg: Config) {
    const s = cfg.smoothing;
    this.fYaw = new OneEuro(s.headMinCutoff, s.headBeta, s.dCutoff);
    this.fPitch = new OneEuro(s.headMinCutoff, s.headBeta, s.dCutoff);
    this.fRoll = new OneEuro(s.headMinCutoff, s.headBeta, s.dCutoff);
    this.fBbox = new OneEuro(s.headMinCutoff, s.headBeta, s.dCutoff);
    this.fCx = new OneEuro(s.headMinCutoff, s.headBeta, s.dCutoff);
    this.blends = new OneEuroBank(s.blendMinCutoff, s.blendBeta, s.dCutoff);
    this.blinkFilters = new OneEuroBank(s.blinkMinCutoff, 0.5, s.dCutoff);
  }

  /** 오버레이에서 스무딩 값을 바꿨을 때 */
  applySmoothingParams(): void {
    const s = this.cfg.smoothing;
    for (const f of [this.fYaw, this.fPitch, this.fRoll, this.fBbox, this.fCx]) {
      f.minCutoff = s.headMinCutoff;
      f.beta = s.headBeta;
      f.dCutoff = s.dCutoff;
    }
    this.blends.setParams(s.blendMinCutoff, s.blendBeta, s.dCutoff);
    this.blinkFilters.setParams(s.blinkMinCutoff, 0.5, s.dCutoff);
  }

  /** 얼굴 중심이 락온 영역 안인가 (영역은 화면에 보이는 = 미러 반영 좌표) */
  private inZone(f: RawFace): boolean {
    const z = this.cfg.presence.lockZone;
    const x = this.cfg.camera.mirror ? 1 - f.bbox.cx : f.bbox.cx;
    return x >= z.x && x <= z.x + z.w && f.bbox.cy >= z.y && f.bbox.cy <= z.y + z.h;
  }

  /** 이미 잡힌 사람 유지 조건: 얼굴 박스가 영역에 조금이라도 걸쳐 있으면 OK (중심만 보면 경계 근처에서 계속 풀림) */
  private touchesZone(f: RawFace): boolean {
    const z = this.cfg.presence.lockZone;
    const x0 = this.cfg.camera.mirror ? 1 - f.bbox.x - f.bbox.w : f.bbox.x;
    return x0 < z.x + z.w && x0 + f.bbox.w > z.x && f.bbox.y < z.y + z.h && f.bbox.y + f.bbox.h > z.y;
  }

  /**
   * 락온. 한 명을 잡으면 그 사람이 락온 영역 안에 있는 동안 계속 유지한다 (뒤에 누가 들어와도 안 바뀜).
   * - 이어 추적: 직전 대상과 위치·크기가 가장 비슷한 얼굴
   * - 대상의 얼굴 박스가 영역에서 완전히 벗어나거나 안 보인 지 faceLostHoldMs 가 지나면 해제 → 영역 안에서 새로 찾음
   * - 새로 찾을 때: 영역 안 얼굴 중 '가까움(얼굴 크기) × 영역 중심에 가까움' 점수가 가장 높은 사람
   */
  private pickTarget(faces: RawFace[], nowMs: number, imageAspect: number): RawFace | null {
    const p = this.cfg.presence;
    if (this.lastTarget) {
      const lt = this.lastTarget;
      // Compare in pixel-isotropic coordinates (both axes / image height).
      // Raw normalized x is too strict for portrait footage and too loose
      // for landscape. After a brief occlusion allow bounded movement, not
      // an unrestricted switch to whichever face remains.
      const gap = Math.max(0, nowMs - this.lastSeenMs);
      const radius = Math.max(0.05, lt.h * (0.5 + Math.min(0.5, gap / 800)));
      const candidates = faces.map(f => {
        const ratio = f.bbox.h / lt.h;
        const distance = Math.hypot((f.bbox.cx - lt.cx) * imageAspect, f.bbox.cy - lt.cy);
        return { f, ratio, distance, score: distance / lt.h + Math.abs(Math.log(ratio)) * 0.25 };
      }).filter(c => c.ratio >= 0.65 && c.ratio <= 1.5 && c.distance < radius && this.touchesZone(c.f))
        .sort((a, b) => a.score - b.score);
      const match = candidates.length && (candidates.length === 1 || candidates[1].score - candidates[0].score > 0.2)
        ? candidates[0].f : null;
      if (match) {
        this.lockMissSinceMs = 0;
        this.lastTarget = { cx: match.bbox.cx, cy: match.bbox.cy, h: match.bbox.h };
        return match;
      }
      // 잠깐 놓친 동안은 다른 사람으로 바꾸지 않는다
      if (this.lockMissSinceMs === 0) this.lockMissSinceMs = nowMs;
      if (nowMs - this.lockMissSinceMs < p.faceLostHoldMs) return null;
      log.info("signal", "lock released (영역 이탈/소실)");
      this.lastTarget = null;
      this.lockMissSinceMs = 0;
    }
    const z = p.lockZone;
    const zcx = z.x + z.w / 2, zcy = z.y + z.h / 2, half = Math.hypot(z.w, z.h) / 2;
    let pick: RawFace | null = null, bestScore = -Infinity;
    for (const f of faces) {
      if (!this.inZone(f)) continue;
      const x = this.cfg.camera.mirror ? 1 - f.bbox.cx : f.bbox.cx;
      const dc = Math.min(1, Math.hypot(x - zcx, f.bbox.cy - zcy) / half);
      // Direct mimic chooses the largest visible face inside the operator's
      // zone. A centrality preference must not make a smaller bystander win.
      const score = p.mimicOnLock ? f.bbox.w * f.bbox.h
        : f.bbox.h * (1 - p.lockCenterWeight * dc);
      if (score > bestScore) {
        bestScore = score;
        pick = f;
      }
    }
    if (pick) {
      log.info("signal", `lock on h=${pick.bbox.h.toFixed(2)} cx=${pick.bbox.cx.toFixed(2)} (후보 ${faces.filter((f) => this.inZone(f)).length}명)`);
      this.lastTarget = { cx: pick.bbox.cx, cy: pick.bbox.cy, h: pick.bbox.h };
      this.lockMissSinceMs = 0;
    }
    return pick;
  }

  /** 오버레이(락온 영역 편집기) 표시용: 화면 좌표(미러 반영)의 얼굴 박스 */
  get debugFaces(): { x: number; y: number; w: number; h: number; locked: boolean; inZone: boolean }[] {
    const lt = this.lastTarget;
    return this.lastFaces.map((f) => ({
      x: this.cfg.camera.mirror ? 1 - f.bbox.x - f.bbox.w : f.bbox.x,
      y: f.bbox.y, w: f.bbox.w, h: f.bbox.h,
      locked: !!lt && Math.abs(f.bbox.cx - lt.cx) < 1e-6 && Math.abs(f.bbox.cy - lt.cy) < 1e-6,
      inZone: this.inZone(f),
    }));
  }

  /** 현재 대상 얼굴 (카메라 원본 좌표, 미러 전). 상반신 Pose 를 같은 사람으로 고를 때 사용 */
  get target(): { cx: number; cy: number; h: number } | null {
    return this.lastTarget;
  }

  update(track: TrackResult, nowMs: number, imageAspect = 1): FaceSignal {
    const t = nowMs / 1000;
    const p = this.cfg.presence;
    const mirror = this.cfg.camera.mirror ? -1 : 1;
    this.lastFaces = track.faces;
    const aspect = Number.isFinite(imageAspect) && imageAspect > 0 ? imageAspect : 1;
    const target = this.pickTarget(track.faces, nowMs, aspect);

    if (target) {
      this.lastSeenMs = nowMs;
      const yaw = this.fYaw.filter(target.yaw * mirror, t);
      const pitch = this.fPitch.filter(target.pitch, t);
      const roll = this.fRoll.filter(target.roll * mirror, t);
      // Preserve landscape distance tuning while using the short side for a
      // portrait source. Otherwise a locked portrait face can never enter
      // MIMIC at the same framing: its normalized height is much smaller.
      const shortSide = Math.min(1, aspect);
      const bboxH = this.fBbox.filter(target.bbox.h / shortSide, t);
      const cxRaw = this.cfg.camera.mirror ? 1 - target.bbox.cx : target.bbox.cx;
      const cx = this.fCx.filter(cxRaw, t);

      const blend: Record<string, number> = {};
      for (const k of USED_BLENDS) {
        // 눈 깜빡임은 100~200ms 로 짧아서 일반 표정 스무딩을 거치면 깎여 사라진다 → 빠른 필터 따로
        const bank = k.startsWith("eyeBlink") ? this.blinkFilters : this.blends;
        blend[k] = bank.filter(k, target.blend[k] ?? 0, t);
      }
      // 눈 뜬 정도(랜드마크) — 깜빡임용 빠른 필터. 이름을 Left/Right 로 끝내 아래 미러 교환에 같이 걸리게
      blend.__earLeft = this.blinkFilters.filter("__earLeft", target.eyes?.left ?? 0, t);
      blend.__earRight = this.blinkFilters.filter("__earRight", target.eyes?.right ?? 0, t);
      // 미러: 좌/우 blendshape 교환
      if (this.cfg.camera.mirror) swapLR(blend);
      blend.__geoOpenRaw = this.blends.filter("__geoOpen", target.mouth?.open ?? 0, t);
      blend.__geoCornerRaw = this.blends.filter("__geoCorner", target.mouth?.corner ?? 0, t);
      this.mouthRelative(blend, nowMs);

      // 접근 히스테리시스 + 화면 중앙 근처 조건
      const centered = Math.abs(cx - 0.5) <= p.centerToleranceX;
      // Acquisition still requires the center band. An acquired visitor
      // remains centered while their face overlaps it, avoiding edge chatter.
      const centeredHeld = Math.abs(cx - 0.5) <= p.centerToleranceX + target.bbox.w * 0.5;
      if (!this.near && bboxH >= p.enterBboxHeight && centered) this.near = true;
      else if (this.near && (bboxH <= p.exitBboxHeight || !centeredHeld)) this.near = false;

      this.sig = {
        present: true,
        near: this.near,
        bboxH,
        cx,
        yaw,
        pitch,
        roll,
        blend,
        expression: this.classify(blend, nowMs),
        faceCount: track.faces.length,
      };
    } else {
      // 얼굴 소실: faceLostHoldMs 동안은 마지막 값 유지(깜빡임 방지)
      const held = nowMs - this.lastSeenMs < p.faceLostHoldMs;
      if (!held) {
        this.near = false;
        this.lastTarget = null;
        this.resetFilters();
        this.sig = { ...emptySignal(), faceCount: 0 };
      } else {
        this.sig = { ...this.sig, faceCount: 0 };
      }
    }
    return this.sig;
  }

  private classify(b: Record<string, number>, nowMs: number): Expression {
    const e = this.cfg.expression;
    const smile = (b.mouthSmileLeft + b.mouthSmileRight) / 2;
    let cand: Expression = "neutral";
    if (b.jawOpen >= e.surpriseJaw && b.browInnerUp >= e.surpriseBrow) cand = "surprise";
    else if (smile >= e.smileThreshold) cand = "smile";

    if (cand !== this.exprCandidate) {
      this.exprCandidate = cand;
      this.exprSinceMs = nowMs;
    } else if (cand !== this.expression && nowMs - this.exprSinceMs >= e.dwellMs) {
      this.expression = cand;
      log.info("signal", `expression → ${cand}`);
    }
    return this.expression;
  }

  /**
   * 입 신호를 '이 사람의 무표정' 기준으로 바꾼다 (결과는 blend 의 __ 키로 → mapping.ts).
   * MediaPipe 는 입을 다물어도 jawOpen 0.1~0.2, 사람에 따라 mouthSmile 0.1~0.3 이 늘 남고,
   * mouthFrown 은 입꼬리를 내려도 0.1 안팎이라 고정 문턱으로는 '벌림 오인식 / 시무룩 불가'가 생긴다.
   *  - 벌림 = (jawOpen − mouthClose) 의 기준선 초과분 (기준선: 내려갈 땐 빠르게, 올라갈 땐 천천히)
   *  - 미소 = mouthSmile 의 기준선 초과분 / 시무룩 = 기준선보다 미소가 줄어든 만큼 + mouthFrown 초과분
   */
  private mouthBase: {
    open: number; smile: number; frown: number; puck: number; gOpen: number; gCorner: number; eyeL?: number; eyeR?: number;
  } | null = null;
  private mouthBaseT = 0;
  private mouthRelative(b: Record<string, number>, nowMs: number): void {
    const open = Math.max(0, (b.jawOpen ?? 0) - (b.mouthClose ?? 0));
    const smile = ((b.mouthSmileLeft ?? 0) + (b.mouthSmileRight ?? 0)) / 2;
    const frown = ((b.mouthFrownLeft ?? 0) + (b.mouthFrownRight ?? 0)) / 2;
    const puck = Math.max(b.mouthPucker ?? 0, b.mouthFunnel ?? 0);
    const dt = this.mouthBaseT ? Math.min(0.2, (nowMs - this.mouthBaseT) / 1000) : 0;
    this.mouthBaseT = nowMs;
    const gOpen = b.__geoOpenRaw ?? 0, gCorner = b.__geoCornerRaw ?? 0;
    // 입꼬리 기준선은 첫 프레임이 아니라 실측 무표정 값에서 시작 (화면에 들어오는 순간은 고개를 숙이고 있어 값이 틀어짐)
    if (!this.mouthBase) this.mouthBase = { open, smile, frown, puck, gOpen, gCorner: this.cfg.mapping.cornerNeutral };
    const mb = this.mouthBase, tau = this.cfg.mapping.mouthBaselineSec;
    const follow = (cur: number, v: number, upTau: number, downTau: number) =>
      cur + (v - cur) * Math.min(1, dt / (v > cur ? upTau : downTau));
    mb.open = follow(mb.open, open, tau * 2, 0.6);   // 다문 상태(낮은 값)를 빨리 학습
    mb.smile = follow(mb.smile, smile, tau, tau);
    mb.frown = follow(mb.frown, frown, tau * 2, 1.0);
    mb.puck = follow(mb.puck, puck, tau * 2, 0.6);
    mb.gOpen = follow(mb.gOpen, gOpen, tau * 2, 0.6);      // 다문 입(최소) 빨리 학습
    // 무표정 입꼬리 높이: 웃거나 시무룩한 채로 오래 있어도 기준이 끌려가지 않게, 기준에서 먼 값은 거의 안 따라감
    const cornerDev = Math.abs(gCorner - mb.gCorner);
    mb.gCorner = follow(mb.gCorner, gCorner, tau * (1 + cornerDev * 60), tau * (1 + cornerDev * 60));
    b.__geoOpen = Math.max(0, gOpen - mb.gOpen);
    b.__geoCorner = gCorner - mb.gCorner;
    b.__mouthOpen = Math.max(0, open - mb.open);
    b.__smileRel = Math.max(0, smile - mb.smile);
    b.__frownRel = Math.max(0, frown - mb.frown) + Math.max(0, mb.smile - smile) * 0.8;
    b.__puckerRel = Math.max(0, puck - mb.puck);
    // 오버레이 표시용 (원값/기준선)
    b.__dbgOpenRaw = gOpen;
    b.__dbgOpenBase = mb.gOpen;

    // 눈: 랜드마크 눈꺼풀 간격(EAR)으로 눈마다 따로 판정 (블렌드셰이프는 양쪽이 같이 움직여 윙크 구분이 안 됨).
    // '뜬 눈' 기준선 = 이 사람의 평소 간격 (올라갈 땐 빠르게, 내려갈 땐 아주 천천히 → 감고 있어도 기준이 안 내려감).
    // 감김 0~1 = 기준 대비 줄어든 비율 (기준의 45% 이하로 줄면 1)
    for (const side of ["Left", "Right"] as const) {
      const ear = b[`__ear${side}`] ?? 0;
      const key = side === "Left" ? "eyeL" : "eyeR";
      const base = mb[key] === undefined ? ear : follow(mb[key]!, ear, 0.4, tau * 4);
      mb[key] = base;
      b[`__blinkRel${side}`] = base > 1e-4 ? Math.min(1, Math.max(0, (base - ear) / (base * 0.55))) : 0;
    }
  }

  private resetFilters(): void {
    this.mouthBase = null;
    this.blinkFilters.reset();
    for (const f of [this.fYaw, this.fPitch, this.fRoll, this.fBbox, this.fCx]) f.reset();
    this.blends.reset();
  }
}

function swapLR(b: Record<string, number>): void {
  for (const k of Object.keys(b)) {
    if (k.endsWith("Left")) {
      const r = k.slice(0, -4) + "Right";
      if (r in b) {
        const tmp = b[k];
        b[k] = b[r];
        b[r] = tmp;
      }
    }
  }
}

export function emptySignal(): FaceSignal {
  return {
    present: false,
    near: false,
    bboxH: 0,
    cx: 0.5,
    yaw: 0,
    pitch: 0,
    roll: 0,
    blend: {},
    expression: "neutral",
    faceCount: 0,
  };
}
