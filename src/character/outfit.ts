import * as THREE from "three";
import type { Config } from "../config";

/**
 * 크리스마스 의상: 뜨개 목도리 (새 푸빌라 FBX asset/Puuvilla_V02 에서 가져와 줄인 것).
 * 좌표는 전부 기존 푸빌라 rest 좌표(cm, 정면 +z) — 몸통과 같은 스키닝/본을 쓴다.
 */

export interface MufflerSrc {
  pos: Float32Array; // FBX 좌표 (곰 키 ≈ 3)
  uv: Float32Array | null;
  index: Uint32Array;
}

/** public/models/muffler.bin 읽기 ([u32 헤더 길이][JSON][f32 pos][u32 index]) */
export async function loadMuffler(url: string): Promise<MufflerSrc> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const len = new DataView(buf).getUint32(0, true);
  const h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len)));
  const off = 4 + len;
  const uvBytes = h.uv ? h.verts * 8 : 0;
  return {
    pos: new Float32Array(buf, off, h.verts * 3),
    uv: h.uv ? new Float32Array(buf, off + h.verts * 12, h.verts * 2) : null,
    index: new Uint32Array(buf, off + h.verts * 12 + uvBytes, h.tris * 3),
  };
}

/** 몸통 정점 격자 — 가장 가까운 표면 점·노멀 찾기 (목도리·모자가 몸을 파고들지 않게) */
class SurfaceGrid {
  private cells = new Map<string, number[]>();
  constructor(private pos: THREE.BufferAttribute, private nor: THREE.BufferAttribute, private cell: number, filter?: (x: number, y: number, z: number) => boolean) {
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (filter && !filter(x, y, z)) continue;
      const k = this.key(x, y, z);
      let a = this.cells.get(k);
      if (!a) this.cells.set(k, (a = []));
      a.push(i);
    }
  }
  private key(x: number, y: number, z: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }
  /** 가까운 표면 정점 몇 개의 평균 위치·노멀 (없으면 null) */
  nearest(p: THREE.Vector3, outP: THREE.Vector3, outN: THREE.Vector3): boolean {
    const cx = Math.floor(p.x / this.cell), cy = Math.floor(p.y / this.cell), cz = Math.floor(p.z / this.cell);
    let best = Infinity, bi = -1;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const a = this.cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!a) continue;
          for (const i of a) {
            const d = (this.pos.getX(i) - p.x) ** 2 + (this.pos.getY(i) - p.y) ** 2 + (this.pos.getZ(i) - p.z) ** 2;
            if (d < best) {
              best = d;
              bi = i;
            }
          }
        }
    if (bi < 0) return false;
    outP.fromBufferAttribute(this.pos, bi);
    outN.fromBufferAttribute(this.nor, bi).normalize();
    return true;
  }
}

export function pca(points: THREE.Vector3[]): { c: THREE.Vector3; n: THREE.Vector3 } {
  const c = new THREE.Vector3();
  for (const p of points) c.add(p);
  c.divideScalar(Math.max(1, points.length));
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (const p of points) {
    const x = p.x - c.x, y = p.y - c.y, z = p.z - c.z;
    xx += x * x; xy += x * y; xz += x * z; yy += y * y; yz += y * z; zz += z * z;
  }
  // 가장 작은 고유벡터 = 평면 노멀 (거듭제곱법으로 (tr·I − M) 의 최대 고유벡터)
  const tr = xx + yy + zz;
  const M = [tr - xx, -xy, -xz, -xy, tr - yy, -yz, -xz, -yz, tr - zz];
  let v = new THREE.Vector3(0, 1, 0);
  for (let it = 0; it < 60; it++) {
    v = new THREE.Vector3(M[0] * v.x + M[1] * v.y + M[2] * v.z, M[3] * v.x + M[4] * v.y + M[5] * v.z, M[6] * v.x + M[7] * v.y + M[8] * v.z).normalize();
  }
  if (v.y < 0) v.negate();
  return { c, n: v };
}

const ss = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * 목도리 맞추기.
 * FBX 곰은 앉아서 목을 앞으로 숙인 자세라 목도리 고리가 약 40° 기울어 있고 끝자락은 수직으로 늘어져 있다.
 * → 고리 부분만 '앞쪽 아래(끝자락이 시작되는 곳)'를 경첩으로 돌려 기존 곰 목 고리(옛 스카프) 기울기에 맞추고, 끝자락은 수직 그대로.
 * → 크기·위치 맞춘 뒤, 몸을 파고드는 정점은 표면 밖으로 밀고, 끝자락은 가슴에 닿게 당긴다.
 */
