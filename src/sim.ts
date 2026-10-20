import * as THREE from "three";
import type { Config } from "./config";
import { emptySignal, type FaceSignal } from "./signals";
import type { BodyPose, V3 } from "./body";
import { standingWavePose } from './standingWave';

/**
 * `?sim=1` — 웹캠 없이 캐릭터·FSM 을 확인하는 시뮬레이터. 카메라/트래커를 건너뛰고 FaceSignal 을 직접 만든다.
 *   마우스 위치 → yaw/pitch, 휠 → roll
 *   키(누르고 있는 동안): s 웃음 · o 입 벌림 · p 오므림 · b 눈 감기 · l/r 한쪽 눈 · f 찡그림 · u 눈썹 올림 · a 눈썹 내림 · c 볼 부풀림
 *   상반신: 1 캐릭터 왼팔(화면 오른쪽) 들기 · 2 오른팔(화면 왼쪽) 들기 · 3 만세 · 4 손 흔들기 · 5 팔 앞으로
 *           q/e 몸 기울이기 · z/x 몸 비틀기 · 0 상반신 신호 끄기/켜기
 *   n: 사람 있음/없음 토글 (ENTER/EXIT/ATTRACT 확인)
 * 값은 signals.ts 출력과 같은 의미(미러 반영 후, deg / blendshape 0~1)라서 mapping.ts 를 그대로 탄다.
 */
export class SimInput {
  private keys = new Set<string>();
  private mx = 0;
  private my = 0;
  private roll = 0;
  private present = true;
  private bodyOn = true;
  private level: Record<string, number> = {};
  private armDemo = new URLSearchParams(location.search).get("armdemo") === "1";
  private waveDemo = new URLSearchParams(location.search).get("armdemo") === "wave";
  private waveStart: number | null = null;

  constructor(private cfg: Config) {
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (k === "n") this.present = !this.present;
      else if (k === "0") this.bodyOn = !this.bodyOn;
      else this.keys.add(k);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => this.keys.clear());
    window.addEventListener("pointermove", (e) => {
      if(this.waveDemo)return;
      this.mx = (e.clientX / window.innerWidth) * 2 - 1;
      this.my = (e.clientY / window.innerHeight) * 2 - 1;
    });
    window.addEventListener("wheel", (e) => {
      this.roll = Math.max(-25, Math.min(25, this.roll + Math.sign(e.deltaY) * 2));
    });
  }

  /** 외부(테스트·콘솔)에서 표정 강제: __mimic.sim.set({ s: 1 }) */
  set(v: Record<string, number>): void {
    Object.assign(this.level, v);
  }

  private ease = 0;
  private level_(k: string, ease: number): number {
    const target = this.keys.has(k) ? 1 : 0;
    const cur = this.level[`_${k}`] ?? 0;
    const next = cur + (target - cur) * ease;
    this.level[`_${k}`] = next;
    return Math.max(next, this.level[k] ?? 0);
  }

  /** 상반신 시뮬레이션 (캐릭터 공간, m). update() 다음에 호출 */
  body(timeSec: number): BodyPose | null {
    if (!this.present || !this.bodyOn) return null;
    if(this.waveDemo){
      this.waveStart ??= timeSec;
      const t=timeSec-this.waveStart;
      const a=Math.min(1,t/1.5),lift=a*a*(3-2*a);
      return standingWavePose(t,lift);
    }
    const lv = (k: string) => this.level_(k, this.ease);
    const R = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, (lv("x") - lv("z")) * 0.5, (lv("e") - lv("q")) * 0.35, "YXZ"),
    );
    const dir = (side: number, theta: number, phi: number) =>
      new THREE.Vector3(side * Math.sin(theta) * Math.cos(phi), -Math.cos(theta), Math.sin(theta) * Math.sin(phi));
    const arm = (side: 1 | -1) => {
      const up = side > 0 ? lv("1") : lv("2");
      const cheer = lv("3"), fwd = lv("5"), wave = side < 0 ? lv("4") : 0;
      let thU = 0.15 + up * 2.3 + cheer * 2.75, phU = 0.1 + fwd * 1.4;
      thU = Math.min(2.95, thU + fwd * 1.35);
      let thF = thU, phF = phU;
      if (this.armDemo) {
        // Continuous independent shoulder and elbow inputs through the same live retargeter.
        thU = (Math.sin(timeSec * 0.55 + side * 0.6) + 1) * 1.35;
        phU = (Math.sin(timeSec * 0.3) + 1) * 0.35;
        thF = Math.min(3.05, thU + (Math.sin(timeSec * 0.9 + side) + 1) * 0.55);
        phF = phU;
      }
      if (wave > 0) {
        thU = thU + (2.4 - thU) * wave;
        thF = thF + (2.86+Math.sin(timeSec*2.5)*.08 - thF) * wave;
        phU = phU + (.08-phU)*wave;phF=phU;
      }
      const s = new THREE.Vector3(side * 0.18, 0.48, 0);
      const e = s.clone().add(dir(side, thU, phU).multiplyScalar(0.27));
      const w = e.clone().add(dir(side, thF, phF).multiplyScalar(0.25));
      const t = (v: THREE.Vector3): V3 => {
        const r = v.clone().applyQuaternion(R);
        return [r.x, r.y, r.z];
      };
      return { s: t(s), e: t(e), w: t(w) };
    };
    const L = arm(1), Rr = arm(-1);
    return {
      shoulderL: L.s, elbowL: L.e, wristL: L.w,
      shoulderR: Rr.s, elbowR: Rr.e, wristR: Rr.w,
      hipL: [0.1, 0, 0], hipR: [-0.1, 0, 0],
      armL: 1, armR: 1, hips: 1,
    };
  }

  update(dtSec: number): FaceSignal {
    if (!this.present) return emptySignal();
    const ease = 1 - Math.exp(-dtSec * 14);
    this.ease = ease;
    const lv = (k: string) => this.level_(k, ease);
    const smile = lv("s"), open = lv("o"), pucker = lv("p"), blink = lv("b");
    const bl = Math.max(blink, lv("l")), br = Math.max(blink, lv("r"));
    const frown = lv("f"), up = lv("u"), down = lv("a"), cheek = lv("c");

    const blend: Record<string, number> = {
      eyeBlinkLeft: bl, eyeBlinkRight: br,
      eyeWideLeft: up * 0.5, eyeWideRight: up * 0.5,
      jawOpen: open, mouthSmileLeft: smile, mouthSmileRight: smile,
      mouthFrownLeft: frown, mouthFrownRight: frown,
      mouthPucker: pucker, mouthFunnel: 0,
      browInnerUp: up, browDownLeft: down, browDownRight: down,
      browOuterUpLeft: up, browOuterUpRight: up, cheekPuff: cheek,
      eyeSquintLeft: 0, eyeSquintRight: 0,
    };
    const e = this.cfg.expression;
    const expression = open >= e.surpriseJaw && up >= e.surpriseBrow ? "surprise" : smile >= e.smileThreshold ? "smile" : "neutral";
    return {
      present: true,
      near: true,
      bboxH: 0.3,
      cx: 0.5,
      // 화면 오른쪽으로 마우스 → 캐릭터 기준으로도 화면 오른쪽을 봄
      yaw: this.mx * 35,
      pitch: this.my * 22,
      roll: this.roll,
      blend,
      expression,
      faceCount: 1,
    };
  }
}
