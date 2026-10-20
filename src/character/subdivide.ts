/**
 * OBJ(쿼드 케이지) 파서 + Catmull-Clark 세분화.
 * 원본 pu_stand.obj 는 C4D 서브디비전 케이지라 그대로 그리면 각지고 부풀어 보인다.
 * C4D 렌더(가이드북 3D 턴어라운드)와 같은 실루엣을 얻으려고 런타임에 2단계 세분화한다.
 * UV 는 face-varying 으로 쌍선형 보간 (스무딩하지 않음).
 */
import * as THREE from "three";

export interface PolyMesh {
  name: string;
  positions: number[][]; // 이 객체가 쓰는 정점만 (로컬 인덱스)
  uvs: number[][];
  faces: number[][]; // 정점 인덱스
  faceUvs: (number[] | null)[]; // UV 인덱스 (없으면 null)
}

/** OBJ 텍스트 → 객체(o)별 폴리곤 메쉬. 정점은 전역 인덱스라 객체별로 재색인한다. */
export function parseObj(text: string): PolyMesh[] {
  const V: number[][] = [];
  const VT: number[][] = [];
  const raw: { name: string; faces: number[][]; faceUvs: (number[] | null)[] }[] = [];
  let cur: (typeof raw)[number] | null = null;

  for (const line of text.split(/\r?\n/)) {
    const p = line.trim().split(/\s+/);
    switch (p[0]) {
      case "v":
        V.push([+p[1], +p[2], +p[3]]);
        break;
      case "vt":
        VT.push([+p[1], +p[2]]);
        break;
      case "o":
      case "g":
        cur = { name: p[1] ?? `obj${raw.length}`, faces: [], faceUvs: [] };
        raw.push(cur);
        break;
      case "f": {
        if (!cur) {
          cur = { name: "default", faces: [], faceUvs: [] };
          raw.push(cur);
        }
        const f: number[] = [];
        const fu: number[] = [];
        for (const tok of p.slice(1)) {
          const [a, b] = tok.split("/");
          const vi = +a;
          f.push(vi < 0 ? V.length + vi : vi - 1);
          if (b) fu.push(+b < 0 ? VT.length + +b : +b - 1);
        }
        cur.faces.push(f);
        cur.faceUvs.push(fu.length === f.length ? fu : null);
        break;
      }
    }
  }

  return raw
    .filter((o) => o.faces.length > 0)
    .map((o) => {
      const vmap = new Map<number, number>();
      const umap = new Map<number, number>();
      const positions: number[][] = [];
      const uvs: number[][] = [];
      const faces = o.faces.map((f) =>
        f.map((g) => {
          let l = vmap.get(g);
          if (l === undefined) {
            l = positions.length;
            vmap.set(g, l);
            positions.push(V[g].slice());
          }
          return l;
        }),
      );
      const faceUvs = o.faceUvs.map((fu) =>
        fu
          ? fu.map((g) => {
              let l = umap.get(g);
              if (l === undefined) {
                l = uvs.length;
                umap.set(g, l);
                uvs.push(VT[g]?.slice() ?? [0, 0]);
              }
              return l;
            })
          : null,
      );
      return { name: o.name, positions, uvs, faces, faceUvs };
    });
}

/** Catmull-Clark 1단계. 경계 엣지는 crease 규칙(중점 / 3:1:1 vertex). 결과는 전부 쿼드. */
export function catmullClark(m: PolyMesh): PolyMesh {
  const P = m.positions;
  const nV = P.length;
  const add = (a: number[], b: number[], s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
  const scale = (a: number[], s: number) => [a[0] * s, a[1] * s, a[2] * s];

  // face points
  const fp = m.faces.map((f) => scale(f.reduce((acc, i) => add(acc, P[i]), [0, 0, 0]), 1 / f.length));

  // edges
  const edgeKey = (a: number, b: number) => (a < b ? a * nV + b : b * nV + a);
  const edges = new Map<number, { a: number; b: number; faces: number[]; idx: number }>();
  m.faces.forEach((f, fi) => {
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      const k = edgeKey(a, b);
      let e = edges.get(k);
      if (!e) {
        e = { a, b, faces: [], idx: edges.size };
        edges.set(k, e);
      }
      e.faces.push(fi);
    }
  });

  const ep: number[][] = new Array(edges.size);
  const vFaces: number[][] = Array.from({ length: nV }, () => []);
  const vEdges: number[][] = Array.from({ length: nV }, () => []);
  const vBoundaryNbrs: number[][] = Array.from({ length: nV }, () => []);
  for (const e of edges.values()) {
    const mid = scale(add(P[e.a], P[e.b]), 0.5);
    if (e.faces.length === 2) {
      ep[e.idx] = scale(add(add(P[e.a], P[e.b]), add(fp[e.faces[0]], fp[e.faces[1]])), 0.25);
    } else {
      ep[e.idx] = mid;
      vBoundaryNbrs[e.a].push(e.b);
      vBoundaryNbrs[e.b].push(e.a);
    }
    vEdges[e.a].push(e.idx);
    vEdges[e.b].push(e.idx);
  }
  m.faces.forEach((f, fi) => f.forEach((v) => vFaces[v].push(fi)));
  const edgeArr = [...edges.values()].sort((x, y) => x.idx - y.idx);

  // vertex points
  const vp = P.map((p, v) => {
    const bn = vBoundaryNbrs[v];
    if (bn.length === 2) return scale(add(scale(p, 6), add(P[bn[0]], P[bn[1]])), 1 / 8);
    if (bn.length > 0) return p.slice(); // 비다양체 경계 — 고정
    const n = vFaces[v].length;
    if (n < 3) return p.slice();
    const F = scale(vFaces[v].reduce((acc, fi) => add(acc, fp[fi]), [0, 0, 0]), 1 / n);
    const R = scale(
      vEdges[v].reduce((acc, ei) => add(acc, scale(add(P[edgeArr[ei].a], P[edgeArr[ei].b]), 0.5)), [0, 0, 0]),
      1 / vEdges[v].length,
    );
    return scale(add(add(F, scale(R, 2)), scale(p, n - 3)), 1 / n);
  });

  // 새 정점 배열: [vertex points | edge points | face points]
  const positions = [...vp, ...ep, ...fp];
  const eBase = nV, fBase = nV + ep.length;

  const uvs: number[][] = [];
  const faces: number[][] = [];
  const faceUvs: (number[] | null)[] = [];
  const lerp2 = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

  m.faces.forEach((f, fi) => {
    const n = f.length;
    const fu = m.faceUvs[fi];
    const uvC = fu ? fu.reduce((acc, u) => [acc[0] + m.uvs[u][0] / n, acc[1] + m.uvs[u][1] / n], [0, 0]) : null;
    for (let i = 0; i < n; i++) {
      const prev = (i + n - 1) % n, next = (i + 1) % n;
      const eNext = edges.get(edgeKey(f[i], f[next]))!.idx;
      const ePrev = edges.get(edgeKey(f[prev], f[i]))!.idx;
      faces.push([f[i], eBase + eNext, fBase + fi, eBase + ePrev]);
      if (fu && uvC) {
        const u0 = m.uvs[fu[i]], uN = m.uvs[fu[next]], uP = m.uvs[fu[prev]];
        const base = uvs.length;
        uvs.push(u0.slice(), lerp2(u0, uN), uvC.slice(), lerp2(uP, u0));
        faceUvs.push([base, base + 1, base + 2, base + 3]);
      } else faceUvs.push(null);
    }
  });

  return { name: m.name, positions, uvs, faces, faceUvs };
}