export function fitMuffler(
  src: MufflerSrc,
  body: THREE.BufferGeometry,
  oldRing: THREE.Vector3[],
  mc: Config["outfit"]["muffler"],
): THREE.BufferGeometry {
  const n = src.pos.length / 3;
  const P: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) P.push(new THREE.Vector3(src.pos[i * 3], src.pos[i * 3 + 1], src.pos[i * 3 + 2]));

  // ── 고리를 옛 스카프 고리 '길'에 그대로 얹기 ──
  // FBX 곰은 목을 숙인 앉은 자세라 고리를 통째로 돌리면 이 곰 목과 모양이 안 맞아 뒤로 판처럼 튀어나옴.
  // → 고리 축 둘레 각도 θ 마다 'FBX 고리 중심선 C_f(θ)' 와 '옛 스카프 고리 중심선 C_o(θ)' 를 구하고,
  //    각 정점을 C_f 기준 국소 좌표(바깥·위·진행 방향)로 바꿔 C_o 에 같은 국소 좌표로 붙임 (뜨개 단면 모양은 그대로).
  // 끝자락(경첩 아래)은 앞 가운데 각도의 국소 틀을 따라 통째로 옮김.
  const ringPts = P.filter((p) => p.y > mc.srcRingFromY);
  const F = pca(ringPts);
  const old = pca(oldRing);
  const BINS = 72;
  const frameOf = (c: THREE.Vector3, nrm: THREE.Vector3) => {
    const r0 = new THREE.Vector3(0, 0, 1).addScaledVector(nrm, -nrm.z).normalize(); // 앞(+z) = θ 0
    const r1 = new THREE.Vector3().crossVectors(nrm, r0);
    return { c, n: nrm, r0, r1, ang: (p: THREE.Vector3) => { const v = p.clone().sub(c); return Math.atan2(v.dot(r1), v.dot(r0)); } };
  };
  const ff = frameOf(F.c, F.n), fo = frameOf(old.c, old.n);
  const binF = (ang: number) => ((ang + Math.PI) / (2 * Math.PI)) * BINS - 0.5;
  // 각도별 중심선 (그 각도 점들의 평균) — 비어 있는 칸은 이웃으로 채우고 원형으로 부드럽게
  const centerline = (pts: THREE.Vector3[], fr: ReturnType<typeof frameOf>) => {
    const acc = Array.from({ length: BINS }, () => ({ p: new THREE.Vector3(), n: 0 }));
    for (const p of pts) {
      const k = ((Math.round(binF(fr.ang(p))) % BINS) + BINS) % BINS;
      acc[k].p.add(p);
      acc[k].n++;
    }
    let C = acc.map((a) => (a.n ? a.p.divideScalar(a.n) : null));
    for (let it = 0; it < BINS && C.some((c) => !c); it++)
      C = C.map((c, k) => c ?? C[(k + BINS - 1) % BINS] ?? C[(k + 1) % BINS] ?? null);
    let CC = C.map((c) => c ?? fr.c.clone());
    for (let it = 0; it < 4; it++)
      CC = CC.map((c, k) => c.clone().multiplyScalar(2).add(CC[(k + BINS - 1) % BINS]).add(CC[(k + 1) % BINS]).multiplyScalar(0.25));
    return CC;
  };
  const Cf = centerline(ringPts, ff), Co = centerline(oldRing, fo);
  // 각도 k 의 국소 틀: 바깥(rad) = 축에서 중심선으로, 위(n), 진행(t) = rad × n
  const localFrame = (C: THREE.Vector3[], fr: ReturnType<typeof frameOf>, k: number) => {
    const rad = C[k].clone().sub(fr.c);
    rad.addScaledVector(fr.n, -rad.dot(fr.n)).normalize();
    const t = new THREE.Vector3().crossVectors(fr.n, rad);
    return { o: C[k], rad, n: fr.n, t };
  };
  const ringW = (pts: THREE.Vector3[]) => Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
  const s = (ringW(oldRing) / ringW(ringPts)) * mc.scale;
  const off = new THREE.Vector3(mc.offsetX, mc.offsetY, mc.offsetZ);
  const mapAt = (p: THREE.Vector3, kf: number) => {
    const k0 = ((Math.floor(kf) % BINS) + BINS) % BINS, k1 = (k0 + 1) % BINS, w = kf - Math.floor(kf);
    const out = new THREE.Vector3();
    for (const [k, wk] of [[k0, 1 - w], [k1, w]] as const) {
      const a = localFrame(Cf, ff, k), b = localFrame(Co, fo, k);
      const d = p.clone().sub(a.o);
      const q = b.o.clone()
        .addScaledVector(b.rad, d.dot(a.rad) * s)
        .addScaledVector(b.n, d.dot(a.n) * s)
        .addScaledVector(b.t, d.dot(a.t) * s);
      out.addScaledVector(q, wk);
    }
    return out.add(off);
  };
  // 끝자락: 회전 없이 그대로 늘어뜨림(FBX 에서도 수직) — 경첩 가운데 점이 고리 지도에서 가는 곳으로 평행 이동
  const hingePts = P.filter((p) => Math.abs(p.y - mc.srcHingeY) < 0.06 && p.z > F.c.z);
  const Hf = new THREE.Vector3();
  for (const p of hingePts) Hf.add(p);
  Hf.divideScalar(Math.max(1, hingePts.length));
  const Ho = mapAt(Hf, binF(ff.ang(Hf)));
  for (const p of P) {
    const w = ss(mc.srcHingeY - 0.05, mc.srcHingeY + 0.2, p.y);
    const asRing = mapAt(p, binF(ff.ang(p)));
    const asTail = p.clone().sub(Hf).multiplyScalar(s).add(Ho);
    p.copy(asTail.lerp(asRing, w));
  }

  // 몸 밖으로 밀기 + 끝자락 가슴에 붙이기
  const bpos = body.getAttribute("position") as THREE.BufferAttribute;
  const bnor = body.getAttribute("normal") as THREE.BufferAttribute;
  // 머리(턱·볼)는 밀어내기 대상에서 뺌 — 머리 표면 노멀 방향으로 밀면 고리 윗면이 구겨져 터진 것처럼 보임.
  // 머리 안으로 들어간 부분은 머리에 가려질 뿐이라 그냥 둠 (고개를 돌리면 머리와 함께 0.45 만큼 따라감)
  const grid = new SurfaceGrid(bpos, bnor, 4, (_x, y, z) => y > 60 && y < mc.headFromY && !(y > mc.headFromY - 8 && z > 10));
  const bp = new THREE.Vector3(), bn = new THREE.Vector3();
  const gap = mc.gapCm;
  const isTail = P.map((_, i) => src.pos[i * 3 + 1] < mc.srcHingeY);
  // 끝자락: 2cm 높이 띠마다 몸에서 떠 있는 만큼 당김
  const bandShift = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    if (!isTail[i]) continue;
    if (!grid.nearest(P[i], bp, bn)) continue;
    const d = P[i].clone().sub(bp).dot(bn) - gap;
    const b = Math.round(P[i].y / 2);
    bandShift.set(b, Math.min(bandShift.get(b) ?? Infinity, d));
  }
  for (let i = 0; i < n; i++) {
    if (!isTail[i]) continue;
    const b = Math.round(P[i].y / 2);
    let sum = 0, cnt = 0;
    for (let k = -2; k <= 2; k++) {
      const v = bandShift.get(b + k);
      if (v !== undefined && Number.isFinite(v)) {
        sum += v;
        cnt++;
      }
    }
    const shift = cnt ? Math.max(0, sum / cnt) : 0;
    P[i].z -= shift;
  }
  // 고리: 정점마다 따로 밀면 뜨개 겉면이 구겨져 '터진' 것처럼 보임 → 고리를 통째로 부풀리기.
  // 고리 축 둘레 각도마다 '몸을 파고든 만큼'을 재서 각도 방향으로 부드럽게 만든 뒤, 그 각도의 정점 전부(겉·안 두께째)를
  // 같은 양만큼 바깥(반지름 방향)·위(축 방향)로 옮김 → 뜨개 모양은 그대로, 몸과는 안 겹침
  const axis = old.n.clone();
  const ctr = old.c.clone();
  const ref = new THREE.Vector3(0, 0, 1).addScaledVector(axis, -axis.z).normalize();
  const ref2 = new THREE.Vector3().crossVectors(axis, ref);
  // (각도 칸 수는 위 BINS 재사용)
  const angleOf = (p: THREE.Vector3) => {
    const v = p.clone().sub(ctr);
    return Math.atan2(v.dot(ref2), v.dot(ref));
  };
  const binOf = (ang: number) => ((Math.floor(((ang + Math.PI) / (2 * Math.PI)) * BINS) % BINS) + BINS) % BINS;
  const radial = (p: THREE.Vector3) => {
    const v = p.clone().sub(ctr);
    v.addScaledVector(axis, -v.dot(axis));
    return v.lengthSq() > 1e-6 ? v.normalize() : ref.clone();
  };
  const ringIdx: number[] = [];
  for (let i = 0; i < n; i++) if (!isTail[i]) ringIdx.push(i);
  // 고리 조이기: 기존 곰은 목이 곧아서 FBX 고리(숙인 목에 맞춘 것)를 얹으면 옆·뒤 윗단이 나팔처럼 벌어져
  // 원래 목에 가려져 있던 안쪽 면(다듬지 않은 뜨개 안쪽 — 숭숭 뚫림)이 보였음 = '터진' 것처럼 보이던 곳.
  // → (각도 × 고리 축 높이) 칸마다 몸(턱·목 포함)과 떠 있는 만큼 재서, 칸째로(겉·안 두께 그대로) 반지름 안쪽으로 당김.
  const hugGrid = new SurfaceGrid(bpos, bnor, 6, (_x, y) => y > 60 && y < 160);
  const hug = (inset: number) => {
    const UB = 1.5, UMIN = -30, NU = 40;
    const ub = (p: THREE.Vector3) => Math.min(NU - 1, Math.max(0, Math.floor((p.clone().sub(ctr).dot(axis) - UMIN) / UB)));
    const clear = new Float32Array(BINS * NU).fill(Infinity), far = new Float32Array(BINS * NU).fill(-Infinity);
    for (const i of ringIdx) {
      const p = P[i];
      if (!hugGrid.nearest(p, bp, bn)) continue;
      const d = p.distanceTo(bp) - gap;
      const k = binOf(angleOf(p)) * NU + ub(p);
      clear[k] = Math.min(clear[k], d);
      far[k] = Math.max(far[k], d);
    }
    // 빈 칸·몸에서 먼 칸(앞 매듭 쪽 등)은 0 → 당기지 않음
    let pull = new Float32Array(BINS * NU);
    for (let k = 0; k < pull.length; k++) pull[k] = Number.isFinite(clear[k]) ? Math.min(mc.hugMaxCm, Math.max(0, clear[k] + Math.min(inset, 0.4 * (far[k] - clear[k])))) : 0; // 묻는 깊이는 두께의 40% 까지 (겉면은 몸 밖에)
    for (let it = 0; it < 8; it++) {
      const o = new Float32Array(pull.length);
      for (let a2 = 0; a2 < BINS; a2++)
        for (let u = 0; u < NU; u++) {
          const am = (a2 + BINS - 1) % BINS, ap = (a2 + 1) % BINS, um = Math.max(0, u - 1), up = Math.min(NU - 1, u + 1);
          o[a2 * NU + u] = (4 * pull[a2 * NU + u] + pull[am * NU + u] + pull[ap * NU + u] + pull[a2 * NU + um] + pull[a2 * NU + up]) / 8;
        }
      pull = o;
    }
    for (const i of ringIdx) {
      const p = P[i];
      const f = ((angleOf(p) + Math.PI) / (2 * Math.PI)) * BINS - 0.5;
      const k0 = ((Math.floor(f) % BINS) + BINS) % BINS, k1 = (k0 + 1) % BINS, w = f - Math.floor(f);
      const u = ub(p);
      const d = pull[k0 * NU + u] * (1 - w) + pull[k1 * NU + u] * w;
      // 앞 매듭 옆(고리가 끝자락으로 말려 내려가는 곳)도 당김 — 거기서 뜨면 말린 끝 안쪽이 그대로 보임 (이음은 regularizeFit 이 매끈하게)
      p.addScaledVector(radial(p), -d);
    }
  };
  hug(0);
  for (let pass = 0; pass < 4; pass++) {
    const needR = new Float32Array(BINS), needU = new Float32Array(BINS);
    for (const i of ringIdx) {
      const p = P[i];
      if (!grid.nearest(p, bp, bn)) continue;
      const pen = gap - p.clone().sub(bp).dot(bn);
      if (pen <= 0) continue;
      const k = binOf(angleOf(p));
      const rd = radial(p);
      // 몸 노멀을 반지름·축 성분으로 나눠 필요한 만큼 (옆으로 밀 수 없으면 위로)
      const nr = Math.max(0, bn.dot(rd)), nu = Math.max(0, bn.dot(axis));
      const tot = nr + nu + 1e-3;
      needR[k] = Math.max(needR[k], (pen * nr) / tot / Math.max(0.35, nr / tot));
      needU[k] = Math.max(needU[k], (pen * nu) / tot / Math.max(0.35, nu / tot));
    }
    // 각도 방향 부드럽게 (원형, 넓게)
    const smooth = (arr: Float32Array) => {
      let a2 = arr;
      for (let it = 0; it < 12; it++) {
        const o = new Float32Array(BINS);
        for (let k = 0; k < BINS; k++) o[k] = Math.max(a2[k], (a2[(k + BINS - 1) % BINS] + 2 * a2[k] + a2[(k + 1) % BINS]) / 4);
        a2 = o;
      }
      for (let it = 0; it < 6; it++) {
        const o = new Float32Array(BINS);
        for (let k = 0; k < BINS; k++) o[k] = (a2[(k + BINS - 1) % BINS] + 2 * a2[k] + a2[(k + 1) % BINS]) / 4;
        a2 = o;
      }
      return a2;
    };
    const sR = smooth(needR), sU = smooth(needU);
    let moved = 0;
    for (const i of ringIdx) {
      const p = P[i];
      const f = ((angleOf(p) + Math.PI) / (2 * Math.PI)) * BINS - 0.5;
      const k0 = ((Math.floor(f) % BINS) + BINS) % BINS, k1 = (k0 + 1) % BINS, w = f - Math.floor(f);
      const dr = sR[k0] * (1 - w) + sR[k1] * w, du = sU[k0] * (1 - w) + sU[k1] * w;
      // 경첩(끝자락과 이어지는 곳) 근처는 덜 옮겨서 끝자락과 끊기지 않게
      const hw = ss(mc.srcHingeY, mc.srcHingeY + 0.25, src.pos[i * 3 + 1]);
      p.addScaledVector(radial(p), dr * hw).addScaledVector(axis, du * hw);
      moved = Math.max(moved, dr, du);
    }
    if (moved < 0.05) break;
  }
  // 턱 밑에 붙이고 어깨에 걸치기 (시안 PDF 261014: 윗단은 턱·뒤통수 밑에 빈틈없이, 바깥 아랫단은 어깨에 얹힘).
  // 세로 기둥(목 중심 둘레 각도 × 반지름 1cm)마다:
  //  - 위에 머리가 있는 기둥(목 가까운 안쪽) = 목도리 윗면이 머리 아랫면에 닿을 때까지 올림
  //  - 위에 머리가 없는 기둥(어깨 위 바깥쪽) = 목도리 아랫면이 어깨에 닿을 때까지 내림
  // → 띠가 턱 밑에서 어깨로 천처럼 걸쳐짐. (올리기만 하면 바깥이 어깨 위에 공중부양, 내리기만 하면 목이 휑함)
  if (mc.liftMaxCm > 0) {
    const cx = ctr.x, cz = ctr.z;
    const AB = BINS, RB = 70;
    const colOf = (x: number, z: number) => {
      const ang = Math.atan2(x - cx, z - cz);
      const ka = ((Math.floor(((ang + Math.PI) / (2 * Math.PI)) * AB) % AB) + AB) % AB;
      const kr = Math.min(RB - 1, Math.floor(Math.hypot(x - cx, z - cz)));
      return ka * RB + kr;
    };
    const cols: number[][] = Array.from({ length: AB * RB }, () => []);
    for (let i = 0; i < bpos.count; i++) {
      const y = bpos.getY(i);
      if (y < 60 || y > 175) continue;
      cols[colOf(bpos.getX(i), bpos.getZ(i))].push(y);
    }
    const up = new Float32Array(AB * RB).fill(Infinity), down = new Float32Array(AB * RB).fill(Infinity);
    const seen = new Uint8Array(AB * RB);
    for (const i of ringIdx) {
      const p = P[i];
      const k = colOf(p.x, p.z);
      seen[k] = 1;
      let ya = Infinity, yb = -Infinity;
      for (const y of cols[k]) {
        if (y > p.y - 0.5 && y < ya) ya = y;
        if (y < p.y + 0.5 && y > yb) yb = y;
      }
      if (ya - p.y < 20) up[k] = Math.min(up[k], ya - p.y - gap);
      if (Number.isFinite(yb)) down[k] = Math.min(down[k], p.y - yb - gap);
    }
    let D = new Float32Array(AB * RB), W = new Float32Array(AB * RB);
    for (let k = 0; k < D.length; k++) {
      if (!seen[k]) continue;
      if (Number.isFinite(up[k])) D[k] = Math.min(mc.liftMaxCm, Math.max(0, up[k]));
      else if (Number.isFinite(down[k])) D[k] = -Math.min(mc.liftMaxCm, Math.max(0, down[k]));
      else continue;
      W[k] = 1;
    }
    for (let it = 0; it < 6; it++) {
      const D2 = new Float32Array(D.length), W2 = new Float32Array(D.length);
      for (let ka = 0; ka < AB; ka++)
        for (let kr = 0; kr < RB; kr++) {
          let sd = 0, sw = 0;
          for (const [da, dr, wk] of [[0, 0, 4], [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1]] as const) {
            const r2 = kr + dr;
            if (r2 < 0 || r2 >= RB) continue;
            const kk = ((ka + da + AB) % AB) * RB + r2;
            sd += D[kk] * W[kk] * wk;
            sw += W[kk] * wk;
          }
          const k = ka * RB + kr;
          D2[k] = sw > 0 ? sd / sw : 0;
          W2[k] = sw > 0 ? 1 : 0;
        }
      D = D2;
      W = W2;
    }
    for (const i of ringIdx) {
      const p = P[i];
      const hw = ss(mc.srcHingeY, mc.srcHingeY + 0.25, src.pos[i * 3 + 1]);
      p.y += D[colOf(p.x, p.z)] * hw;
    }
  }
  // 윗단 높이 제한: 서 있는 곰은 목이 곧아서 띠가 목을 따라 터틀넥처럼 세워져(옆에서 y114~134) 볼까지 올라오고,
  // 정면에서 보면 띠 윗모서리가 목 옆 허공에 떠 보였음. 각도마다 윗단이 topCapCm(정면·옆) ~ topCapBackCm(뒤, 시안처럼 뒤가 높게)
  // 를 넘는 만큼 그 각도 띠 전체를 내림 → 아랫단은 어깨 속으로 들어가 가려지고 겉은 어깨에 얹힌 것처럼 보임.
  if (mc.topCapCm > 0) {
    const cx = ctr.x, cz = ctr.z;
    const AB = BINS;
    const angOf = (p: THREE.Vector3) => Math.atan2(p.x - cx, p.z - cz);
    const top = new Float32Array(AB).fill(-Infinity);
    const kOf = (a: number) => ((Math.floor(((a + Math.PI) / (2 * Math.PI)) * AB) % AB) + AB) % AB;
    for (const i of ringIdx) {
      const k = kOf(angOf(P[i]));
      top[k] = Math.max(top[k], P[i].y);
    }
    let dn = Array.from(top, (t, k) => {
      if (!Number.isFinite(t)) return 0;
      const a = Math.abs(((k + 0.5) / AB) * 2 * Math.PI - Math.PI);
      const cap = mc.topCapCm + (mc.topCapBackCm - mc.topCapCm) * ss((110 * Math.PI) / 180, Math.PI, a);
      return Math.max(0, t - cap);
    });
    for (let it = 0; it < 6; it++) dn = dn.map((v, k) => Math.max(v, (dn[(k + AB - 1) % AB] + 2 * v + dn[(k + 1) % AB]) / 4));
    for (let it = 0; it < 4; it++) dn = dn.map((v, k) => (dn[(k + AB - 1) % AB] + 2 * v + dn[(k + 1) % AB]) / 4);
    for (const i of ringIdx) {
      const p = P[i];
      const f = ((angOf(p) + Math.PI) / (2 * Math.PI)) * AB - 0.5;
      const k0 = ((Math.floor(f) % AB) + AB) % AB, k1 = (k0 + 1) % AB, w = f - Math.floor(f);
      const hw = ss(mc.srcHingeY, mc.srcHingeY + 0.25, src.pos[i * 3 + 1]);
      p.y -= (dn[k0] * (1 - w) + dn[k1] * w) * hw;
    }
  }
  // 올린 뒤 한 번 더 조임 — 이번엔 안쪽 면을 목 속으로 살짝(hugInsetCm) 묻음: 턱이 목보다 넓어서 고리 윗단과 목 사이에
  // 주머니처럼 빈 곳이 생기고 거기로 고리 안쪽 벽이 어둡게 보였음(목 옆이 떠 보임). 묻힌 부분은 몸 표면에 가려짐.
  hug(mc.hugInsetCm);
  // 끝자락: 가슴을 파고든 정점만 이웃과 고르게 밀어냄
  const nb: number[][] = Array.from({ length: n }, () => []);
  for (let t = 0; t < src.index.length; t += 3) {
    const a = src.index[t], b = src.index[t + 1], c = src.index[t + 2];
    nb[a].push(b, c);
    nb[b].push(a, c);
    nb[c].push(a, b);
  }
  for (let pass = 0; pass < 2; pass++) {
    let D = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      if (!isTail[i] || !grid.nearest(P[i], bp, bn)) continue;
      const d = P[i].clone().sub(bp).dot(bn);
      if (d < gap) {
        D[i * 3] = bn.x * (gap - d);
        D[i * 3 + 1] = bn.y * (gap - d);
        D[i * 3 + 2] = bn.z * (gap - d);
      }
    }
    for (let it = 0; it < 6; it++) {
      const E = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        let x = D[i * 3], y = D[i * 3 + 1], z = D[i * 3 + 2];
        for (const j of nb[i]) {
          x += D[j * 3];
          y += D[j * 3 + 1];
          z += D[j * 3 + 2];
        }
        const k = 1 / (nb[i].length + 1);
        const avg = (x * k) ** 2 + (y * k) ** 2 + (z * k) ** 2;
        const self = D[i * 3] ** 2 + D[i * 3 + 1] ** 2 + D[i * 3 + 2] ** 2;
        const use = avg > self;
        E[i * 3] = use ? x * k : D[i * 3];
        E[i * 3 + 1] = use ? y * k : D[i * 3 + 1];
        E[i * 3 + 2] = use ? z * k : D[i * 3 + 2];
      }
      D = E;
    }
    for (let i = 0; i < n; i++) if (isTail[i]) P[i].x += D[i * 3], P[i].y += D[i * 3 + 1], P[i].z += D[i * 3 + 2];
  }

  // 몸 밖으로 (정점마다): 윗단 높이 제한으로 띠를 내린 곳은 어깨가 띠 겉면을 뚫고 나왔음 → 몸 표면 노멀 방향으로 밀어냄
  const pushOut = () => {
    for (let i = 0; i < n; i++) {
      const p = P[i];
      if (!grid.nearest(p, bp, bn)) continue;
      const d = p.clone().sub(bp).dot(bn);
      if (d < gap) p.addScaledVector(bn, gap - d);
    }
  };
  pushOut();
  regularizeFit(src.pos, P, s, mc.smoothCm);
  // 흐린 뒤 다시 살짝 파고든 곳만 한 번 더 (구김 없이 작은 양)
  pushOut();

  const arr = new Float32Array(n * 3);
  P.forEach((p, i) => p.toArray(arr, i * 3));
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  if (src.uv) g.setAttribute("uv", new THREE.BufferAttribute(src.uv, 2));
  g.setIndex(new THREE.BufferAttribute(src.index, 1));
  g.computeVertexNormals();
  return g;
}

