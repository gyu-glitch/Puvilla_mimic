import * as THREE from "three";
import { log } from "../logger";

/**
 * 입 홈 메우기.
 * pu_stand.obj 에는 입이 '갈고리 모양 홈'으로 조형돼 있지만, 가이드북 3D 렌더(44~52장)의 입은
 * 매끈한 털 표면 위 가는 먹선뿐이다. 그래서 로드 시 홈을 메워 표면을 매끈하게 만들고,
 * 입 모양(미소·시무룩·'o')은 전부 셰이더 먹선으로 그린다 (puuvillaShaders.ts).
 *
 * 1) 홈 깊이: 같은 x 에서 '위쪽 앞면'과 '아래쪽 앞면' 중 덜 나온 쪽보다 얼마나 들어가 있나
 * 2) 홈 정점을 그 높이(바깥 표면)까지 끌어올림 → 주변까지 라플라시안 스무딩으로 이음매 없이
 * 3) 노멀을 위치 기준으로 다시 계산 (UV 심에서 갈라지지 않게 용접 단위)
 * 반환: 원래 입선(이음선) 곡선 y = seamY + seamK·x², 반폭 — 먹선을 조형 위치 그대로 그리기 위함
 */
export interface MouthInfo {
  halfW: number;
  seamY: number;
  seamK: number;
}

export interface MouthFillOpts {
  region: { yMin: number; yMax: number; zMin: number; xMax: number };
}

