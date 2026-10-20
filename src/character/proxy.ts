import * as THREE from "three";
import type { Config } from "../config";
import type { State, StateSnapshot } from "../state";
import { NEUTRAL_PARAMS, type CharacterParams } from "./mapping";
import type { BodyPose } from "../body";

/**
 * 프록시 캐릭터 — 도형으로 만든 얼굴. 로직 검증용이며 그래픽 합류 시 교체된다.
 * 교체 시 지켜야 할 것: `apply(params)` / `setState(snapshot)` 인터페이스. 내부 메시 구조는 자유.
 */
export interface CharacterRig {
  readonly root: THREE.Object3D;
  /** body: 상반신 신호(없으면 null). 프록시는 무시한다 */
  apply(p: CharacterParams, dtSec: number, timeSec: number, body?: BodyPose | null): void;
  setState(s: StateSnapshot): void;
}

const C = {
  skin: 0xf3f1ec,
  dark: 0x1e1e24,
  mouth: 0xd9534f,
  cheek: 0xf7b2b2,
  scarf: 0xc0392b,
};

export class ProxyCharacter implements CharacterRig {
  readonly root = new THREE.Group();
  private head = new THREE.Group();
  private eyeL: THREE.Mesh;
  private eyeR: THREE.Mesh;
  private lidL: THREE.Mesh;
  private lidR: THREE.Mesh;
  private browL: THREE.Mesh;
  private browR: THREE.Mesh;
  private mouth: THREE.Mesh;
  private cheekL: THREE.Mesh;
  private cheekR: THREE.Mesh;
  private body: THREE.Mesh;

  // 상태 연출용
  private state: State = "IDLE";
  private progress = 0;
  private stateElapsedMs = 0;
  private nextBlinkAt = 0;
  private autoBlink = 0;
  private cur: CharacterParams = { ...NEUTRAL_PARAMS };