/**
 * 맞춘 결과를 공간적으로 매끄럽게 — '터짐' 방지.
 * 고리(각도별 길 따라 옮김)·끝자락(평행 이동)·몸 밀어내기가 정점마다 다른 규칙으로 움직여서, 원본에서 바로 붙어 있던
 * 실 가닥들(매듭에서 고리와 끝자락이 겹친 곳, 뒤에서 고리 끝이 겹친 곳)이 서로 다른 데로 끌려가 찢어져 보였음.
 * → 원본 위치 기준 '전체 강체 이동(Horn)' + '나머지 변형'으로 나누고, 나머지를 원본 공간의 3D 격자에서 가우시안으로 흐려서 다시 입힘.
 *   원본에서 가까운 점은 항상 비슷하게 움직이므로 (메쉬 연결과 무관하게) 갈라질 수 없음. 큰 모양(고리 기울기·부풀림)은 그대로.
 */
function regularizeFit(srcPos: Float32Array, P: THREE.Vector3[], s: number, sigmaCm: number): void {
  const n = P.length;
  if (sigmaCm <= 0 || n === 0) return;
  // 원본(배율 s 적용, cm)
  const Q = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) Q[i] = srcPos[i] * s;
  // ── 전체 강체 이동 (Horn 쿼터니언) ──
  const cq = new THREE.Vector3(), cp = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    cq.x += Q[i * 3]; cq.y += Q[i * 3 + 1]; cq.z += Q[i * 3 + 2];
    cp.add(P[i]);
  }
  cq.divideScalar(n);
  cp.divideScalar(n);
  const S = new Float64Array(9);
  for (let i = 0; i < n; i++) {
    const a0 = Q[i * 3] - cq.x, a1 = Q[i * 3 + 1] - cq.y, a2 = Q[i * 3 + 2] - cq.z;
    const b0 = P[i].x - cp.x, b1 = P[i].y - cp.y, b2 = P[i].z - cp.z;
    S[0] += a0 * b0; S[1] += a0 * b1; S[2] += a0 * b2;
    S[3] += a1 * b0; S[4] += a1 * b1; S[5] += a1 * b2;
    S[6] += a2 * b0; S[7] += a2 * b1; S[8] += a2 * b2;
  }
  const [xx, xy, xz, yx, yy, yz, zx, zy, zz] = S;
  const N = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  // 최대 고유벡터 (거듭제곱법, 양수가 되게 이동)
  let shift = 0;
  for (const r of N) shift = Math.max(shift, r.reduce((t, v) => t + Math.abs(v), 0));
  let v = [1, 0, 0, 0];
  for (let it = 0; it < 200; it++) {
    const w = N.map((r, k) => r.reduce((t, x, j) => t + x * v[j], 0) + shift * v[k]);
    const l = Math.hypot(...w);
    v = w.map((x) => x / l);
  }
  const rot = new THREE.Quaternion(v[1], v[2], v[3], v[0]).normalize();
  const G = (i: number, out: THREE.Vector3) =>
    out.set(Q[i * 3] - cq.x, Q[i * 3 + 1] - cq.y, Q[i * 3 + 2] - cq.z).applyQuaternion(rot).add(cp);
  // ── 나머지 변형을 원본 공간 격자에서 흐림 ──
  const cell = Math.max(0.5, sigmaCm / 2);
  const mn = new THREE.Vector3(Infinity, Infinity, Infinity), mx = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < n; i++) {
    mn.min(new THREE.Vector3(Q[i * 3], Q[i * 3 + 1], Q[i * 3 + 2]));
    mx.max(new THREE.Vector3(Q[i * 3], Q[i * 3 + 1], Q[i * 3 + 2]));
  }
  const pad = sigmaCm * 3;
  mn.subScalar(pad);
  mx.addScalar(pad);
  const nx = Math.ceil((mx.x - mn.x) / cell) + 1, ny = Math.ceil((mx.y - mn.y) / cell) + 1, nz = Math.ceil((mx.z - mn.z) / cell) + 1;
  const NC = nx * ny * nz;
  // 채널: dx, dy, dz, 무게
  let F = new Float32Array(NC * 4);
  const g = new THREE.Vector3();
  const R = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    G(i, g);
    R[i * 3] = P[i].x - g.x; R[i * 3 + 1] = P[i].y - g.y; R[i * 3 + 2] = P[i].z - g.z;
    const fx = (Q[i * 3] - mn.x) / cell, fy = (Q[i * 3 + 1] - mn.y) / cell, fz = (Q[i * 3 + 2] - mn.z) / cell;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    const tx = fx - ix, ty = fy - iy, tz = fz - iz;
    for (let c = 0; c < 8; c++) {
      const ox = c & 1, oy = (c >> 1) & 1, oz = (c >> 2) & 1;
      const w = (ox ? tx : 1 - tx) * (oy ? ty : 1 - ty) * (oz ? tz : 1 - tz);
      const k = ((iz + oz) * ny + (iy + oy)) * nx + (ix + ox);
      F[k * 4] += R[i * 3] * w; F[k * 4 + 1] += R[i * 3 + 1] * w; F[k * 4 + 2] += R[i * 3 + 2] * w; F[k * 4 + 3] += w;
    }
  }
  // 분리형 가우시안 (x, y, z 축 차례)
  const sig = sigmaCm / cell, rad = Math.ceil(sig * 3);
  const ker = Array.from({ length: rad * 2 + 1 }, (_, j) => Math.exp(-((j - rad) ** 2) / (2 * sig * sig)));
  const strides = [4, nx * 4, nx * ny * 4], dims = [nx, ny, nz];
  for (let ax = 0; ax < 3; ax++) {
    const O = new Float32Array(NC * 4);
    const st = strides[ax], dm = dims[ax];
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          const k = ((z * ny + y) * nx + x) * 4;
          const pos = ax === 0 ? x : ax === 1 ? y : z;
          let a0 = 0, a1 = 0, a2 = 0, a3 = 0;
          for (let j = -rad; j <= rad; j++) {
            const q = pos + j;
            if (q < 0 || q >= dm) continue;
            const kk = k + j * st, w = ker[j + rad];
            if (F[kk + 3] === 0) continue;
            a0 += F[kk] * w; a1 += F[kk + 1] * w; a2 += F[kk + 2] * w; a3 += F[kk + 3] * w;
          }
          O[k] = a0; O[k + 1] = a1; O[k + 2] = a2; O[k + 3] = a3;
        }
    F = O;
  }
  for (let i = 0; i < n; i++) {
    const fx = (Q[i * 3] - mn.x) / cell, fy = (Q[i * 3 + 1] - mn.y) / cell, fz = (Q[i * 3 + 2] - mn.z) / cell;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    const tx = fx - ix, ty = fy - iy, tz = fz - iz;
    let d0 = 0, d1 = 0, d2 = 0, wt = 0;
    for (let c = 0; c < 8; c++) {
      const ox = c & 1, oy = (c >> 1) & 1, oz = (c >> 2) & 1;
      const w = (ox ? tx : 1 - tx) * (oy ? ty : 1 - ty) * (oz ? tz : 1 - tz);
      const k = (((iz + oz) * ny + (iy + oy)) * nx + (ix + ox)) * 4;
      d0 += F[k] * w; d1 += F[k + 1] * w; d2 += F[k + 2] * w; wt += F[k + 3] * w;
    }
    G(i, g);
    if (wt > 1e-6) P[i].set(g.x + d0 / wt, g.y + d1 / wt, g.z + d2 / wt);
  }
}

