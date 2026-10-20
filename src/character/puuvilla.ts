import * as THREE from "three";
import type { Config } from "../config";
import type { State, StateSnapshot } from "../state";
import type { BodyPose, V3 } from "../body";
import { log } from "../logger";
import { NEUTRAL_PARAMS, type CharacterParams } from "./mapping";
import type { CharacterRig } from "./proxy";
import { fixInvertedWinding, parseObj, subdivide, toBufferGeometry, type PolyMesh } from "./subdivide";
import { fillMouthGroove, smoothDepth } from "./mouthRig";
import { bakeKnitShadow, bakeVertexColors, fitMuffler, loadFitted, loadMuffler, makeKnitMaterial, pca, type MufflerSrc } from "./outfit";
import { makeBodyMaterial, makeInkMaterial, makeScarfMaterial, type FaceUniforms, type FurUniforms } from "./puuvillaShaders";
import { StandingArmSurface } from "./standingArmSurface";
import { socketNormalProbes } from "./standingSocketNormals";
import { standingWaveMotion } from "../standingWave";
import { standingUpperDirection } from "./standingArmPose";

/**
 * 실제 푸빌라 3D (asset/PUUVILLA IP FINAL/3 3D FILE/푸빌라_3D/푸빌라_스카프_obj/pu_stand.obj).
 *
 * OBJ 에 본이 없으므로 로드 시 스키닝을 직접 만든다.
 *   root(엉덩이) ─ spine(허리) ─ chest(가슴) ─┬─ head
 *                                              ├─ upperL ─ foreL   (캐릭터 왼쪽 = +x)
 *                                              └─ upperR ─ foreR
 * - 허리 위는 사람 상반신(Pose)을 따라 한다: 몸통 회전 → spine/chest 에 나눠서, 팔 → upper/fore.
 * - 목 가중치는 스카프 안쪽(y 112~131cm)에서 블렌딩 → 이음매가 스카프에 가려짐.
 * - 입은 메쉬에 조형된 홈을 모프로 움직인다(mouthRig.ts). 눈·코는 head 본에 강체.
 *
 * 아래 ANATOMY 는 이 OBJ 좌표(cm, y-up, 정면 +z)에서 측정한 값 — 메쉬가 바뀌면 다시 잰다.
 */
const ANATOMY = {
  spine: new THREE.Vector3(0, 45, 0),
  chest: new THREE.Vector3(0, 88, 0),
  head: new THREE.Vector3(0, 126, 2),
  headCenter: new THREE.Vector3(0, 150, 0),
  shoulderL: new THREE.Vector3(30, 95, -1),
  elbowL: new THREE.Vector3(45, 76, -2),
  handL: new THREE.Vector3(59, 57, -2),
  neckBlend: [112, 131] as const,
  spineBlend: [30, 60] as const,
  chestBlend: [78, 100] as const,
  /** z≈0 단면에서 잰 몸통 반지름(y → r). 팔/몸통 가중치 구분에 사용 */
  torsoR: [[50, 36], [60, 37.5], [70, 37], [75, 35.5], [80, 31], [85, 27], [90, 23.5], [100, 23], [110, 24]] as [number, number][],
  mouth: { yMin: 124, yMax: 140, zMin: 20, xMax: 24 },
};

const B = { root: 0, spine: 1, chest: 2, head: 3, upperL: 4, foreL: 5, upperR: 6, foreR: 7 } as const;

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerpTable = (tab: [number, number][], x: number) => {
  if (x <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) {
    if (x <= tab[i][0]) {
      const [x0, y0] = tab[i - 1], [x1, y1] = tab[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return tab[tab.length - 1][1];
};

// 임시 객체
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _n = new THREE.Vector3();
const _m = new THREE.Matrix4(), _e = new THREE.Euler(0, 0, 0, "YXZ");
const _qIdle = new THREE.Quaternion(), _qIdleF = new THREE.Quaternion();
const ID = new THREE.Quaternion();
const vec = (p: V3) => new THREE.Vector3(p[0], p[1], p[2]);

interface ArmRig {
  side: 1 | -1;
  upper: THREE.Bone;
  fore: THREE.Bone;
  restUpper: THREE.Vector3; // chest 로컬 기준 위팔 방향
  restFore: THREE.Vector3;
  restPolar: number; // 아래 방향(-y)과의 각
  qUpper: THREE.Quaternion; // 스무딩된 현재값
  qFore: THREE.Quaternion;
  tUpper: THREE.Quaternion; // 이번 프레임 목표
  tFore: THREE.Quaternion;
}

/** 팔 분리 케이지의 관절 (pu_stand_arm.json — scripts/stand_arm_split.py). 앱 cm */
interface ArmJoints { R: { shoulder: number[]; elbow: number[]; hand: number[] }; L: { shoulder: number[]; elbow: number[]; hand: number[] } }
interface StandingRig { version: number; body: string; rest: number[][]; weights: number[][]; joints: ArmJoints; corrective?: number[][] }

/** Seat_A 리깅본 (public/models/seat.bin — dev/armsplit.html 이 만듦) */
interface SeatBone { name: string; parent: number; pos: number[]; follow?: { bone: number; frac: number } }
interface SeatRig { parts: PolyMesh[]; bones: SeatBone[]; skin: Map<string, [number[], number[]]>; armsFree: boolean; restIsIdle: boolean }
const posKey = (x: number, y: number, z: number) => `${Math.fround(x)},${Math.fround(y)},${Math.fround(z)}`;

/** seat.bin: [u32 헤더 길이][JSON][f32 몸 위치][u32 몸 면][u16×4 스킨 본][f32×4 스킨 가중치][눈L·눈R·코·입 각각 f32 위치 + u32 면] (각 덩어리 4바이트 정렬) */
async function loadSeat(url: string): Promise<SeatRig> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const len = new DataView(buf).getUint32(0, true);
  const h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len))) as {
    bones: SeatBone[]; body: { verts: number; tris: number }; parts: Record<string, { verts: number; tris: number }>;
    /** 팔이 몸에서 떨어진 바인드 (scripts/seat/gen_to_seat.py · arm_sweep.py) — 흔들 때·미믹 때 팔을 제대로 듦 */
    armsFree?: boolean;
    /** 바인드 자세가 곧 쉬는 자세(원본처럼 팔을 내린 채 닫은 팔, arm_sweep.py) → freeArmIdle* 회전 안 함 */
    restIsIdle?: boolean;
  };
  let off = 4 + ((len + 3) & ~3);
  const take = <T extends Float32Array | Uint32Array | Uint16Array>(C: new (b: ArrayBuffer) => T, n: number, bytes: number): T => {
    const a = new C(buf.slice(off, off + n * bytes));
    off += (n * bytes + 3) & ~3;
    return a;
  };
  const toPoly = (name: string, pos: Float32Array, idx: Uint32Array): PolyMesh => {
    // 위치가 같은 정점은 하나로 (원본 FBX 는 면마다 정점이 따로 — 안 합치면 법선이 면마다 꺾여 털이 갈라짐)
    const positions: number[][] = [], seen = new Map<string, number>(), remap = new Uint32Array(pos.length / 3);
    for (let i = 0; i < pos.length / 3; i++) {
      const k = posKey(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      let id = seen.get(k);
      if (id === undefined) { id = positions.length; seen.set(k, id); positions.push([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]); }
      remap[i] = id;
    }
    const faces: number[][] = [];
    for (let i = 0; i < idx.length; i += 3) faces.push([remap[idx[i]], remap[idx[i + 1]], remap[idx[i + 2]]]);
    return { name, positions, uvs: [], faces, faceUvs: faces.map(() => null) };
  };
  const bp = take(Float32Array, h.body.verts * 3, 4), bIdx = take(Uint32Array, h.body.tris * 3, 4);
  const bi = take(Uint16Array, h.body.verts * 4, 2), bw = take(Float32Array, h.body.verts * 4, 4);
  const skin = new Map<string, [number[], number[]]>();
  for (let v = 0; v < h.body.verts; v++) skin.set(posKey(bp[v * 3], bp[v * 3 + 1], bp[v * 3 + 2]), [Array.from(bi.subarray(v * 4, v * 4 + 4)), Array.from(bw.subarray(v * 4, v * 4 + 4))]);
  const parts = [toPoly("pu_body", bp, bIdx)];
  for (const [k, nm] of [["eyeL", "pu_eyes_L"], ["eyeR", "pu_eyes_R"], ["nose", "pu_nose"], ["mouth", "pu_mouth"]] as const) {
    const q = h.parts[k];
    parts.push(toPoly(nm, take(Float32Array, q.verts * 3, 4), take(Uint32Array, q.tris * 3, 4)));
  }
  return { parts, bones: h.bones, skin, armsFree: h.armsFree === true, restIsIdle: h.restIsIdle === true };
}

export class PuuvillaCharacter implements CharacterRig {
  readonly root = new THREE.Group();
  private model = new THREE.Group();
  private bones: THREE.Bone[];
  private arms: ArmRig[];
  private bodyMeshes: THREE.Mesh[] = [];
  private eyeL!: THREE.Mesh;
  private eyeR!: THREE.Mesh;
  private face: FaceUniforms;
  private fur: FurUniforms;
  private shellOffsets: THREE.IUniform<number>[] = [];
  private shellMeshes: THREE.Mesh[] = [];
  /** 의상별 메쉬 (오른쪽 아래 아이콘으로 전환) */
  private classicMeshes: THREE.Object3D[] = [];
  private xmasMeshes: THREE.Object3D[] = [];
  private inkOffset: THREE.IUniform<number> = { value: 1 };
  private scarfStripes: THREE.IUniform<number>;
  private scarfAngle: THREE.IUniform<number>;
  private torsoQ = new THREE.Quaternion();
  private mouthSeamY = 131.3;
  private mouthSeamK = 0.04;
  private headQ = new THREE.Quaternion();
  /** 머리 본 회전 중심 (모델 cm) — 눈·코·감은 눈 튜브를 머리 본 자식으로 붙일 때 기준 */
  private headPivot = ANATOMY.head.clone();
  /** Seat_A: 목(머리 회전 일부를 나눠 가짐) · 어깨 보조 본(어깨 회전의 분수를 따라감) */
  private seatNeck: THREE.Bone | null = null;
  private seatHelpers: { bone: THREE.Bone; src: THREE.Bone; frac: number }[] = [];
  /** 팔이 몸에서 떨어진 바인드(A포즈) — 쉬는 자세는 config.character.freeArmIdle*, 인사는 freeArmWave* */
  private armsFree = false;
  private restIsIdle = false;