const ss = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function fillMouthGroove(geo: THREE.BufferGeometry, o: MouthFillOpts): MouthInfo {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const nor = geo.getAttribute("normal") as THREE.BufferAttribute;
  const index = geo.getIndex()!;
  const n = pos.count;
  const R = o.region;

  // ── 위치 기준 용접 (전체 — 노멀 재계산에도 씀) ──
  const gid = new Int32Array(n);
  const kmap = new Map<string, number>();
  const P: number[] = [];
  for (let i = 0; i < n; i++) {
    const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let g = kmap.get(k);
    if (g === undefined) {
      g = P.length / 3;
      kmap.set(k, g);
      P.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    gid[i] = g;
  }
  const G = P.length / 3;
  const inRegion = (g: number) => {
    const x = P[g * 3], y = P[g * 3 + 1], z = P[g * 3 + 2];
    return y > R.yMin && y < R.yMax && z > R.zMin && Math.abs(x) < R.xMax;
  };
  const region: number[] = [];
  for (let g = 0; g < G; g++) if (inRegion(g)) region.push(g);

  // ── 1. 홈 깊이 ──
  const depth = new Float32Array(G);
  for (const i of region) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    let zA = -Infinity, zB = -Infinity;
    for (const j of region) {
      if (Math.abs(P[j * 3] - x) > 0.7) continue;
      const dy = P[j * 3 + 1] - y;
      if (dy > 0.4 && dy < 2.6) zA = Math.max(zA, P[j * 3 + 2]);
      else if (dy < -0.4 && dy > -2.6) zB = Math.max(zB, P[j * 3 + 2]);
    }
    depth[i] = Number.isFinite(zA) && Number.isFinite(zB) ? Math.max(0, Math.min(zA, zB) - z) : 0;
  }
  // 홈 범위: x=0 에서 끊기지 않고 이어지는 데까지 (볼 옆면 오목한 곳 제외)
  const bins = new Set<number>();
  for (const i of region) if (depth[i] > 0.5 && Math.abs(P[i * 3 + 1] - 131.5) < 3.5) bins.add(Math.round(P[i * 3]));
  let Wb = 0;
  while (bins.has(Wb + 1) && bins.has(-(Wb + 1))) Wb++;
  const W = Wb + 0.5;
  const groove = (g: number) => depth[g] > 0.05 && Math.abs(P[g * 3]) <= W + 1.5 && Math.abs(P[g * 3 + 1] - 131.5) < 3.5;

  // 원래 입선 곡선 (앞쪽 얕은 홈 정점들로 y = a + k·x² 최소제곱)
  let s0 = 0, s1 = 0, s2 = 0, t0 = 0, t1 = 0;
  for (const i of region) {
    if (!groove(i) || depth[i] < 0.2 || depth[i] > 1.0) continue;
    const x2 = P[i * 3] * P[i * 3], y = P[i * 3 + 1];
    s0 += 1; s1 += x2; s2 += x2 * x2; t0 += y; t1 += x2 * y;
  }
  const det = s0 * s2 - s1 * s1;
  const seamK = Math.abs(det) > 1e-6 ? (s0 * t1 - s1 * t0) / det : 0.04;
  const seamY = Math.abs(det) > 1e-6 ? (t0 - seamK * s1) / s0 : 131.3;

  // ── 2. 메우기: 홈 정점을 바깥 표면 높이로 + 주변 스무딩 ──
  const moved = new Uint8Array(G);
  for (const g of region) {
    if (!groove(g)) continue;
    P[g * 3 + 2] += depth[g];
    moved[g] = 1;
  }
  const nb: number[][] = Array.from({ length: G }, () => []);
  for (let t = 0; t < index.count; t += 3) {
    const a = gid[index.getX(t)], b = gid[index.getX(t + 1)], c = gid[index.getX(t + 2)];
    nb[a].push(b, c);
    nb[b].push(a, c);
    nb[c].push(a, b);
  }
  // 스무딩 대상: 홈 + 입선 주변 띠 (바깥으로 갈수록 약하게)
  const smoothW = new Float32Array(G);
  for (const g of region) {
    const x = P[g * 3], y = P[g * 3 + 1];
    const ys = seamY + seamK * x * x;
    const w = (1 - ss(1.8, 4.0, Math.abs(y - ys))) * (1 - ss(W + 2, W + 6, Math.abs(x)));
    smoothW[g] = moved[g] ? 1 : w * 0.8;
  }
  for (let it = 0; it < 60; it++) {
    const next = P.slice();
    for (const g of region) {
      const w = smoothW[g];
      if (w <= 0 || nb[g].length === 0) continue;
      let x = 0, y = 0, z = 0;
      for (const j of nb[g]) {
        x += P[j * 3];
        y += P[j * 3 + 1];
        z += P[j * 3 + 2];
      }
      const k = 1 / nb[g].length;
      next[g * 3] += (x * k - P[g * 3]) * w * 0.5;
      next[g * 3 + 1] += (y * k - P[g * 3 + 1]) * w * 0.5;
      next[g * 3 + 2] += (z * k - P[g * 3 + 2]) * w * 0.5;
    }
    for (let q = 0; q < next.length; q++) P[q] = next[q];
  }
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const normals = (): Float32Array => {
    const N = new Float32Array(G * 3);
    for (let t = 0; t < index.count; t += 3) {
      const ga = gid[index.getX(t)], gb = gid[index.getX(t + 1)], gc = gid[index.getX(t + 2)];
      a.fromArray(P, ga * 3);
      b.fromArray(P, gb * 3);
      c.fromArray(P, gc * 3);
      e1.subVectors(b, a).cross(e2.subVectors(c, a));
      for (const g of [ga, gb, gc]) {
        N[g * 3] += e1.x;
        N[g * 3 + 1] += e1.y;
        N[g * 3 + 2] += e1.z;
      }
    }
    for (let g = 0; g < G; g++) {
      a.set(N[g * 3], N[g * 3 + 1], N[g * 3 + 2]).normalize();
      N[g * 3] = a.x;
      N[g * 3 + 1] = a.y;
      N[g * 3 + 2] = a.z;
    }
    return N;
  };

  // ── 2b. 접힘 펴기 ──
  // 홈 벽(세로면)을 바깥 높이로 끌어올리면 벽 정점들이 같은 자리로 몰려 '뒤집힌 주름'이 남는다
  // (입 끝 갈고리 자국·흰 점의 원인). 홈 + 뒤집힌 정점 + 주변 3겹을 패치로 잡고
  //  xy: 경계 고정 Tutte 임베딩(이웃 평균 반복 — 볼록 경계면 접힘이 생길 수 없음)
  //  z : 패치 바깥 고리 정점들로 맞춘 2차 곡면 → 주둥이 곡률 그대로 매끈하게
  const N0 = normals();
  const seamAt = (x: number) => seamY + seamK * x * x;
  const patch = new Uint8Array(G);
  for (const g of region) {
    const x = P[g * 3], y = P[g * 3 + 1];
    const near = Math.abs(x) <= W + 2 && Math.abs(y - seamAt(x)) < 3;
    if (moved[g] || (near && N0[g * 3 + 2] < 0.3)) patch[g] = 1;
  }
  const dilate = (src: Uint8Array, rings: number) => {
    const out = src.slice();
    for (let r = 0; r < rings; r++) {
      const cur = out.slice();
      for (const g of region) if (cur[g]) for (const j of nb[g]) if (inRegion(j)) out[j] = 1;
    }
    return out;
  };
  const patchD = dilate(patch, 3);
  const ring = dilate(patchD, 3);
  const inner: number[] = [], fitPts: number[] = [];
  for (const g of region) {
    if (patchD[g]) inner.push(g);
    else if (ring[g]) fitPts.push(g);
  }
  // 2차 곡면 z = c0 + c1 x + c2 y + c3 x² + c4 xy + c5 y² (최소제곱, 정규방정식)
  const A = Array.from({ length: 6 }, () => new Float64Array(7));
  for (const g of fitPts) {
    const x = P[g * 3], y = P[g * 3 + 1] - seamY, z = P[g * 3 + 2];
    const f = [1, x, y, x * x, x * y, y * y];
    for (let r = 0; r < 6; r++) {
      for (let q = 0; q < 6; q++) A[r][q] += f[r] * f[q];
      A[r][6] += f[r] * z;
    }
  }
  for (let col = 0; col < 6; col++) {
    let piv = col;
    for (let r = col + 1; r < 6; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = 0; r < 6; r++) {
      if (r === col || A[col][col] === 0) continue;
      const fct = A[r][col] / A[col][col];
      for (let q = col; q < 7; q++) A[r][q] -= fct * A[col][q];
    }
  }
  const coef = A.map((row, i) => (row[i] ? row[6] / row[i] : 0));
  const zFit = (x: number, y0: number) => {
    const y = y0 - seamY;
    return coef[0] + coef[1] * x + coef[2] * y + coef[3] * x * x + coef[4] * x * y + coef[5] * y * y;
  };
  if (fitPts.length >= 12 && inner.length > 0) {
    for (let it = 0; it < 600; it++) {
      for (const g of inner) {
        let x = 0, y = 0;
        for (const j of nb[g]) {
          x += P[j * 3];
          y += P[j * 3 + 1];
        }
        const k = 1 / nb[g].length;
        P[g * 3] = x * k;
        P[g * 3 + 1] = y * k;
      }
    }
    for (const g of inner) P[g * 3 + 2] = zFit(P[g * 3], P[g * 3 + 1]);

    // ── 2c. 주둥이 다시 덮기 ──
    // 패치(2차 곡면)와 원래 얼굴이 만나는 위·아래 경계(y≈130·133)에서 기울기가 꺾여, 코 아래 U자 그늘·입선 위 가로 턱으로 보였음.
    // 입 주변 타원(가로 ±7.5, 세로 ±4.5cm)은 하나의 매끈한 좌우대칭 곡면으로, 바깥 타원(±11 × ±7.5cm)까지는 원래 얼굴과
    // 부드러운 비율로 섞음 — 비율 자체가 매끈하게 변하니 경계에 꺾임이 생기지 않음.
    const RX0 = 7.5, RY0 = 4.5, RX1 = 11, RY1 = 7.5;
    const e = (x: number, y: number, rx: number, ry: number) => Math.hypot(x / rx, (y - seamY) / ry);
    const muzzle: number[] = [];
    for (let g = 0; g < G; g++) {
      const x = P[g * 3], y = P[g * 3 + 1], z = P[g * 3 + 2];
      if (z > 25 && e(x, y, RX1, RY1) < 1) muzzle.push(g);
    }
    // 좌우대칭 3차 곡면: z = Σ c_k f_k(x², y)  — 기준 점: 섞는 띠(안 타원 밖·바깥 타원 안)의 원래 얼굴 (앞을 보는 면만)
    const feats = (x: number, y0: number) => {
      const y = y0 - seamY, x2 = x * x;
      return [1, y, y * y, y * y * y, x2, x2 * y, x2 * y * y, x2 * x2];
    };
    const K = 8;
    const M = Array.from({ length: K }, () => new Float64Array(K + 1));
    let fitN = 0;
    for (const g of muzzle) {
      const x = P[g * 3], y = P[g * 3 + 1];
      if (e(x, y, RX0, RY0) < 1 || N0[g * 3 + 2] < 0.3) continue;
      const f = feats(x, y);
      for (let r = 0; r < K; r++) {
        for (let q = 0; q < K; q++) M[r][q] += f[r] * f[q];
        M[r][K] += f[r] * P[g * 3 + 2];
      }
      fitN++;
    }
    for (let col = 0; col < K; col++) {
      let piv = col;
      for (let r = col + 1; r < K; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      [M[col], M[piv]] = [M[piv], M[col]];
      for (let r = 0; r < K; r++) {
        if (r === col || M[col][col] === 0) continue;
        const fct = M[r][col] / M[col][col];
        for (let q = col; q <= K; q++) M[r][q] -= fct * M[col][q];
      }
    }
    const cz = M.map((row, i) => (row[i] ? row[K] / row[i] : 0));
    if (fitN > 30) {
      for (const g of muzzle) {
        const x = P[g * 3], y = P[g * 3 + 1];
        const s0 = e(x, y, RX0, RY0), s1 = e(x, y, RX1, RY1);
        // 같은 방향 반직선에서 안 타원(0) → 바깥 타원(1) 진행도
        const t = s0 <= 1 ? 0 : Math.min(1, (s0 - 1) / Math.max(1e-6, s0 / s1 - 1));
        const w = 1 - ss(0, 1, t);
        if (w <= 0) continue;
        const f = feats(x, y);
        let zf = 0;
        for (let k = 0; k < K; k++) zf += cz[k] * f[k];
        P[g * 3 + 2] += (zf - P[g * 3 + 2]) * w;
      }
    }
    log.info("mouth", `muzzle resurface: fit=${fitN} verts=${muzzle.length}`);
  }

  for (let i = 0; i < n; i++) {
    const g = gid[i];
    pos.setXYZ(i, P[g * 3], P[g * 3 + 1], P[g * 3 + 2]);
  }
  pos.needsUpdate = true;

  // ── 3. 노멀 재계산 (용접 단위, 면적 가중) ──
  const N = normals();
  let flipped = 0;
  for (const g of region) if (Math.abs(P[g * 3]) <= W + 2 && Math.abs(P[g * 3 + 1] - seamAt(P[g * 3])) < 3 && N[g * 3 + 2] < 0.3) flipped++;
  log.info("mouth", `fold fix: patch=${inner.length} fit=${fitPts.length} 남은 뒤집힘=${flipped}`);
  for (let i = 0; i < n; i++) {
    const g = gid[i];
    a.set(N[g * 3], N[g * 3 + 1], N[g * 3 + 2]).normalize();
    nor.setXYZ(i, a.x, a.y, a.z);
  }
  nor.needsUpdate = true;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  // 셰이더 호환용 속성 (홈이 없어졌으므로 0)
  geo.setAttribute("aCavity", new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.setAttribute("aLip", new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.setAttribute("aMouthIn", new THREE.BufferAttribute(new Float32Array(n * 3), 3));

  log.info("mouth", `groove filled: halfW=${W.toFixed(1)} seam y=${seamY.toFixed(2)}+${seamK.toFixed(4)}x² moved=${moved.reduce((s, v) => s + v, 0)}`);
  return { halfW: W, seamY, seamK };
}

/**
 * 깊이(z)만 라플라시안으로 고르게 (위치 기준 용접 단위). weight(x,y,z) 0~1 = 이 정점을 얼마나 고를지.
 * 코 아래 메쉬 주름(코가 붙는 자리)이 U자 그늘로 보이던 것을 펴는 데 씀. 노멀은 다시 계산.
 */
export function smoothDepth(geo: THREE.BufferGeometry, weight: (x: number, y: number, z: number) => number, iters: number): number {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const nor = geo.getAttribute("normal") as THREE.BufferAttribute;
  const index = geo.getIndex()!;
  const n = pos.count;
  const gid = new Int32Array(n);
  const kmap = new Map<string, number>();
  const P: number[] = [];
  for (let i = 0; i < n; i++) {
    const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let g = kmap.get(k);
    if (g === undefined) {
      g = P.length / 3;
      kmap.set(k, g);
      P.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    gid[i] = g;
  }
  const G = P.length / 3;
  const W = new Float32Array(G);
  const act: number[] = [];
  for (let g = 0; g < G; g++) {
    W[g] = weight(P[g * 3], P[g * 3 + 1], P[g * 3 + 2]);
    if (W[g] > 0) act.push(g);
  }
  if (!act.length) return 0;
  const nb: number[][] = Array.from({ length: G }, () => []);
  for (let t = 0; t < index.count; t += 3) {
    const a = gid[index.getX(t)], b = gid[index.getX(t + 1)], c = gid[index.getX(t + 2)];
    nb[a].push(b, c);
    nb[b].push(a, c);
    nb[c].push(a, b);
  }
  for (let it = 0; it < iters; it++) {
    const zn = new Float32Array(act.length);
    for (let q = 0; q < act.length; q++) {
      const g = act[q];
      let z = 0;
      for (const j of nb[g]) z += P[j * 3 + 2];
      zn[q] = P[g * 3 + 2] + (z / nb[g].length - P[g * 3 + 2]) * 0.5 * W[g];
    }
    for (let q = 0; q < act.length; q++) P[act[q] * 3 + 2] = zn[q];
  }
  for (let i = 0; i < n; i++) pos.setZ(i, P[gid[i] * 3 + 2]);
  pos.needsUpdate = true;
  // 노멀 (용접 단위, 면적 가중)
  const N = new Float32Array(G * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (let t = 0; t < index.count; t += 3) {
    const ga = gid[index.getX(t)], gb = gid[index.getX(t + 1)], gc = gid[index.getX(t + 2)];
    a.fromArray(P, ga * 3);
    b.fromArray(P, gb * 3);
    c.fromArray(P, gc * 3);
    e1.subVectors(b, a).cross(e2.subVectors(c, a));
    for (const g of [ga, gb, gc]) {
      N[g * 3] += e1.x;
      N[g * 3 + 1] += e1.y;
      N[g * 3 + 2] += e1.z;
    }
  }
  const act2 = new Uint8Array(G);
  for (const g of act) {
    act2[g] = 1;
    for (const j of nb[g]) act2[j] = 1;
  }
  for (let i = 0; i < n; i++) {
    const g = gid[i];
    if (!act2[g]) continue;
    a.set(N[g * 3], N[g * 3 + 1], N[g * 3 + 2]).normalize();
    nor.setXYZ(i, a.x, a.y, a.z);
  }
  nor.needsUpdate = true;
  return act.length;
}