/**
 * 목도리 안쪽 그늘 굽기. 원본 뜨개의 안쪽 면(고리가 끝자락으로 말려 내려가는 곳 안 등)은 다듬지 않은 조각이라
 * 색이 얼룩덜룩해서, 기존 곰에 얹었을 때 그 안이 보이면 '터진' 것처럼 보였음.
 * → 정점마다 반경 3cm 안 목도리 정점들의 무게중심을 보고, 법선이 그 무게중심 쪽을 향하면(= 오목하게 말린 안쪽) 그만큼
 *   얼룩 대신 한 가지 어두운 빨강으로 (주름 그늘처럼). 바깥 겉면·뜨개 골은 무게중심이 뒤쪽이라 그대로.
 */
export function bakeKnitShadow(geo: THREE.BufferGeometry, red: string, strength = 1): void {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const col = geo.getAttribute("color") as THREE.BufferAttribute | undefined;
  if (!col) return;
  if (!geo.getAttribute("normal")) geo.computeVertexNormals();
  const nor = geo.getAttribute("normal") as THREE.BufferAttribute;
  const n = pos.count;
  const CELL = 1, R = 3;
  // 칸별 정점 수·위치 합
  const cells = new Map<number, [number, number, number, number]>();
  const K = (ix: number, iy: number, iz: number) => ((ix + 512) * 1024 + (iy + 512)) * 1024 + (iz + 512);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = K(Math.floor(x / CELL), Math.floor(y / CELL), Math.floor(z / CELL));
    const c = cells.get(k);
    if (c) {
      c[0]++; c[1] += x; c[2] += y; c[3] += z;
    } else cells.set(k, [1, x, y, z]);
  }
  const dark = new THREE.Color(red).multiplyScalar(0.5);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ix = Math.floor(x / CELL), iy = Math.floor(y / CELL), iz = Math.floor(z / CELL);
    let cnt = 0, sx = 0, sy = 0, sz = 0;
    for (let a = -R; a <= R; a++)
      for (let b = -R; b <= R; b++)
        for (let c2 = -R; c2 <= R; c2++) {
          if (a * a + b * b + c2 * c2 > R * R) continue;
          const c = cells.get(K(ix + a, iy + b, iz + c2));
          if (!c) continue;
          cnt += c[0]; sx += c[1]; sy += c[2]; sz += c[3];
        }
    if (!cnt) continue;
    const dx = sx / cnt - x, dy = sy / cnt - y, dz = sz / cnt - z;
    const toward = dx * nor.getX(i) + dy * nor.getY(i) + dz * nor.getZ(i);
    const w = Math.min(1, Math.max(0, (toward - 0.3) / 0.7)) * strength;
    if (w <= 0) continue;
    const ww = w * w * (3 - 2 * w);
    col.setXYZ(i, col.getX(i) + (dark.r - col.getX(i)) * ww, col.getY(i) + (dark.g - col.getY(i)) * ww, col.getZ(i) + (dark.b - col.getZ(i)) * ww);
  }
  col.needsUpdate = true;
}