  private state: State = "IDLE";
  private progress = 0;
  private stateElapsedMs = 0;
  private nextBlinkAt = 0;
  private autoBlink = 0;
  /** 눈 뜸/감음 판정(히스테리시스)과 0~1 전환 애니메이션 — 가이드처럼 '점 눈' 아니면 '‿' 둘 중 하나 */
  private eyeShut = [false, false];
  /** 감은 눈 '‿' — 가이드 3D 렌더처럼 털 위에 얹힌 반광택 튜브 (L, R) */
  private closedTubes: THREE.Mesh[] = [];
  private eyeAnim = [0, 0];
  private blushEnv = 0;
  private cur: CharacterParams = { ...NEUTRAL_PARAMS };
  /** 개발: 손 흔들기 강제 (0~1) — __mimic.character.debugWave = 1 */
  debugWave = 0;
  /** Development comparison; null keeps the normal raised-paw roll. */
  debugPawTurn: number | null = null;

  static async load(cfg: Config): Promise<PuuvillaCharacter> {
    const t0 = performance.now();
    // 크리스마스 의상 = 기존 서 있는 푸빌라 + 새 FBX 뜨개 목도리를 목에 맞춰 붙임 (sitBody 면 새 앉은 푸빌라 몸째로)
    // 기본 = 기존 서 있는 푸빌라 + 줄무늬 스카프
    const xmas = cfg.outfit.style === "christmas";
    if (xmas && cfg.outfit.seatBody) {
      const rig = await loadSeat(cfg.character.seatModelPath);
      const c = new PuuvillaCharacter(cfg, rig.parts, true, rig);
      loadMuffler(cfg.character.seatMufflerPath)
        .then(async (src) => {
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(src.pos), 3));
          if (src.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(src.uv), 2));
          g.setIndex(new THREE.BufferAttribute(new Uint32Array(src.index), 1));
          g.computeVertexNormals();
          const mc = cfg.outfit.muffler;
          await bakeVertexColors(g, mc.colorMap, mc.red, mc.cream);
          bakeKnitShadow(g, mc.red);
          c.addMufflerMesh(g);
        })
        .catch((e) => log.warn("character", `목도리 로드 실패: ${String(e)}`));
      log.info("character", `puuvilla(seat) ready bones=${rig.bones.length} ${(performance.now() - t0).toFixed(0)}ms`);
      return c;
    }
    const sit = xmas && cfg.outfit.sitBody;
    const path = sit ? cfg.character.sitModelPath : cfg.character.modelPath;
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    const parts = parseObj(await res.text());
    for (const p of parts) {
      if (fixInvertedWinding(p)) log.warn("character", `${p.name}: 면 방향이 안쪽으로 뒤집혀 있어 바로잡음`);
    }
    // 팔을 떼어 낸 케이지(scripts/stand_arm_split.py: pu_arm_R / pu_arm_L) 면 옆의 .json 에서 회전 중심·팔꿈치·손 위치를 읽음
    let armJoints: ArmJoints | null = null;
    if (parts.some((p) => /pu_arm_/i.test(p.name))) {
      try {
        const jr = await fetch(path.replace(/\.obj(\?.*)?$/, ".json"));
        if (jr.ok) armJoints = (await jr.json()) as ArmJoints;
      } catch { /* 없으면 ANATOMY 값 */ }
      log.info("character", `팔 분리 케이지: 관절 ${armJoints ? "파일" : "기본값"}`);
    }
    let standingRig: StandingRig | null = null;
    if (!sit && !armJoints && cfg.body.armRig === "connected") {
      const r = await fetch(cfg.body.armRigPath);
      if (!r.ok) throw new Error(`Standing rig: HTTP ${r.status}`);
      standingRig = await r.json() as StandingRig;
      const body = parts.find(p => p.name === standingRig!.body);
      if (standingRig.version !== 1 || !body || body.positions.length !== standingRig.rest.length ||
          standingRig.weights.length !== body.positions.length ||
          body.positions.some((p, i) => p.some((v, k) => Math.abs(v - standingRig!.rest[i][k]) > 0.0001))) {
        throw new Error("Standing rig does not match the original body mesh");
      }
    }
    const c = new PuuvillaCharacter(cfg, parts, sit, null, armJoints, standingRig);
    if (sit) {
      // 앉은 푸빌라: 목도리가 원래 그 몸에 맞게 만들어져 있어 맞추기 없이 그대로 (정점 색만 원본 텍스처에서)
      loadMuffler(cfg.character.sitMufflerPath)
        .then(async (src) => {
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(src.pos), 3));
          if (src.uv) g.setAttribute("uv", new THREE.BufferAttribute(src.uv, 2));
          g.setIndex(new THREE.BufferAttribute(src.index, 1));
          g.computeVertexNormals();
          const mc = cfg.outfit.muffler;
          await bakeVertexColors(g, mc.colorMap, mc.red, mc.cream);
          c.addMufflerMesh(g);
        })
        .catch((e) => log.warn("character", `목도리 로드 실패: ${String(e)}`));
      log.info("character", `puuvilla(sit) ready parts=${parts.map((p) => p.name).join(",")} ${(performance.now() - t0).toFixed(0)}ms`);
      return c;
    }
    if (xmas) {
      // 미리 맞춰 구운 목도리(muffler_fit.bin)가 있으면 그대로, 없으면 원본에서 그 자리에서 맞춤 (개발: ?refit=1 이면 항상 다시 맞춤)
      const refit = import.meta.env.DEV && new URLSearchParams(location.search).has("refit");
      const mc = cfg.outfit.muffler;
      (refit ? Promise.resolve(null) : loadFitted(mc.fittedPath).catch(() => null))
        .then(async (fitted) => {
          if (fitted) {
            c.addMufflerMesh(fitted);
            return;
          }
          await c.attachMuffler(await loadMuffler(mc.path));
        })
        .catch((e) => log.warn("character", `목도리 로드 실패: ${String(e)}`));
    }
    log.info("character", `puuvilla ready parts=${parts.map((p) => p.name).join(",")} ${(performance.now() - t0).toFixed(0)}ms`);
    return c;
  }

  /** 팔 분리 케이지의 팔 관절 (어깨·팔꿈치·손, 좌/우) — 팔 부품 가중치와 뼈 위치에 씀 */
  private armJoints: { side: 1 | -1; s: THREE.Vector3; e: THREE.Vector3; h: THREE.Vector3 }[] = [];
  /** 팔 부품 가늘게 하기: 정점마다 축 위 발(foot)과 반지름 벡터 (바인드 기준) — 들수록 radial 을 줄임 */
  private armSlim: { geo: THREE.BufferGeometry; side: 1 | -1; foot: Float32Array; radial: Float32Array; cur: number }[] = [];
  private connectedArms = false;
  private armSurface: StandingArmSurface | null = null;

  private constructor(private cfg: Config, parts: PolyMesh[], private sit = false, private seat: SeatRig | null = null, armJointsFile: ArmJoints | null = null, standingRig: StandingRig | null = null) {
    this.connectedArms = standingRig !== null;
    if (standingRig) this.armSurface = new StandingArmSurface(standingRig.joints);
    const ch = cfg.character, fc = cfg.face, fr = cfg.fur;
    const A = ANATOMY;

    // ── 스켈레톤 (bone.position 은 부모 기준) ──
    let skeleton: THREE.Skeleton;
    let head: THREE.Bone;
    if (seat) {
      // Seat_A: 파일의 뼈대 그대로 (회전 없음, 관절 위치만). 앱이 움직이는 본 = 몸(BodyHold) · 머리 · 양 어깨 · 양 팔꿈치
      const bs = seat.bones.map((sb) => { const bone = new THREE.Bone(); bone.name = sb.name; return bone; });
      seat.bones.forEach((sb, i) => {
        const v = new THREE.Vector3(...sb.pos);
        if (sb.parent >= 0) { bs[sb.parent].add(bs[i]); bs[i].position.copy(v).sub(new THREE.Vector3(...seat.bones[sb.parent].pos)); }
        else { bs[i].position.copy(v); this.model.add(bs[i]); }
      });
      const by = (n: string) => bs[seat.bones.findIndex((q) => q.name === n)];
      const J = (n: string) => new THREE.Vector3(...seat.bones.find((q) => q.name === n)!.pos);
      const body = by("BodyHold");
      // spine/chest 는 자리만 (가중치 없음) — 몸통 기울이기는 앉은 몸 전체가 돌게 되므로 안 씀
      const spine = new THREE.Bone(), chest = new THREE.Bone();
      body.add(spine); spine.add(chest);
      head = by("Head");
      this.bones = [body, spine, chest, head, by("L_Shoulder"), by("L_Elbow"), by("R_Shoulder"), by("R_Elbow")];
      this.seatNeck = by("Neck");
      this.seatHelpers = seat.bones.flatMap((sb, i) => (sb.follow ? [{ bone: bs[i], src: bs[sb.follow.bone], frac: sb.follow.frac }] : []));
      this.headPivot.copy(J("Head"));
      this.model.updateMatrixWorld(true);
      skeleton = new THREE.Skeleton(bs);
      const armRigSeat = (side: 1 | -1, sn: "L" | "R"): ArmRig => {
        const sp = J(sn + "_Shoulder"), e = J(sn + "_Elbow"), hd = J(sn + "_Hand");
        const restUpper = e.clone().sub(sp).normalize();
        return {
          side, upper: by(sn + "_Shoulder"), fore: by(sn + "_Elbow"), restUpper, restFore: hd.clone().sub(e).normalize(),
          restPolar: Math.acos(-restUpper.y), qUpper: new THREE.Quaternion(), qFore: new THREE.Quaternion(), tUpper: new THREE.Quaternion(), tFore: new THREE.Quaternion(),
        };
      };
      this.arms = [armRigSeat(1, "L"), armRigSeat(-1, "R")];
      this.armsFree = seat.armsFree;
      this.restIsIdle = seat.restIsIdle;
    } else {
      const mk = (world: THREE.Vector3, parentWorld: THREE.Vector3 | null) => {
        const b = new THREE.Bone();
        b.position.copy(world);
        if (parentWorld) b.position.sub(parentWorld);
        return b;
      };
      const mirrorX = (v: THREE.Vector3) => new THREE.Vector3(-v.x, v.y, v.z);
      const root = mk(new THREE.Vector3(), null);
      const spine = mk(A.spine, new THREE.Vector3());
      const chest = mk(A.chest, A.spine);
      head = mk(A.head, A.chest);
      // 팔 관절: 팔 분리 케이지면 파일 값(회전 중심 = 어깨 고리 안쪽), 아니면 ANATOMY
      const jointSource = standingRig?.joints ?? armJointsFile;
      const JL = jointSource ? { s: vec(jointSource.L.shoulder as V3), e: vec(jointSource.L.elbow as V3), h: vec(jointSource.L.hand as V3) } : { s: A.shoulderL.clone(), e: A.elbowL.clone(), h: A.handL.clone() };
      const JR = jointSource ? { s: vec(jointSource.R.shoulder as V3), e: vec(jointSource.R.elbow as V3), h: vec(jointSource.R.hand as V3) } : { s: mirrorX(A.shoulderL), e: mirrorX(A.elbowL), h: mirrorX(A.handL) };
      this.armJoints = [{ side: 1, ...JL }, { side: -1, ...JR }];
      if (armJointsFile) {
        // 팔이 몸통과 떨어진 닫힌 부품 → 바인드(내린 팔) = 쉬는 자세, 인사·미믹은 자유 팔 로직
        this.armsFree = true;
        this.restIsIdle = true;
      }
      const upperL = mk(JL.s, A.chest);
      const foreL = mk(JL.e, JL.s);
      const upperR = mk(JR.s, A.chest);
      const foreR = mk(JR.e, JR.s);
      root.add(spine);
      spine.add(chest);
      chest.add(head, upperL, upperR);
      upperL.add(foreL);
      upperR.add(foreR);
      this.bones = [root, spine, chest, head, upperL, foreL, upperR, foreR];
      this.model.add(root);
      this.model.updateMatrixWorld(true);
      skeleton = new THREE.Skeleton(this.bones);

      const armRig = (side: 1 | -1, upper: THREE.Bone, fore: THREE.Bone): ArmRig => {
        const J = side > 0 ? JL : JR;
        const s = J.s.clone(), e = J.e.clone(), h = J.h.clone();
        const restUpper = e.clone().sub(s).normalize();
        return {
          side, upper, fore, restUpper,
          restFore: h.clone().sub(e).normalize(),
          restPolar: Math.acos(-restUpper.y),
          qUpper: new THREE.Quaternion(),
          qFore: new THREE.Quaternion(),
          tUpper: new THREE.Quaternion(),
          tFore: new THREE.Quaternion(),
        };
      };
      this.arms = [armRig(1, upperL, foreL), armRig(-1, upperR, foreR)];

    }

    // ── 공유 uniform ──
    this.face = {
      uMouthL: { value: new THREE.Vector4() },
      uMouthO: { value: new THREE.Vector4() },
      uMouthLineA: { value: 1 },
      uMouthProjYaw: { value: 0 },
      uBlushA: { value: new THREE.Vector4() },
      uBrowA: { value: new THREE.Vector4() },
      uEyeA: { value: new THREE.Vector4() },
      uInkColor: { value: new THREE.Color(fc.inkColor) },
      uBlushColor: { value: new THREE.Color(fc.blushColor) },
    };
    this.fur = {
      uFurFreq: { value: fr.freq },
      uFurLean: { value: fr.lean },
      uFurThick: { value: fr.thickness },
      uFurBump: { value: fr.bumpCm },
      uFurTuftFreq: { value: 1 / fr.tuftCm },
      uFurMin: { value: fr.minDensity },
      uRootShade: { value: fr.rootShade },
      uFaceFurScale: { value: fr.faceFurScale },
      uOldScarf: { value: sit ? 0 : 1 },
      uEyeLPos: { value: new THREE.Vector3() },
      uEyeRPos: { value: new THREE.Vector3() },
      uEyeAxisL: { value: new THREE.Vector3(0, 0, 1) },
      uEyeAxisR: { value: new THREE.Vector3(0, 0, 1) },
      uEyeClose: { value: new THREE.Vector2() },
      uClosedEye: { value: new THREE.Vector4() },
      uNosePos: { value: new THREE.Vector3() },
      // 기존 메쉬 값. 앉은 메쉬는 코 부품 크기로 다시 잼, 눈은 몸 표면에 붙어 있어 털을 덜 걷음 (넓으면 회색 그늘 고리)
      uNoseHalf: { value: new THREE.Vector3(5.6, 3.6, 3.0) },
      uEyeClear: { value: sit ? new THREE.Vector2(0.9, 2.0) : new THREE.Vector2(1.3, 3.0) },
    };
    this.scarfStripes = { value: fc.scarfStripes };
    this.scarfAngle = { value: fc.scarfStripeAngle };

    const furColor = new THREE.Color(fr.color);
    const scarfMat = makeScarfMaterial(new THREE.Color(fc.scarfColor), this.scarfStripes, this.scarfAngle);
    // 눈·코: 가이드북 3D 렌더(44~52장)는 반광택 짙은 차콜 — 거울 반사·하이라이트 점이 없다
    const eyeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(fc.eyeColor), roughness: 0.5, metalness: 0, envMapIntensity: 0.25 });
    const noseMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(fc.noseColor), roughness: 0.62, metalness: 0, envMapIntensity: 0.35 });

    // 눈 중심/반지름 (케이지 bbox 기준) — 몸통 소켓 파기에 먼저 필요
    const eyes: { center: THREE.Vector3; r: number; axis: THREE.Vector3 }[] = [];
    for (const part of parts) {
      const nn = part.name.toLowerCase();
      if (!(nn.includes("eye") || nn.includes("ryes"))) continue;
      const bb = new THREE.Box3().setFromPoints(part.positions.map((q) => new THREE.Vector3(q[0], q[1], q[2])));
      const center = bb.getCenter(new THREE.Vector3());
      const size = bb.getSize(new THREE.Vector3());
      // 눈이 보이는 방향 = 머리 중심→눈 과 정면(+z) 의 중간 (관객은 정면에서 본다)
      const axis = center.clone().sub(A.headCenter).normalize().add(new THREE.Vector3(0, 0, 1)).normalize();
      center.addScaledVector(axis, fc.eyePushCm);
      eyes.push({ center, r: (Math.max(size.x, size.y) / 2) * fc.eyeScale, axis });
    }

    let bodyGeo: THREE.BufferGeometry | null = null;
    let sitMouth = false;
    let oldRing: THREE.Vector3[] = [];
    let ringW = 0;
    for (const part of parts) {
      const n = part.name.toLowerCase();
      // 앉은 메쉬 입선(검은 띠): 그리지 않고 입선 곡선 y = a + k·x² 만 재서 먹선 입 위치로 씀
      if (n.includes("mouth")) {
        let s0 = 0, s1 = 0, s2 = 0, t0 = 0, t1 = 0;
        for (const q of part.positions) {
          const x2 = q[0] * q[0];
          s0 += 1; s1 += x2; s2 += x2 * x2; t0 += q[1]; t1 += x2 * q[1];
        }
        const det = s0 * s2 - s1 * s1;
        if (Math.abs(det) > 1e-6) {
          this.mouthSeamK = (s0 * t1 - s1 * t0) / det;
          this.mouthSeamY = (t0 - this.mouthSeamK * s1) / s0;
        }
        sitMouth = true;
        continue;
      }
      // 앉은 메쉬는 이미 촘촘한 삼각형 (세분화 안 함)
      const geo = toBufferGeometry(subdivide(part, this.sit ? 0 : ch.subdivLevels));
      if (standingRig && part.name === standingRig.body) {
        // Subdivide scalar weights with the exact same topology and UV expansion as the body.
        // Position data, face indices and the original shoulder connection remain unchanged.
        const wg = toBufferGeometry(subdivide({ ...part, positions: standingRig.weights }, ch.subdivLevels));
        geo.setAttribute("connectedArmWeights", wg.getAttribute("position").clone());
        wg.dispose();
        const cg=toBufferGeometry(subdivide({...part,positions:standingRig.corrective??standingRig.weights.map(()=>[0,0,0])},ch.subdivLevels));
        geo.setAttribute('connectedArmCorrective',cg.getAttribute('position').clone());cg.dispose();
      }

      if (n.includes("eye") || n.includes("ryes") || n.includes("nose")) {
        // 강체: head 본의 자식. 지오메트리를 자기 중심으로 옮겨 깜빡임 스케일이 제자리에서 일어나게.
        const center = geo.boundingBox!.getCenter(new THREE.Vector3());
        geo.translate(-center.x, -center.y, -center.z);
        if (!n.includes("nose")) geo.scale(fc.eyeScale, fc.eyeScale, fc.eyeScale);
        const mesh = new THREE.Mesh(geo, n.includes("nose") ? noseMat : eyeMat);
        if (!n.includes("nose")) {
          const e = eyes.find((q) => Math.sign(q.center.x) === Math.sign(center.x));
          if (e) center.copy(e.center);
        }
        mesh.position.copy(center).sub(this.headPivot);
        head.add(mesh);
        if (n.includes("nose")) {
          this.fur.uNosePos.value.copy(center);
          if (this.sit) {
            const nsz = geo.boundingBox!.getSize(new THREE.Vector3());
            this.fur.uNoseHalf.value.set(nsz.x * 0.5 + 0.6, nsz.y * 0.5 + 0.6, nsz.z * 0.5 + 1.5);
          }
        }
        else {
          if (center.x > 0) {
            this.eyeL = mesh;
            this.fur.uEyeLPos.value.copy(center);
            // 감은 눈 곡선은 관객(정면)에서 찌그러지지 않게 거의 정면 평면에 그린다
            this.fur.uEyeAxisL.value.copy(eyes.find((q) => q.center.x > 0)?.axis ?? new THREE.Vector3(0, 0, 1)).lerp(new THREE.Vector3(0, 0, 1), 0.7).normalize();
          } else {
            this.eyeR = mesh;
            this.fur.uEyeRPos.value.copy(center);
            this.fur.uEyeAxisR.value.copy(eyes.find((q) => q.center.x < 0)?.axis ?? new THREE.Vector3(0, 0, 1)).lerp(new THREE.Vector3(0, 0, 1), 0.7).normalize();
          }
        }
        continue;
      }

      const isScarf = n.includes("scarlf") || n.includes("scarf");
      const isArm = /pu_arm_/.test(n);
      if (!isScarf && !isArm) {
        if (fc.eyeSocketCarve) carveEyeSockets(geo, eyes);
        // 메쉬의 입 홈은 메워서 지우고(가이드 3D 렌더엔 홈이 없음), 입은 전부 먹선으로 그린다
        const mi = this.sit
          ? { seamY: this.mouthSeamY, seamK: this.mouthSeamK, halfW: 4 }
          : fillMouthGroove(geo, { region: A.mouth });
        // 코가 붙는 자리 주변 주름이 코 아래 U자 그늘(수염처럼)로 보임 → 코 둘레 띠의 깊이를 고르게 (코에 가려지는 안쪽 포함)
        const noseP = parts.find((q) => q.name.toLowerCase().includes("nose"));
        if (noseP && !this.sit) {
          const nb = new THREE.Box3().setFromPoints(noseP.positions.map((q) => new THREE.Vector3(q[0], q[1], q[2])));
          const nc = nb.getCenter(new THREE.Vector3()), ns = nb.getSize(new THREE.Vector3());
          const rx = ns.x / 2, ry = ns.y / 2;
          const cnt = smoothDepth(geo, (x, y, z) => {
            if (z < 25) return 0;
            const e = Math.hypot(x / (rx * 1.15), (y - nc.y) / (ry * 1.6));
            // 입선(입 홈 메운 자리) 쪽으로는 내려가지 않게 — 내려가면 입선 위에 가로 턱이 생김
            const lower = smoothstep01(mi.seamY + 2.0, mi.seamY + 4.0, y);
            return (1 - smoothstep01(1.0, 2.0, e)) * lower;
          }, 60);
          log.info("character", `nose base smoothed: ${cnt} verts, nose ${rx.toFixed(1)}×${ry.toFixed(1)}cm @y${nc.y.toFixed(1)}`);
        }
        bodyGeo = geo;
        this.mouthSeamY = mi.seamY;
        this.mouthSeamK = mi.seamK;
      }
      // 앉은 메쉬는 팔이 몸 앞에 붙은 자세라 팔 본을 쓰지 않음 (몸통과 함께 움직임)
      if (seat && !isScarf) {
        // Seat_A: 파일 가중치 (정점 위치로 짝 맞춤 — toBufferGeometry 가 정점 순서를 바꿈)
        const pa = geo.getAttribute("position"), nv = pa.count, si4 = new Uint16Array(nv * 4), sw4 = new Float32Array(nv * 4);
        let miss = 0;
        for (let i = 0; i < nv; i++) {
          const w = seat.skin.get(posKey(pa.getX(i), pa.getY(i), pa.getZ(i)));
          if (w) { si4.set(w[0], i * 4); sw4.set(w[1], i * 4); } else { sw4[i * 4] = 1; miss++; }
        }
        geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si4, 4));
        geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw4, 4));
        if (miss) log.warn("character", `seat 가중치 못 찾은 정점 ${miss}`);
      } else if (isArm) {
        this.applySkinWeights(geo, 0, "arm");
        // 가늘게 하기용: 어깨→손 축에 대한 발·반지름 (서브디비전 뒤 지오메트리 기준)
        const pa = geo.getAttribute("position"), nv = pa.count;
        const foot = new Float32Array(nv * 3), radial = new Float32Array(nv * 3);
        const J = this.armJoints.find((q) => (n.includes("_r") ? q.side < 0 : q.side > 0)) ?? this.armJoints[0];
        const ax = J.h.clone().sub(J.s), L2 = ax.lengthSq();
        for (let i = 0; i < nv; i++) {
          _v2.fromBufferAttribute(pa, i);
          const t = L2 > 0 ? _v3.copy(_v2).sub(J.s).dot(ax) / L2 : 0;
          _v3.copy(J.s).addScaledVector(ax, t);
          foot.set([_v3.x, _v3.y, _v3.z], i * 3);
          radial.set([_v2.x - _v3.x, _v2.y - _v3.y, _v2.z - _v3.z], i * 3);
        }
        this.armSlim.push({ geo, side: J.side, foot, radial, cur: 1 });
      } else this.applySkinWeights(geo, isScarf ? (n.includes("main") ? 0.45 : 0.25) : 1, !isScarf && !this.sit && !this.armsFree);
      if (this.sit && !geo.getAttribute("aCavity")) {
        const nv = geo.getAttribute("position").count;
        geo.setAttribute("aCavity", new THREE.BufferAttribute(new Float32Array(nv), 1));
        geo.setAttribute("aLip", new THREE.BufferAttribute(new Float32Array(nv), 1));
        geo.setAttribute("aMouthIn", new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
      }

      if(geo.getAttribute('connectedArmWeights') && this.armSurface)
        this.armSurface.normalProbes.value=socketNormalProbes(geo);
      const add = (mat: THREE.Material, order: number) => {
        if (geo.getAttribute("connectedArmWeights")) this.armSurface?.attach(mat);
        const m = new THREE.SkinnedMesh(geo, mat);
        m.frustumCulled = false;
        m.renderOrder = order;
        this.model.add(m);
        m.bind(skeleton);
        if (!isScarf) this.bodyMeshes.push(m);
        return m;
      };

      if (isScarf) {
        this.classicMeshes.push(add(scarfMat, 1));
        // 목 고리 부분 (가장 넓은 스카프 조각) — 목도리 맞추는 기준
        const bbx = geo.boundingBox!;
        if (bbx.max.x - bbx.min.x > ringW) {
          ringW = bbx.max.x - bbx.min.x;
          const pa = geo.getAttribute("position");
          oldRing = [];
          for (let i = 0; i < pa.count; i += 3) oldRing.push(new THREE.Vector3().fromBufferAttribute(pa, i));
        }
      } else {
        add(makeBodyMaterial(furColor, this.face, this.fur, null), 0);
        for (let i = 1; i <= fr.shells; i++) {
          const h = i / fr.shells;
          const offset = { value: fr.lengthCm * h };
          this.shellOffsets.push(offset);
          const sm = add(makeBodyMaterial(furColor, this.face, this.fur, { h, offset }), 2 + i);
          (sm.material as THREE.MeshStandardMaterial).roughness = fr.roughness;
          this.shellMeshes.push(sm);
        }
        // 먹선 레이어 (털 끝 높이에 얹음)
        this.inkOffset.value = fr.lengthCm * 1.05; // 털 끝보다 살짝 위 (털 뭉치가 선을 파먹지 않게)
        add(makeInkMaterial(this.face, this.fur, this.inkOffset), 100);
      }
    }
    if (!this.eyeL || !this.eyeR) log.warn("character", "눈 메쉬를 찾지 못함 — OBJ 객체 이름 확인");
    if (bodyGeo) {
      const tubeMat = makeClosedEyeMaterial(eyeMat);
      for (const [pos, axis] of [[this.fur.uEyeLPos.value, this.fur.uEyeAxisL.value], [this.fur.uEyeRPos.value, this.fur.uEyeAxisR.value]] as const) {
        const tube = new THREE.Mesh(closedEyeTube(bodyGeo, pos, axis, fc, fr.lengthCm * fr.faceFurScale * 0.55), tubeMat);
        tube.position.copy(this.headPivot).negate();
        tube.visible = false;
        head.add(tube);
        this.closedTubes.push(tube);
      }
    }

    // 목도리 맞추기용 (attachMuffler)
    this.outfitBase = bodyGeo && (oldRing.length || this.sit) ? { body: bodyGeo, ring: oldRing, skeleton } : null;
    if (this.sit && !sitMouth) log.warn("character", "앉은 메쉬에 입선(pu_mouth) 없음 — 기본 입 위치");
    this.setOutfit(cfg.outfit.style);

    this.model.scale.setScalar(ch.modelScale);
    this.model.position.y = -ch.focusYcm * ch.modelScale;
    this.root.add(this.model);
    this.root.visible = ch.alwaysVisible;
  }

  /**
   * 정점별 스킨 가중치 (상위 4개만 남겨 정규화).
   * headScale: 머리 가중치 배율 (스카프는 머리를 덜 따라가게). arms=false 면 팔 가중치 없음.
   * headW: 머리 가중치를 높이(y) 대신 이 함수로 (앉은 메쉬 — 목도리 고리가 기울어 있어 고리 면 기준)
   */
  /** arms: true = 몸통 메쉬에서 열 확산으로 팔 가중치 / "arm" = 떼어 낸 팔 부품(전부 팔, 팔꿈치 위치로 위팔·아래팔 나눔) / false = 팔 없음 */
  private applySkinWeights(geo: THREE.BufferGeometry, headScale: number, arms: boolean | "arm", headW?: (p: THREE.Vector3) => number): void {
    const A = ANATOMY;
    const pos = geo.getAttribute("position");
    const n = pos.count;
    const idx = new Uint16Array(n * 4);
    const wts = new Float32Array(n * 4);
    const w = new Float32Array(8);
    const p = new THREE.Vector3();
    const order = [0, 1, 2, 3, 4, 5, 6, 7];
    const connected = geo.getAttribute("connectedArmWeights");
    const armW = arms === true && !connected ? this.diffuseArmWeights(geo) : null;
    const armPart = arms === "arm";

    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pos, i);
      w.fill(0);
      const side = p.x >= 0 ? 1 : -1;
      let wh = (headW ? headW(p) : smooth(A.neckBlend[0], A.neckBlend[1], p.y)) * headScale;
      let wa = armW ? armW.w[i] * (1 - wh) : 0;
      let tArm = armW ? armW.t[i] : 0;
      let wf = wa * smooth(0.42, 0.62, tArm);
      if (connected) {
        wa = Math.min(1, Math.max(0, connected.getX(i) + connected.getY(i))) * (1 - wh);
        wf = Math.min(wa, Math.max(0, connected.getZ(i)) * (1 - wh));
      }
      if (armPart) {
        // 팔 부품: 어깨→손 축 위치 t 로 위팔/아래팔. 팔꿈치 ±25% 구간에 걸쳐 섞음 → 각진 꺾임 대신 봉제인형 팔처럼 둥근 곡선으로 굽음
        const J = this.armJoints.find((q) => q.side === side) ?? this.armJoints[0];
        const ax = _v2.copy(J.h).sub(J.s), L2 = ax.lengthSq();
        tArm = L2 > 0 ? Math.min(1, Math.max(0, _v3.copy(p).sub(J.s).dot(ax) / L2)) : 0;
        const tE = L2 > 0 ? Math.sqrt(J.e.distanceToSquared(J.s) / L2) : 0.5;
        wh = 0; wa = 1; wf = smooth(tE - 0.25, tE + 0.25, tArm);
      }
      const rest = Math.max(0, 1 - wh - wa);
      const wsp = smooth(A.spineBlend[0], A.spineBlend[1], p.y);
      const wch = smooth(A.chestBlend[0], A.chestBlend[1], p.y);

      w[B.head] = wh;
      w[side > 0 ? B.upperL : B.upperR] = wa - wf;
      w[side > 0 ? B.foreL : B.foreR] = wf;
      w[B.root] = rest * (1 - wsp);
      w[B.spine] = rest * wsp * (1 - wch);
      w[B.chest] = rest * wsp * wch;

      order.sort((a, b) => w[b] - w[a]);
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += w[order[k]];
      for (let k = 0; k < 4; k++) {
        idx[i * 4 + k] = order[k];
        wts[i * 4 + k] = sum > 0 ? w[order[k]] / sum : k === 0 ? 1 : 0;
      }
    }
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(idx, 4));
    geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(wts, 4));
  }

  /**
   * 팔 가중치 (자동 리깅의 heat diffusion 방식).
   * - 확실한 팔(팔 캡슐 안쪽, 몸통 원기둥 바깥) = 1, 확실한 몸통 = 0 으로 고정
   * - 그 사이(겨드랑이~어깨 30cm 가량 붙어 있는 구간)는 메쉬 표면을 따라 반복 평균 → 부드러운 경사
   * 경계가 칼같이 끊기면 팔을 들 때 경계 삼각형이 길게 늘어나 '찢어진' 것처럼 보인다.
   * t = 어깨(0)→손(1) 방향 위치 (아래팔 가중치 분배용)
   */
  private diffuseArmWeights(geo: THREE.BufferGeometry): { w: Float32Array; t: Float32Array } {
    const A = ANATOMY;
    const pos = geo.getAttribute("position");
    const index = geo.getIndex()!;
    const n = pos.count;
    const t = new Float32Array(n);

    // 위치 기준 용접
    const gid = new Int32Array(n);
    const kmap = new Map<string, number>();
    const rep: number[] = [];
    for (let i = 0; i < n; i++) {
      const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
      let g = kmap.get(k);
      if (g === undefined) {
        g = rep.length;
        kmap.set(k, g);
        rep.push(i);
      }
      gid[i] = g;
    }
    const G = rep.length;

    // 고정값: 1(팔) / 0(몸통) / -1(자유)
    const fixed = new Float32Array(G);
    const wg = new Float32Array(G);
    const tg = new Float32Array(G);
    const p = new THREE.Vector3(), s = new THREE.Vector3(), h = new THREE.Vector3(), seg = new THREE.Vector3(), c = new THREE.Vector3();
    for (let g = 0; g < G; g++) {
      p.fromBufferAttribute(pos, rep[g]);
      const side = p.x >= 0 ? 1 : -1;
      s.set(A.shoulderL.x * side, A.shoulderL.y, A.shoulderL.z);
      h.set(A.handL.x * side, A.handL.y, A.handL.z);
      seg.subVectors(h, s);
      const ta = c.copy(p).sub(s).dot(seg) / seg.lengthSq();
      const tc = Math.min(1, Math.max(0, ta));
      const rA = p.distanceTo(c.copy(s).addScaledVector(seg, tc)) / (9 - 2.5 * tc);
      const rT = Math.hypot(p.x, p.z) / lerpTable(A.torsoR, p.y);
      tg[g] = ta;
      let f = -1;
      // 고정 구역을 넓게 잡아 '자유' 구간은 팔과 몸통이 맞붙은 겨드랑이 띠만 남긴다
      // (자유 구간이 길면 확산 결과가 팔 전체에 걸친 선형 경사가 되어 위팔이 몸통에 남는다)
      // 곰 팔은 앞뒤로 두꺼워(손 쪽 z ±11cm) 캡슐 반지름으로는 판정이 안 됨 → 몸통 원기둥 바깥이면 팔
      if (p.y > 106 || ta < -0.15 || rT < 0.95 || rA > 2.4) f = 0; // 확실한 몸통
      else if (rT > 1.08 && ta > 0.04) f = 1; // 확실한 팔
      fixed[g] = f;
      wg[g] = f < 0 ? 0.5 : f;
    }

    // 이웃 (그룹 단위)
    const nb: number[][] = Array.from({ length: G }, () => []);
    for (let k = 0; k < index.count; k += 3) {
      const a = gid[index.getX(k)], b = gid[index.getX(k + 1)], d = gid[index.getX(k + 2)];
      nb[a].push(b, d);
      nb[b].push(a, d);
      nb[d].push(a, b);
    }
    // 자유 정점만 반복 평균 (Jacobi). 겨드랑이 폭(~수십 정점)을 충분히 퍼지게
    const free: number[] = [];
    for (let g = 0; g < G; g++) if (fixed[g] < 0) free.push(g);
    let cur = wg, next = new Float32Array(wg);
    for (let it = 0; it < 600; it++) {
      for (const g of free) {
        const ns = nb[g];
        let sum = 0;
        for (const j of ns) sum += cur[j];
        next[g] = ns.length ? sum / ns.length : cur[g];
      }
      [cur, next] = [next, cur];
    }

    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // 부드러운 계단 한 번 더 → 팔 쪽은 확실히 1, 몸통 쪽은 확실히 0 에 가깝게
      w[i] = smooth(0.05, 0.95, cur[gid[i]]);
      t[i] = tg[gid[i]];
    }
    log.info("character", `arm weights: fixed arm=${[...fixed].filter((f) => f === 1).length} free=${free.length}`);
    return { w, t };
  }

  setState(s: StateSnapshot): void {
    this.state = s.state;
    this.progress = s.progress;
    this.stateElapsedMs = s.elapsedMs;
  }

  /** 오버레이에서 털/얼굴 값을 바꿨을 때 */
  private outfitBase: { body: THREE.BufferGeometry; ring: THREE.Vector3[]; skeleton: THREE.Skeleton } | null = null;

  /** 크리스마스 의상: 새 FBX(Puuvilla_V02)의 뜨개 목도리를 기존 목에 맞춰 붙임 */
  /** 원본(FBX 좌표)에서 맞춰서 붙임. 맞춘 지오메트리(rest cm + 정점 색)를 돌려줌 */
  async attachMuffler(src: MufflerSrc): Promise<THREE.BufferGeometry | null> {
    if (!this.outfitBase) return null;
    const t1 = performance.now();
    const mc = this.cfg.outfit.muffler;
    const mg = fitMuffler(src, this.outfitBase.body, this.outfitBase.ring, mc);
    await bakeVertexColors(mg, mc.colorMap, mc.red, mc.cream).catch((e) => log.warn("character", `목도리 색 텍스처 실패: ${String(e)}`));
    bakeKnitShadow(mg, mc.red);
    this.addMufflerMesh(mg);
    log.info("character", `muffler fitted ${mg.getAttribute("position").count} verts ${(performance.now() - t1).toFixed(0)}ms`);
    return mg;
  }

  /** 맞춘 목도리 지오메트리(rest cm)를 스키닝해서 붙임 */
  addMufflerMesh(mg: THREE.BufferGeometry): void {
    if (!this.outfitBase) return;
    const oc = this.cfg.outfit;
    this.xmasMeshes.forEach((o) => o.parent?.remove(o));
    this.xmasMeshes.length = 0;
    if (this.seat) {
      // Seat_A: 몸 가중치는 파일 그대로. 목도리 = 고리 면(PCA) 위쪽은 목 본(머리 회전의 일부를 따라감), 아래·끝자락은 몸
      const mp = mg.getAttribute("position");
      const ys: number[] = [];
      for (let i = 0; i < mp.count; i++) ys.push(mp.getY(i));
      ys.sort((a, b) => a - b);
      const yq = ys[Math.floor(ys.length * 0.6)];
      const ring: THREE.Vector3[] = [];
      for (let i = 0; i < mp.count; i += 3) if (mp.getY(i) > yq) ring.push(new THREE.Vector3().fromBufferAttribute(mp, i));
      const pl = pca(ring);
      const names = this.outfitBase.skeleton.bones.map((b) => b.name);
      const iNeck = names.indexOf("Neck"), iBody = names.indexOf("BodyHold");
      const si4 = new Uint16Array(mp.count * 4), sw4 = new Float32Array(mp.count * 4), q = new THREE.Vector3();
      for (let i = 0; i < mp.count; i++) {
        const w = smooth(-6, 3, q.fromBufferAttribute(mp, i).sub(pl.c).dot(pl.n));
        si4[i * 4] = iNeck; sw4[i * 4] = w;
        si4[i * 4 + 1] = iBody; sw4[i * 4 + 1] = 1 - w;
      }
      mg.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si4, 4));
      mg.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw4, 4));
    } else if (this.sit) {
      // 앉은 메쉬: 목도리 고리가 뒤쪽이 높게 ~33° 기울어 있음 → 높이(y)로 목 가중치를 주면 고리 앞뒤가 다르게 돌아
      // 고개를 돌릴 때 고리가 비틀려 옆으로 날개처럼 튀어나옴. 고리 면(PCA)을 기준으로:
      //  몸 = 고리 면 위는 머리, 아래는 몸통 (경계는 목도리 두께 안에서 섞임 → 이음매가 목도리에 가려짐)
      //  목도리 고리 = 머리를 일정하게 조금만 따라감 (강체처럼, 안 비틀림), 늘어진 끝자락(앞쪽 y<114) = 몸통
      const mp = mg.getAttribute("position");
      const ring: THREE.Vector3[] = [];
      for (let i = 0; i < mp.count; i++) if (mp.getY(i) > 114) ring.push(new THREE.Vector3().fromBufferAttribute(mp, i));
      const pl = pca(ring);
      const d = new THREE.Vector3();
      const bodyW = (q: THREE.Vector3) => smooth(-6, 4, d.copy(q).sub(pl.c).dot(pl.n));
      for (const g of new Set(this.bodyMeshes.map((m) => m.geometry))) {
        this.applySkinWeights(g, 1, false, bodyW);
        g.getAttribute("skinIndex").needsUpdate = true;
        g.getAttribute("skinWeight").needsUpdate = true;
      }
      this.applySkinWeights(mg, oc.muffler.headFollow, false, (q) => smooth(102, 114, q.y));
    } else this.applySkinWeights(mg, 0.45, false);
    // 목도리 밑 몸 털은 눕힘(aCover) — 안 하면 목도리 사이·가장자리로 흰 털이 삐져나옴
    {
      const mp = mg.getAttribute("position");
      const grid = new Map<string, number[]>();
      const CELL = 3;
      const key = (x: number, y: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
      for (let i = 0; i < mp.count; i++) {
        const k = key(mp.getX(i), mp.getY(i), mp.getZ(i));
        const a = grid.get(k);
        if (a) a.push(i);
        else grid.set(k, [i]);
      }
      for (const g of new Set(this.bodyMeshes.map((m) => m.geometry))) {
        const bp = g.getAttribute("position");
        const cov = new Float32Array(bp.count);
        for (let i = 0; i < bp.count; i++) {
          const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
          let best = 1e9;
          const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), cz = Math.floor(z / CELL);
          for (let a = -1; a <= 1; a++)
            for (let b = -1; b <= 1; b++)
              for (let c = -1; c <= 1; c++) {
                const l = grid.get(`${cx + a},${cy + b},${cz + c}`);
                if (l) for (const j of l) best = Math.min(best, (mp.getX(j) - x) ** 2 + (mp.getY(j) - y) ** 2 + (mp.getZ(j) - z) ** 2);
              }
          cov[i] = 1 - smooth(2.5, 5, Math.sqrt(best));
        }
        g.setAttribute("aCover", new THREE.BufferAttribute(cov, 1));
      }
    }
    const mm = new THREE.SkinnedMesh(mg, makeKnitMaterial(oc.muffler));
    mm.frustumCulled = false;
    mm.renderOrder = 1;
    this.model.add(mm);
    // 나중에 붙이므로 bindMatrix 를 넘김 — 안 넘기면 지금 자세로 본 역행렬을 다시 계산해서 몸 스키닝이 통째로 틀어짐(몸이 사라짐)
    mm.bind(this.outfitBase.skeleton, (this.bodyMeshes[0] as THREE.SkinnedMesh).bindMatrix);
    this.xmasMeshes.push(mm);
    this.setOutfit(oc.style);
    log.info("character", `muffler ready ${mg.getAttribute("position").count} verts`);
  }

  /** 의상 전환 (크리스마스 의상이 없으면 기존 스카프 유지) */
  setOutfit(style: "classic" | "christmas"): void {
    const xmas = style === "christmas" && this.xmasMeshes.length > 0;
    this.classicMeshes.forEach((m) => (m.visible = !xmas));
    this.xmasMeshes.forEach((m) => (m.visible = xmas));
    // 목도리를 두르면 옛 스카프 자리 털 가림은 끄고 목도리 밑(aCover)만 가림
    this.fur.uOldScarf.value = xmas || this.sit ? 0 : 1;
  }

  /** 성능 조절: 털 셸을 n 장만 그림 (뿌리~끝에 고르게 남김). 털 길이는 그대로, 층 간격만 넓어짐 */
  setShellCount(n: number): void {
    const N = this.shellMeshes.length;
    const keep = new Set<number>();
    for (let k = 1; k <= Math.min(n, N); k++) keep.add(Math.round((k * N) / Math.min(n, N)) - 1);
    this.shellMeshes.forEach((m, i) => (m.visible = keep.has(i)));
  }

  refreshTuning(): void {
    for (const m of this.shellMeshes) (m.material as THREE.MeshStandardMaterial).roughness = this.cfg.fur.roughness;
    const fr = this.cfg.fur, fc = this.cfg.face;
    this.fur.uFurFreq.value = fr.freq;
    this.fur.uFurLean.value = fr.lean;
    this.fur.uFurThick.value = fr.thickness;
    this.fur.uFurBump.value = fr.bumpCm;
    this.fur.uFurTuftFreq.value = 1 / Math.max(0.1, fr.tuftCm);
    this.fur.uFurMin.value = fr.minDensity;
    this.fur.uRootShade.value = fr.rootShade;
    this.fur.uFaceFurScale.value = fr.faceFurScale;
    this.shellOffsets.forEach((o, i) => (o.value = fr.lengthCm * ((i + 1) / this.shellOffsets.length)));
    this.inkOffset.value = fr.lengthCm * 1.05;
    this.face.uInkColor.value.set(fc.inkColor);
    this.face.uBlushColor.value.set(fc.blushColor);
    this.scarfStripes.value = fc.scarfStripes;
    this.scarfAngle.value = fc.scarfStripeAngle;
    this.model.scale.setScalar(this.cfg.character.modelScale);
    this.model.position.y = -this.cfg.character.focusYcm * this.cfg.character.modelScale;
  }

  apply(p: CharacterParams, dtSec: number, timeSec: number, body: BodyPose | null = null): void {
    const ch = this.cfg.character, fc = this.cfg.face;
    const k = 1 - Math.exp(-dtSec * 18);
    for (const key of Object.keys(this.cur) as (keyof CharacterParams)[]) {
      this.cur[key] += (p[key] - this.cur[key]) * k;
    }
    const c = this.cur;

    const always = ch.alwaysVisible;
    this.root.visible = always || this.state !== "IDLE";
    const mimic = this.state === "MIMIC" || this.state === "ENTER";
    const pose = mimic && this.cfg.body.enabled ? body : null;

    // ── 등장/퇴장/유도 ──
    let baseY = 0;
    let wave = 0; // 0~1 오른팔 흔들기 세기
    if (always) {
      // 등장/퇴장/유도 연출 없음 — 그 자리에 계속 서 있음
    } else if (this.state === "ENTER") {
      baseY = (1 - easeOutBack(this.progress)) * -ch.enterDrop;
    } else if (this.state === "EXIT") {
      const e = easeInCubic(this.progress);
      baseY = e * -ch.enterDrop;
      wave = 1 - e;
    } else if (this.state === "ATTRACT") {
      const ph = (this.stateElapsedMs / 1000) % 4;
      const up = ph < 1.2 ? easeOutBack(ph / 1.2) : ph < 2.8 ? 1 : Math.max(0, 1 - (ph - 2.8) / 1.2);
      baseY = -ch.enterDrop * (1 - up * ch.attractPeek);
      wave = ph > 1.0 && ph < 2.9 ? Math.sin(((ph - 1.0) / 1.9) * Math.PI) : 0;
    }
    wave = Math.max(wave, this.debugWave);
    const breath = Math.sin(timeSec * Math.PI * 2 * ch.idleBreathHz) * ch.idleBreathAmp;
    this.root.position.y = baseY;
    this.root.scale.set(1 + breath * 0.5, 1 + breath, 1 + breath * 0.5);

    // ── 머리 (절대 회전) ──
    const yaw = mimic ? c.headYaw : 0;
    const pitch = mimic ? c.headPitch : Math.sin(timeSec * 0.7) * 0.04;
    const roll = mimic ? c.headRoll : Math.sin(timeSec * 0.5) * 0.03;
    _e.set(pitch, yaw, roll, "YXZ");
    _q.setFromEuler(_e);
    this.headQ.slerp(_q, k);

    // ── 몸통: Pose 가 있으면 사람 상반신, 없으면 고개를 조금 따라감 ──
    const humanTorso = new THREE.Quaternion();
    if (pose) {
      this.solveTorso(pose, humanTorso);
      const b = this.cfg.body;
      _e.setFromQuaternion(humanTorso, "YXZ");
      const D = Math.PI / 180;
      _e.set(
        clamp(_e.x * b.torsoPitchGain, b.torsoPitchClampDeg * D),
        clamp(_e.y * b.torsoYawGain, b.torsoYawClampDeg * D),
        clamp(_e.z * b.torsoRollGain, b.torsoRollClampDeg * D),
        "YXZ",
      );
      _q.setFromEuler(_e);
    } else {
      const bf = ch.bodyFollow;
      _e.set(pitch * bf * 0.5, yaw * bf, roll * bf, "YXZ");
      _q.setFromEuler(_e);
    }
    this.torsoQ.slerp(_q, k * 0.7);
    const [, spine, chest, head] = this.bones;
    if (this.seat) {
      spine.quaternion.identity();
      chest.quaternion.identity();
      // 목이 머리 회전의 일부를 나눠 가짐 (머리만 돌면 목둘레가 칼로 자른 듯 꺾임)
      const neck = this.seatNeck!;
      neck.quaternion.slerpQuaternions(ID, this.headQ, this.cfg.character.seatNeckShare);
      head.quaternion.copy(_qi.copy(neck.quaternion).invert()).multiply(this.headQ);
    } else {
      spine.quaternion.slerpQuaternions(ID, this.torsoQ, 0.45);
      chest.quaternion.copy(spine.quaternion);
      const chestWorld = _q2.multiplyQuaternions(spine.quaternion, chest.quaternion);
      head.quaternion.copy(_qi.copy(chestWorld).invert()).multiply(this.headQ);
    }

    // ── 팔 ──
    const fa = this.cfg.character;
    for (const arm of this.arms) {
      const tu = arm.tUpper.identity();
      const tf = arm.tFore.identity();
      const conf = pose ? (arm.side > 0 ? pose.armL : pose.armR) : 0;
      if (this.armsFree && !this.restIsIdle) {
        // 바인드는 비스듬히 벌린 A포즈 → 쉬는 자세 = 아래로 내린 팔(위팔 방향 절대값) + 팔꿈치 살짝 앞으로
        _qIdle.setFromUnitVectors(arm.restUpper, polarDir(arm.side, fa.freeArmIdleTheta, fa.freeArmIdlePhi));
        _qIdleF.setFromAxisAngle(_n.set(1, 0, 0), -fa.freeArmIdleElbow);
      } else {
        _qIdle.identity();
        _qIdleF.identity();
      }
      if (pose && conf >= this.cfg.body.minVisibility) {
        this.solveArm(arm, pose, humanTorso, tu, tf);
      } else if (arm.side < 0 && wave > 0) {
        // 손 흔들기: 오른팔(화면 왼쪽)을 들고 아래팔을 까딱
        if (this.armsFree) {
          // 팔이 자유: 위팔을 옆·위로 들고(절대 방향) 아래팔을 굽혀 좌우로 흔듦
          tu.setFromUnitVectors(arm.restUpper, polarDir(arm.side, fa.freeArmWaveTheta, fa.freeArmWavePhi));
          // 팔꿈치 = 경첩(앞면 평면에서 굽힘) · 아래팔 축 비틀기(회외) = 손바닥이 앞(+z)을 보게. 비틀기를 위팔에 주면 경첩 평면이 같이 돌아 앞발이 앞으로 나옴
          _n.set(0, 0, 1);
          tf.setFromAxisAngle(_n, arm.side * (fa.freeArmWaveElbow + Math.sin(timeSec * Math.PI * 2 * fa.freeArmWaveHz) * fa.freeArmWaveSwing));
          tf.multiply(_q2.setFromAxisAngle(arm.restFore, arm.side * fa.freeArmWaveTwist));
          tu.slerp(_qIdle, 1 - wave);
          tf.slerp(_qIdleF, 1 - wave);
        } else if (this.seat) {
          // Seat_A 인사: 위팔은 옆으로(수평보다 조금 위·조금 앞), 아래팔은 세워서 손바닥이 머리 옆 — 아래팔만 좌우로 까딱
          // 원본 팔 그대로: 위팔은 살짝만(앞·옆) 들고 팔꿈치를 굽혀 아래팔을 세움 — 위팔을 크게 들면 몸통에 붙은 옆면이 늘어남
          const ch2 = this.cfg.character;
          _e.set(-ch2.seatWaveRaise, 0, arm.side * ch2.seatWaveFwd, "XYZ");
          tu.setFromEuler(_e);
          _e.set(0, 0, 0, "YXZ");
          const sw = Math.sin(timeSec * 7) * ch2.seatWaveSwing;
          _v2.set(arm.side * (ch2.seatWaveForeOut + sw), 1, 0.5).normalize(); // 아래팔 목표 방향 (모델)
          _v3.copy(_v2).applyQuaternion(_qi.copy(tu).invert()); // 위팔 로컬
          tf.setFromUnitVectors(arm.restFore, _v3);
          tu.slerp(ID, 1 - wave);
          tf.slerp(ID, 1 - wave);
        } else {
          const motion=standingWaveMotion(timeSec);
          const d = polarDir(arm.side, this.connectedArms?motion.upper:2.1, this.connectedArms ? motion.depth : .35);
          tu.setFromUnitVectors(arm.restUpper, d).slerp(this.connectedArms?_qIdle:ID, 1 - wave);
          _n.set(0, 0, 1);
          tf.setFromAxisAngle(_n, arm.side * (this.connectedArms?motion.bend:(.5+Math.sin(timeSec*9)*.35)) * wave);
        }
      } else {
        const sway = Math.sin(timeSec * 1.3 + (arm.side > 0 ? 0 : 1.1)) * 0.03;
        _n.set(0, 0, 1);
        tu.setFromAxisAngle(_n, sway * arm.side);
        if (this.armsFree || this.connectedArms) {
          tu.premultiply(_qIdle);
          tf.copy(_qIdleF);
        }
      }
      arm.qUpper.slerp(tu, k);
      arm.qFore.slerp(tf, k);
      arm.upper.quaternion.copy(arm.qUpper);
      arm.fore.quaternion.copy(arm.qFore);
      if (this.armSurface) {
        const i = arm.side > 0 ? 0 : 1;
        const direction = arm.restFore.clone().applyQuaternion(arm.qFore).applyQuaternion(arm.qUpper);
        const raised = smooth(-.35, .65, direction.y);
        // Roll the supplied paw without scaling its width or length.
        let target = arm.side * (this.debugPawTurn ?? -Math.PI/2) * raised;
        const across=pose && conf>=this.cfg.body.minVisibility ? (arm.side>0?pose.handAcrossL:pose.handAcrossR) : undefined;
        if(across && this.debugPawTurn===null){
          const humanFore=vec(arm.side>0?pose!.wristL:pose!.wristR)
            .sub(vec(arm.side>0?pose!.elbowL:pose!.elbowR)).normalize()
            .applyQuaternion(humanTorso.clone().invert());
          const tracked=vec(across).applyQuaternion(humanTorso.clone().invert())
            .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(humanFore,direction));
          const reference=new THREE.Vector3(-arm.side,0,0);
          reference.addScaledVector(direction,-reference.dot(direction)).normalize();
          tracked.addScaledVector(direction,-tracked.dot(direction));
          if(tracked.lengthSq()>.05 && reference.lengthSq()>.05){
            tracked.normalize();
            const roll=Math.atan2(direction.dot(reference.clone().cross(tracked)),reference.dot(tracked));
            target+=clamp(roll,1.3)*raised;
          }
        }
        const current = this.armSurface.turn.value.getComponent(i);
        this.armSurface.turn.value.setComponent(i, current + (target-current)*k);
        const upperY=arm.restUpper.clone().applyQuaternion(arm.qUpper).y;
        this.armSurface.socketActivation.value.setComponent(i,smooth(-.35,.70,upperY));
        const reference=new THREE.Quaternion().setFromUnitVectors(arm.restUpper,polarDir(arm.side,2.32,.08));
        this.armSurface.correctiveRotation.value[i].multiplyQuaternions(spine.quaternion,chest.quaternion).multiply(arm.qUpper).multiply(reference.invert());
        const handDirection=pose && conf>=this.cfg.body.minVisibility
          ? (arm.side>0?pose.handDirectionL:pose.handDirectionR) : undefined;
        const wristTarget=new THREE.Vector3();
        if(!pose&&wave>0&&arm.side<0)wristTarget.z=arm.side*standingWaveMotion(timeSec).wrist*wave;
        if(handDirection){
          const humanFore=vec(arm.side>0?pose!.wristL:pose!.wristR)
            .sub(vec(arm.side>0?pose!.elbowL:pose!.elbowR)).normalize()
            .applyQuaternion(humanTorso.clone().invert());
          const palm=vec(handDirection).normalize().applyQuaternion(humanTorso.clone().invert())
            .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(humanFore,direction))
            .applyQuaternion(arm.qUpper.clone().invert()).applyQuaternion(arm.qFore.clone().invert());
          wristTarget.crossVectors(arm.restFore,palm);
          if(wristTarget.lengthSq()>.000001)
            wristTarget.normalize().multiplyScalar(Math.min(.18,arm.restFore.angleTo(palm)));
        }
        this.armSurface.wrist.value[i].lerp(wristTarget,k);
      }
      // 떼어 낸 팔 부품: 들수록 가늘게 (위팔 방향의 y 로 든 정도 — 내린 팔 ≈ -0.8, 다 든 팔 ≈ +0.6)
      for (const sl of this.armSlim) {
        if (sl.side !== arm.side) continue;
        _v2.copy(arm.restUpper).applyQuaternion(arm.qUpper);
        const raise = Math.min(1, Math.max(0, (_v2.y + 0.5) / 1.0));
        const target = 1 - (1 - fa.freeArmSlim) * raise;
        if (Math.abs(target - sl.cur) < 0.002) continue;
        sl.cur = target;
        const pa = sl.geo.getAttribute("position") as THREE.BufferAttribute;
        const arr = pa.array as Float32Array;
        for (let i = 0; i < arr.length; i++) arr[i] = sl.foot[i] + sl.radial[i] * target;
        pa.needsUpdate = true;
      }
    }
    // Seat_A 어깨 보조 본: 어깨 회전의 k/K (어깨 살·겨드랑이가 호를 그리며 따라감)
    for (const h of this.seatHelpers) h.bone.quaternion.slerpQuaternions(ID, h.src.quaternion, h.frac);

    // ── 눈: 감으면 눈알은 머리 속으로 작아지며 사라지고, 털이 덮고, 표면에 '‿' 곡선 (3D 가이드) ──
    if (timeSec >= this.nextBlinkAt) {
      this.nextBlinkAt = timeSec + ch.autoBlinkMinSec + Math.random() * (ch.autoBlinkMaxSec - ch.autoBlinkMinSec);
      this.autoBlink = 1;
    }
    this.autoBlink = Math.max(0, this.autoBlink - dtSec * 7);
    // 미믹 중엔 사람 눈만 따라 함(자동 깜빡임을 섞으면 안 감았는데 감는다)
    const auto = !mimic && this.autoBlink > 0.15;
    const mp = this.cfg.mapping;
    const wide = mimic ? 1 + c.eyeWide * 0.15 : 1;
    const raw = [mimic ? c.blinkL : 0, mimic ? c.blinkR : 0];
    for (let i = 0; i < 2; i++) {
      if (this.eyeShut[i]) { if (raw[i] < mp.blinkOpenBelow) this.eyeShut[i] = false; }
      else if (raw[i] > mp.blinkThreshold) this.eyeShut[i] = true;
      const target = this.eyeShut[i] || auto ? 1 : 0;
      // 감기 ≈ 50ms, 뜨기 ≈ 90ms
      const rate = dtSec / (target > this.eyeAnim[i] ? 0.05 : 0.09);
      this.eyeAnim[i] += Math.max(-rate, Math.min(rate, target - this.eyeAnim[i]));
    }
    const [closeL, closeR] = this.eyeAnim;
    for (const [eye, cl] of [[this.eyeL, closeL], [this.eyeR, closeR]] as const) {
      if (!eye) continue;
      // 점 눈은 세로로 납작해지며 사라지고 그 자리에 '‿'
      eye.scale.set(wide, wide * Math.max(0.05, 1 - cl), wide);
      eye.visible = cl < 0.6;
    }
    this.fur.uEyeClose.value.set(closeL, closeR);
    // 감은 눈은 튜브로 (먹선 버전은 끔: 굵기 0). 튜브가 없으면(로드 실패) 먹선으로 대체
    const useTube = this.closedTubes.length === 2;
    this.fur.uClosedEye.value.set(fc.closedEyeHalfW, fc.closedEyeCurve, fc.closedEyeDrop, useTube ? 0 : fc.closedEyeLineCm);
    // 점 눈이 납작해지며 사라지는(cl < 0.6) 순간 튜브가 나타남
    this.closedTubes.forEach((t, i) => (t.visible = this.eyeAnim[i] >= 0.6));

    // ── 입: 가이드 3D 렌더처럼 먹선만 ──
    //   무표정 = 조형돼 있던 입선 곡선 그대로 / 웃음 = 더 휜 '‿' / 찡그림 = '︵' / 입 벌림·오므림 = 작은 세로 'o'
    const jaw = mimic ? c.jawOpen : 0;
    const pk = mimic ? c.pucker : 0;
    const sm = mimic ? c.smile : 0;
    // 'o' 입: 확실히 벌렸을 때 / 입술을 확실히 오므렸을 때만
    const openAmt = Math.max(smooth(fc.mouthOpenFrom, fc.mouthOpenFrom + 0.35, jaw), smooth(0.45, 0.85, pk));
    // 무표정 휨 보정: 관객은 입보다 위에서 보므로 휜 주둥이 위 선의 끝이 처져 보인다 → 살짝 올려 둠
    const k0 = this.mouthSeamK + fc.mouthRestCurve;
    // 시무룩: 가이드 46장처럼 짧고 둥근 '︵' — 조금만 내려도 그 모양으로 빨리 넘어가게 (중간의 '끝만 처진 일자'가 어색함)
    const sulk = smooth(0.1, 0.4, -sm);
    const hwSulk = fc.mouthHalfW * fc.frownWidth;
    const hw = sm >= 0 ? fc.mouthHalfW * (1 + 0.12 * sm) : fc.mouthHalfW + (hwSulk - fc.mouthHalfW) * sulk;
    const curv = sm >= 0 ? k0 + sm * fc.smileCurve : k0 + (-fc.frownArcCm / (hwSulk * hwSulk) - k0) * sulk;
    this.face.uMouthL.value.set(this.mouthSeamY, curv, hw, fc.mouthLineCm);
    this.face.uMouthLineA.value = 1 - smooth(0.0, 0.6, openAmt);
    const rx = fc.mouthOHalfW * (0.6 + 0.4 * openAmt) * (1 - 0.25 * pk);
    const ry = fc.mouthOHalfH * (0.5 + 0.5 * openAmt) * (1 - 0.15 * pk);
    this.face.uMouthO.value.set(this.mouthSeamY - ry * 0.15, rx, ry, smooth(0.0, 0.4, openAmt));
    this.face.uMouthProjYaw.value = -yaw * 0.85;

    // ── 볼터치·눈썹 ──
    // 볼터치: 활짝 웃을 때만 (양쪽 입꼬리 둘 다 높음). 천천히 물들고 천천히 빠짐 → 순간 노이즈로 깜빡이지 않음
    const grinT = mimic ? smooth(fc.blushGrinFrom, fc.blushGrinFull, c.grin) : 0;
    this.blushEnv += (grinT - this.blushEnv) * Math.min(1, dtSec / (grinT > this.blushEnv ? 0.35 : 0.6));
    this.face.uBlushA.value.set(fc.blushX, fc.blushY, fc.blushR, fc.blushStrength * this.blushEnv);
    const bu = mimic ? c.browUp : 0;
    // 눈썹: 가이드 3D 렌더엔 없음 → 기본 끔 (face.browEnabled)
    this.face.uBrowA.value.set(bu, fc.browEnabled ? smooth(0.4, 0.65, Math.abs(bu)) : 0, fc.browOffsetY, fc.browLen);
    const ex = this.fur.uEyeLPos.value;
    this.face.uEyeA.value.set(ex.x, ex.y, fc.lineCm, 0);
  }

  /** 사람 몸통 기저(오른→왼 어깨 = +x, 엉덩이→어깨 = +y) → 회전 */
  private solveTorso(pose: BodyPose, out: THREE.Quaternion): void {
    const right = vec(pose.shoulderL).sub(vec(pose.shoulderR));
    const up = new THREE.Vector3(0, 1, 0);
    if (pose.hips >= this.cfg.body.minVisibility) {
      up.copy(vec(pose.shoulderL).add(vec(pose.shoulderR)).multiplyScalar(0.5))
        .sub(vec(pose.hipL).add(vec(pose.hipR)).multiplyScalar(0.5));
    }
    up.normalize();
    right.addScaledVector(up, -right.dot(up)).normalize();
    const fwd = new THREE.Vector3().crossVectors(right, up);
    out.setFromRotationMatrix(_m.makeBasis(right, up, fwd));
  }

  /**
   * 사람 팔 방향 → 곰 팔 회전.
   * 사람의 차렷(팔 아래)이 곰의 기본 A자 팔에 대응하도록 '아래에서 벌어진 각'을 재매핑한다
   * (그대로 쓰면 팔을 내렸을 때 곰 팔이 배를 뚫고 들어감).
   */
  private solveArm(arm: ArmRig, pose: BodyPose, humanTorso: THREE.Quaternion, outU: THREE.Quaternion, outF: THREE.Quaternion): void {
    const L = arm.side > 0;
    const s = vec(L ? pose.shoulderL : pose.shoulderR);
    const e = vec(L ? pose.elbowL : pose.elbowR);
    const w = vec(L ? pose.wristL : pose.wristR);
    const inv = humanTorso.clone().invert();
    const tu = e.clone().sub(s).normalize().applyQuaternion(inv); // 몸통 기준
    const tf = w.clone().sub(e).normalize().applyQuaternion(inv);
    if (tu.lengthSq() < 0.5 || tf.lengthSq() < 0.5) { outU.identity(); outF.identity(); return; }

    const theta = Math.acos(clamp(-tu.y, 1));
    let phi = Math.atan2(tu.z, arm.side * tu.x);
    phi = Math.min(2.0, Math.max(-0.5, phi)) * smooth(0.25, 0.7, theta);
    // Preserve the official neutral axis; raised input follows the person.
    const theta2 = this.armsFree
      ? Math.min(this.cfg.character.freeArmRaiseMaxRad, theta)
      : Math.min(this.cfg.body.armRaiseMaxRad, arm.restPolar + (theta * (Math.PI - arm.restPolar)) / Math.PI);
    const d = this.connectedArms
      ? standingUpperDirection(arm.side,arm.restUpper,tu,this.cfg.body.armRaiseMaxRad)
      : polarDir(arm.side, theta2, phi);
    outU.setFromUnitVectors(arm.restUpper, d);

    // 팔꿈치: 사람의 굽힘각/굽힘축을 위팔 매핑과 같은 회전으로 옮김
    const bend = Math.min(2.4, tu.angleTo(tf) * this.cfg.body.elbowGain);
    _n.crossVectors(tu, tf);
    if (_n.lengthSq() < 1e-6 || bend < 0.02) {
      outF.identity();
      return;
    }
    _n.normalize().applyQuaternion(_q.setFromUnitVectors(tu, d));
    _v2.copy(d).applyAxisAngle(_n, bend); // chest 로컬 아래팔 방향
    _v3.copy(_v2).applyQuaternion(_qi.copy(outU).invert()); // 위팔 로컬
    outF.setFromUnitVectors(arm.restFore, _v3.normalize());
  }
}