  constructor(private cfg: Config["character"]) {
    const skin = new THREE.MeshStandardMaterial({ color: C.skin, roughness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: C.dark, roughness: 0.6 });
    const mouthMat = new THREE.MeshStandardMaterial({ color: C.mouth, roughness: 0.7 });
    const cheekMat = new THREE.MeshStandardMaterial({ color: C.cheek, roughness: 1, transparent: true, opacity: 0.0 });

    // 머리
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), skin);
    headMesh.scale.set(1, 1.05, 0.95);
    this.head.add(headMesh);

    // 귀(곰)
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 16), skin);
      ear.position.set(0.72 * sx, 0.85, -0.1);
      this.head.add(ear);
    }

    // 눈 + 눈꺼풀(스케일 y 로 감김 표현)
    const eyeGeo = new THREE.SphereGeometry(0.13, 24, 16);
    this.eyeL = new THREE.Mesh(eyeGeo, dark);
    this.eyeR = new THREE.Mesh(eyeGeo, dark);
    this.eyeL.position.set(-0.32, 0.18, 0.88);
    this.eyeR.position.set(0.32, 0.18, 0.88);
    const lidGeo = new THREE.SphereGeometry(0.16, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    this.lidL = new THREE.Mesh(lidGeo, skin);
    this.lidR = new THREE.Mesh(lidGeo, skin);
    this.lidL.position.copy(this.eyeL.position);
    this.lidR.position.copy(this.eyeR.position);
    this.head.add(this.eyeL, this.eyeR, this.lidL, this.lidR);

    // 눈썹
    const browGeo = new THREE.BoxGeometry(0.28, 0.06, 0.06);
    this.browL = new THREE.Mesh(browGeo, dark);
    this.browR = new THREE.Mesh(browGeo, dark);
    this.browL.position.set(-0.32, 0.46, 0.86);
    this.browR.position.set(0.32, 0.46, 0.86);
    this.head.add(this.browL, this.browR);

    // 코
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), dark);
    nose.position.set(0, -0.02, 0.98);
    this.head.add(nose);

    // 입: 타원 — scale.x 로 웃음 폭, scale.y 로 벌림
    this.mouth = new THREE.Mesh(new THREE.CircleGeometry(0.16, 32), mouthMat);
    this.mouth.position.set(0, -0.36, 0.93);
    this.mouth.scale.set(1.4, 0.35, 1);
    this.head.add(this.mouth);

    // 볼
    this.cheekL = new THREE.Mesh(new THREE.CircleGeometry(0.14, 24), cheekMat);
    this.cheekR = new THREE.Mesh(new THREE.CircleGeometry(0.14, 24), cheekMat.clone());
    this.cheekL.position.set(-0.58, -0.12, 0.8);
    this.cheekR.position.set(0.58, -0.12, 0.8);
    this.cheekL.rotation.y = -0.5;
    this.cheekR.rotation.y = 0.5;
    this.head.add(this.cheekL, this.cheekR);

    // 목도리 + 몸
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.18, 12, 32), new THREE.MeshStandardMaterial({ color: C.scarf, roughness: 0.9 }));
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = -1.05;
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 1.2, 8, 24), skin);
    this.body.position.y = -2.05;

    this.head.position.y = 0;
    this.root.add(this.head, scarf, this.body);
    this.root.visible = false;
  }

  setState(s: StateSnapshot): void {
    this.state = s.state;
    this.progress = s.progress;
    this.stateElapsedMs = s.elapsedMs;
  }

  apply(p: CharacterParams, dtSec: number, timeSec: number): void {
    // 파라미터는 약간의 추종(lerp)으로 한 번 더 부드럽게 — 스무딩 본체는 signals.ts
    const k = 1 - Math.exp(-dtSec * 18);
    for (const key of Object.keys(this.cur) as (keyof CharacterParams)[]) {
      this.cur[key] += (p[key] - this.cur[key]) * k;
    }
    const c = this.cur;

    // 상태별 가시성·연출
    const visibleStates: State[] = ["ATTRACT", "ENTER", "MIMIC", "EXIT"];
    this.root.visible = visibleStates.includes(this.state);

    let baseY = 0;
    let scale = 1;
    if (this.state === "ENTER") {
      const e = easeOutBack(this.progress);
      baseY = (1 - e) * -3.5;
      scale = 0.6 + 0.4 * e;
    } else if (this.state === "EXIT") {
      const e = easeInCubic(this.progress);
      baseY = e * -3.5;
    } else if (this.state === "ATTRACT") {
      // 빼꼼: 아래에서 올라왔다 내려갔다
      const ph = (this.stateElapsedMs / 1000) % 4;
      const up = ph < 1.2 ? easeOutBack(ph / 1.2) : ph < 2.8 ? 1 : Math.max(0, 1 - (ph - 2.8) / 1.2);
      baseY = -3.0 + 2.2 * up;
    }

    // 호흡
    const breath = Math.sin(timeSec * Math.PI * 2 * this.cfg.idleBreathHz) * this.cfg.idleBreathAmp;
    this.root.position.y = baseY;
    this.root.scale.setScalar(scale * (1 + breath));

    // 머리 회전 (미믹 중에만 입력, 그 외엔 서서히 0)
    const mimic = this.state === "MIMIC" || this.state === "ENTER";
    const ty = mimic ? c.headYaw : 0;
    const tx = mimic ? c.headPitch : Math.sin(timeSec * 0.7) * 0.04;
    const tz = mimic ? c.headRoll : 0;
    this.head.rotation.y += (ty - this.head.rotation.y) * k;
    this.head.rotation.x += (tx - this.head.rotation.x) * k;
    this.head.rotation.z += (tz - this.head.rotation.z) * k;

    // 자동 깜빡임 (입력 없을 때도 살아있게)
    if (timeSec >= this.nextBlinkAt) {
      this.nextBlinkAt = timeSec + this.cfg.autoBlinkMinSec + Math.random() * (this.cfg.autoBlinkMaxSec - this.cfg.autoBlinkMinSec);
      this.autoBlink = 1;
    }
    this.autoBlink = Math.max(0, this.autoBlink - dtSec * 7);
    const blinkAuto = this.autoBlink > 0.5 ? (1 - this.autoBlink) * 2 : this.autoBlink * 2;
    const bl = Math.max(mimic ? c.blinkL : 0, blinkAuto);
    const br = Math.max(mimic ? c.blinkR : 0, blinkAuto);
    this.lidL.scale.y = 0.05 + bl * 1.3;
    this.lidR.scale.y = 0.05 + br * 1.3;
    this.lidL.rotation.x = Math.PI; // 위에서 내려오는 눈꺼풀
    this.lidR.rotation.x = Math.PI;
    const wide = mimic ? 1 + c.eyeWide * 0.35 : 1;
    this.eyeL.scale.setScalar(wide);
    this.eyeR.scale.setScalar(wide);

    // 눈썹
    const bu = mimic ? c.browUp : 0;
    this.browL.position.y = 0.46 + bu * 0.12;
    this.browR.position.y = 0.46 + bu * 0.12;
    this.browL.rotation.z = 0.15 - bu * 0.25;
    this.browR.rotation.z = -0.15 + bu * 0.25;

    // 입: 웃음은 가로로 늘리고 위로, 벌림은 세로
    const sm = mimic ? c.smile : 0;
    const jaw = mimic ? c.jawOpen : 0;
    const pk = mimic ? c.pucker : 0;
    this.mouth.scale.x = 1.4 + sm * 0.7 - pk * 0.9;
    this.mouth.scale.y = 0.35 + jaw * 1.6 + pk * 0.4;
    this.mouth.position.y = -0.36 + sm * 0.05 - jaw * 0.12;

    // 볼: 웃을 때 홍조
    const cheekOp = Math.max(0, sm) * 0.8 + (mimic ? c.cheek * 0.6 : 0);
    (this.cheekL.material as THREE.MeshStandardMaterial).opacity = cheekOp;
    (this.cheekR.material as THREE.MeshStandardMaterial).opacity = cheekOp;
  }
}

function easeOutBack(t: number): number {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
function easeInCubic(t: number): number {
  return t * t * t;
}