/**
 * FBX 에 내장돼 있던 색 텍스처(줄무늬)를 정점 색으로 굽기.
 * 원본 UV 는 조각이 아주 많은 아틀라스라 줄인 메쉬에서 UV 보간을 하면 이음매마다 번짐 → 정점마다 그 자리 색을 직접 찍음.
 */
export async function bakeVertexColors(geo: THREE.BufferGeometry, url: string, red: string, cream: string): Promise<void> {
  const uv = geo.getAttribute("uv");
  if (!uv) return;
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });
  const W = img.width, H = img.height;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, W, H).data;
  const col = new Float32Array(uv.count * 3);
  const c = new THREE.Color();
  const cRed = new THREE.Color(red), cCream = new THREE.Color(cream);
  const T = new Float32Array(uv.count);
  for (let i = 0; i < uv.count; i++) {
    // FBX 텍스처는 flipY → v 를 뒤집어 픽셀 좌표로. 3×3 평균 (뜨개 코 하나 크기의 잡티 줄임)
    const x0 = Math.round(uv.getX(i) * (W - 1)), y0 = Math.round((1 - uv.getY(i)) * (H - 1));
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = Math.min(W - 1, Math.max(0, x0 + dx)), y = Math.min(H - 1, Math.max(0, y0 + dy));
        const k = (y * W + x) * 4;
        r += px[k];
        g += px[k + 1];
        b += px[k + 2];
        n++;
      }
    // 원본 텍스처는 빨강/흰 두 색 → 흰 정도(초록 채널)로 시안 PDF(261014)의 빨강·크림 두 색 사이를 섞음
    T[i] = Math.min(1, Math.max(0, (g / n / 255 - 0.08) / 0.84));
  }
  // 줄무늬를 깨끗하게: 메쉬 이웃끼리 크림 비율을 몇 번 평균 → 두 색 사이를 좁은 경사로 (시안 PDF 처럼 또렷한 띠)
  const idx = geo.getIndex();
  if (idx) {
    const nb: number[][] = Array.from({ length: uv.count }, () => []);
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t), b = idx.getX(t + 1), d = idx.getX(t + 2);
      nb[a].push(b, d);
      nb[b].push(a, d);
      nb[d].push(a, b);
    }
    let cur = T;
    for (let it = 0; it < 6; it++) {
      const nx = new Float32Array(cur.length);
      for (let i = 0; i < cur.length; i++) {
        let s = cur[i];
        for (const j of nb[i]) s += cur[j];
        nx[i] = s / (nb[i].length + 1);
      }
      cur = nx;
    }
    T.set(cur);
  }
  for (let i = 0; i < uv.count; i++) {
    const x = Math.min(1, Math.max(0, (T[i] - 0.38) / 0.24));
    c.copy(cRed).lerp(cCream, x * x * (3 - 2 * x));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
}