/**
 * 눈 소켓 파기. 세분화된 머리 표면이 눈알의 코 쪽 아래를 덮어 정면에서 눈이 '베어 문' 초승달로 보인다.
 * 눈 축(정면 방향) 기준으로 눈알 반지름 안쪽의 표면을 눈 중심 뒤로 밀어, 정면에서 눈알 전체가 보이게 한다.
 * 바깥으로 갈수록 원래 표면으로 부드럽게 이어짐.
 */
function carveEyeSockets(geo: THREE.BufferGeometry, eyes: { center: THREE.Vector3; r: number; axis: THREE.Vector3 }[]): void {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const nor = geo.getAttribute("normal") as THREE.BufferAttribute;
  const p = new THREE.Vector3(), d = new THREE.Vector3(), nrm = new THREE.Vector3();
  const front = new THREE.Vector3(0, 0, 1);
  // 정면(관객) / 눈 축(고개 돌렸을 때 보는 방향) / 그 중간 — 어느 각도에서도 눈알 전체가 보이게 세 방향 모두 판다
  const passes = eyes.flatMap((e) => {
    const side = e.center.clone().sub(ANATOMY.headCenter).normalize();
    return [front.clone(), e.axis.clone(), side].map((axis) => ({ ...e, axis }));
  });
  for (const e of passes) {
    const R0 = e.r * 1.25, R1 = e.r * 2.6;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      d.subVectors(p, e.center);
      const al = d.dot(e.axis);
      if (al < -e.r * 1.5 || al > e.r * 4) continue;
      const perp = d.addScaledVector(e.axis, -al).length();
      if (perp > R1) continue;
      const k = 1 - smoothstep01(R0, R1, perp);
      const limit = -0.15 * e.r; // 눈 중심보다 살짝 뒤까지
      const target = al + (Math.min(al, limit) - al) * k;
      if (target < al) {
        p.addScaledVector(e.axis, target - al);
        pos.setXYZ(i, p.x, p.y, p.z);
        // 파인 면은 눈 쪽을 향하게 노멀 보정 (털 셸 방향·조명)
        nrm.fromBufferAttribute(nor, i).lerp(e.axis, k * 0.6).normalize();
        nor.setXYZ(i, nrm.x, nrm.y, nrm.z);
      }
    }
  }
  pos.needsUpdate = true;
  nor.needsUpdate = true;
}
function smoothstep01(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** 아래(-y)에서 theta 만큼 벌어지고, 바깥(side*x)에서 앞(+z)으로 phi 만큼 돈 방향 */
function polarDir(side: number, theta: number, phi: number): THREE.Vector3 {
  const st = Math.sin(theta);
  return new THREE.Vector3(side * st * Math.cos(phi), -Math.cos(theta), st * Math.sin(phi)).normalize();
}
function clamp(v: number, lim: number): number {
  return Math.min(lim, Math.max(-lim, v));
}
function easeOutBack(t: number): number {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
function easeInCubic(t: number): number {
  return t * t * t;
}

/**
 * 감은 눈 '‿' 튜브 지오메트리 (몸통 rest 좌표). 눈 중심을 지나고 axis 에 수직인 평면에서 v = k·u² − drop 곡선을 그리고,
 * 각 점을 axis 방향으로 '그 자리 표면 높이'(눈구멍은 건너뛰고 양 끝을 잇는 높이) + 털 높이 일부만큼 띄운다.
 * 끝은 둥글게 가늘어진다 (가이드 45·46·50장의 반광택 짧은 끈).
 */
function closedEyeTube(
  body: THREE.BufferGeometry, c: THREE.Vector3, axis: THREE.Vector3, fc: Config["face"], furLift: number,
): THREE.BufferGeometry {
  const pos = body.getAttribute("position") as THREE.BufferAttribute;
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), axis).normalize();
  const up = new THREE.Vector3().crossVectors(axis, right).normalize();
  // 눈 근처 정점만 (u, v, h) 로
  const near: number[] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).sub(c);
    if (p.lengthSq() > 64) continue;
    near.push(p.dot(right), p.dot(up), p.dot(axis));
  }
  const hw = fc.closedEyeHalfW, k = fc.closedEyeCurve, drop = fc.closedEyeDrop, r = fc.closedEyeLineCm / 2;
  const surf = (u: number, v: number) => {
    let best = -Infinity;
    for (let j = 0; j < near.length; j += 3) {
      const du = near[j] - u, dv = near[j + 1] - v;
      if (du * du + dv * dv < 0.16) best = Math.max(best, near[j + 2]);
    }
    return best; // -Infinity = 근처 정점 없음 (아래에서 제외)
  };
  const N = 28, R = 10;
  const pts: THREE.Vector3[] = [];
  const hs: number[] = [];
  for (let i = 0; i <= N; i++) {
    const u = -hw + (2 * hw * i) / N;
    hs.push(surf(u, k * u * u - drop));
  }
  // 표면 높이를 매끈한 2차식 h(u) = a + b·u + c·u² 로 맞춤 — 점마다 따로 쓰면 메쉬 굴곡을 따라 튜브가 꺾여 갈고리처럼 보였음
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
  for (let i = 0; i <= N; i++) {
    if (!Number.isFinite(hs[i])) continue;
    const u = -hw + (2 * hw * i) / N, h = hs[i];
    s0 += 1; s1 += u; s2 += u * u; s3 += u * u * u; s4 += u * u * u * u;
    t0 += h; t1 += u * h; t2 += u * u * h;
  }
  const det3 = (m: number[]) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  const Mm = [s0, s1, s2, s1, s2, s3, s2, s3, s4];
  const D = det3(Mm);
  const fitOk = s0 >= 4 && Math.abs(D) > 1e-9;
  const ca = fitOk ? det3([t0, s1, s2, t1, s2, s3, t2, s3, s4]) / D : 0;
  const cb = fitOk ? det3([s0, t0, s2, s1, t1, s3, s2, t2, s4]) / D : 0;
  const cc = fitOk ? det3([s0, s1, t0, s1, s2, t1, s2, s3, t2]) / D : 0;
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = -hw + 2 * hw * t;
    const h = ca + cb * u + cc * u * u + furLift;
    pts.push(c.clone().addScaledVector(right, u).addScaledVector(up, k * u * u - drop).addScaledVector(axis, h));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const verts: number[] = [], norms: number[] = [], idx: number[] = [];
  const S = 48;
  const T = new THREE.Vector3(), Nn = new THREE.Vector3(), B = new THREE.Vector3(), q = new THREE.Vector3(), dir = new THREE.Vector3();
  for (let i = 0; i <= S; i++) {
    const t = i / S;
    const ct = curve.getPointAt(t);
    curve.getTangentAt(t, T);
    Nn.copy(axis).addScaledVector(T, -axis.dot(T)).normalize();
    B.crossVectors(T, Nn).normalize();
    const e = Math.abs(2 * t - 1);
    const rr = r * Math.sqrt(Math.max(0, 1 - Math.pow(e, 10))); // 둥근 끝
    for (let j = 0; j <= R; j++) {
      const a = (j / R) * Math.PI * 2;
      dir.copy(Nn).multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a));
      q.copy(ct).addScaledVector(dir, rr);
      verts.push(q.x, q.y, q.z);
      norms.push(dir.x, dir.y, dir.z);
    }
  }
  for (let i = 0; i < S; i++)
    for (let j = 0; j < R; j++) {
      const a = i * (R + 1) + j, b = a + R + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(norms, 3));
  g.setIndex(idx);
  return g;
}

/** 튜브 재질: 눈과 같은 반광택 차콜. 깊이만 카메라 쪽으로 당겨 주변 털에 안 가려지게 (화면 위치·모양은 그대로) */
function makeClosedEyeMaterial(base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const m = base.clone();
  // 가는 튜브는 하이라이트가 면적 대비 커서 회색으로 떠 보임 → 가이드처럼 거의 검정에 은은한 광택만
  m.color.multiplyScalar(0.55);
  m.envMapIntensity = 0.12;
  m.roughness = 0.45;
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      vec3 pvCam = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
      transformed += normalize(pvCam - transformed) * 2.5;`,
    );
  };
  m.customProgramCacheKey = () => "pv-closed-eye";
  return m;
}