/**
 * 폴리곤 메쉬 → 인덱스드 BufferGeometry.
 * 노멀은 위치 기준(면적 가중)으로 계산해 UV 심에서 갈라지지 않게 한다 (털 셸 오프셋이 노멀을 따라가므로 중요).
 */
export function toBufferGeometry(m: PolyMesh): THREE.BufferGeometry {
  const P = m.positions;
  const N = P.map(() => [0, 0, 0]);
  for (const f of m.faces) {
    // 뉴웰 법선 (면적 가중)
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < f.length; i++) {
      const a = P[f[i]], b = P[f[(i + 1) % f.length]];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    for (const v of f) {
      N[v][0] += nx;
      N[v][1] += ny;
      N[v][2] += nz;
    }
  }

  // (정점, UV값) 쌍으로 중복 제거
  const key2idx = new Map<string, number>();
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  const index: number[] = [];
  const vert = (v: number, u: number[] | null) => {
    const k = u ? `${v}|${u[0].toFixed(5)}|${u[1].toFixed(5)}` : `${v}|`;
    let i = key2idx.get(k);
    if (i === undefined) {
      i = pos.length / 3;
      key2idx.set(k, i);
      pos.push(P[v][0], P[v][1], P[v][2]);
      const n = N[v], l = Math.hypot(n[0], n[1], n[2]) || 1;
      nor.push(n[0] / l, n[1] / l, n[2] / l);
      uv.push(u ? u[0] : 0, u ? u[1] : 0);
    }
    return i;
  };
  m.faces.forEach((f, fi) => {
    const fu = m.faceUvs[fi];
    const ids = f.map((v, i) => vert(v, fu ? m.uvs[fu[i]] : null));
    for (let i = 1; i < ids.length - 1; i++) index.push(ids[0], ids[i], ids[i + 1]);
  });

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * 닫힌 메쉬인데 면 방향이 안쪽으로 뒤집혀 있으면(부호 있는 부피 < 0) 바로잡는다.
 * pu_stand.obj 의 pu_eyes_L 은 면이 전부 안쪽 → 앞면이 컬링돼 눈알 뒤쪽만 보이고, 고개를 돌리면
 * 그 사이로 털이 비쳐 '초승달 눈'이 됐다. 열린 메쉬(스카프 등)는 판단 불가라 그대로 둔다.
 * @returns 뒤집었으면 true
 */
export function fixInvertedWinding(m: PolyMesh): boolean {
  const edges = new Map<string, number>();
  for (const f of m.faces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  for (const c of edges.values()) if (c !== 2) return false; // 열린 메쉬
  const P = m.positions;
  let vol = 0;
  for (const f of m.faces) {
    for (let i = 1; i < f.length - 1; i++) {
      const a = P[f[0]], b = P[f[i]], c = P[f[i + 1]];
      vol += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    }
  }
  if (vol >= 0) return false;
  m.faces = m.faces.map((f) => f.slice().reverse());
  m.faceUvs = m.faceUvs.map((fu) => (fu ? fu.slice().reverse() : null));
  return true;
}

export function subdivide(m: PolyMesh, levels: number): PolyMesh {
  let out = m;
  for (let i = 0; i < levels; i++) out = catmullClark(out);
  return out;
}