/** 뜨개 목도리 재질: 정점 색(원본 텍스처에서 구운 줄무늬) × tint, 뜨개 코는 지오메트리 */
export function makeKnitMaterial(mc: Config["outfit"]["muffler"]): THREE.MeshStandardMaterial {
  // 양면: 원본 뜨개 안쪽 면은 다듬지 않아 숭숭 뚫려 있음 → 목도리가 몸에서 뜬 곳(앞 매듭 옆 말린 끝 등)으로 안쪽이 보이면
  // 구멍 사이로 배경이 비쳐 '터진' 것처럼 보였음. 뒷면도 그려 구멍을 메우고, 뒷면(안쪽)은 정점 색(안쪽 조각의 얼룩) 대신
  // 한 가지 어두운 빨강 — 말린 곳 안이 그늘로 보이게.
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, color: new THREE.Color(mc.tint), roughness: 0.85, metalness: 0, envMapIntensity: 0.7, side: THREE.DoubleSide });
  const dark = new THREE.Color(mc.red).multiplyScalar(0.4);
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>\n  if (!gl_FrontFacing) diffuseColor.rgb = vec3(${dark.r.toFixed(4)}, ${dark.g.toFixed(4)}, ${dark.b.toFixed(4)});`,
    );
  };
  m.customProgramCacheKey = () => "pv-knit";
  return m;
}

/**
 * 맞춘 목도리(기존 곰 rest 좌표 cm + 정점 색)를 파일로 — 맞추기가 폰에선 10초 넘게 걸려서 개발 PC 에서 한 번 구워 둠.
 * 포맷: [u32 헤더 길이][JSON {verts, tris, colors}][f32 pos][u8 rgb (4바이트 정렬)][u32 index]
 */
export function serializeFitted(g: THREE.BufferGeometry): ArrayBuffer {
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const col = g.getAttribute("color") as THREE.BufferAttribute | undefined;
  const idx = g.getIndex()!;
  const n = pos.count, t = idx.count / 3;
  const raw = new TextEncoder().encode(JSON.stringify({ verts: n, tris: t, colors: !!col }));
  const hl = raw.length + ((4 - ((4 + raw.length) % 4)) % 4);
  const colBytes = col ? Math.ceil((n * 3) / 4) * 4 : 0;
  const buf = new ArrayBuffer(4 + hl + n * 12 + colBytes + t * 12);
  new DataView(buf).setUint32(0, hl, true);
  const h = new Uint8Array(buf, 4, hl);
  h.fill(32);
  h.set(raw);
  let off = 4 + hl;
  new Float32Array(buf, off, n * 3).set(pos.array as Float32Array);
  off += n * 12;
  if (col) {
    const u8 = new Uint8Array(buf, off, n * 3);
    for (let i = 0; i < n * 3; i++) u8[i] = Math.round(Math.min(1, Math.max(0, col.array[i] as number)) * 255);
    off += colBytes;
  }
  new Uint32Array(buf, off, t * 3).set(idx.array as ArrayLike<number>);
  return buf;
}

/** serializeFitted 로 구운 목도리 읽기 (없으면 null) */
export async function loadFitted(url: string): Promise<THREE.BufferGeometry | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  if (buf.byteLength < 8) return null;
  const len = new DataView(buf).getUint32(0, true);
  let h: { verts: number; tris: number; colors: boolean };
  try {
    h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len)));
  } catch {
    return null; // 개발 서버는 없는 파일에 index.html 을 줌
  }
  let off = 4 + len;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(buf.slice(off, off + h.verts * 12)), 3));
  off += h.verts * 12;
  if (h.colors) {
    const u8 = new Uint8Array(buf, off, h.verts * 3);
    const c = new Float32Array(h.verts * 3);
    for (let i = 0; i < c.length; i++) c[i] = u8[i] / 255;
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    off += Math.ceil((h.verts * 3) / 4) * 4;
  }
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(buf.slice(off, off + h.tris * 12)), 1));
  g.computeVertexNormals();
  return g;
}
