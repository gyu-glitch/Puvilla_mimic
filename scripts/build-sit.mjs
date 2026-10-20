// `node scripts/build-sit.mjs [A.fbx] [몸 삼각형 수] [머리 드는 각도°]`
// 새 푸빌라 FBX(asset/Puuvilla_V02, 앉은 조형물 + 뜨개 목도리)를 실시간용으로 변환:
//  1) 몸(흰 재질)과 검은 부품(눈 2·코·입선)을 나눔
//  2) 몸이 살짝 옆으로 돌아 있어 눈 높이선이 좌우가 되게 돌림, 숙인 고개를 목도리 고리 평면 기준으로 들어 정면을 보게(목 띠는 목도리에 가려짐)
//  3) 기존 서 있는 푸빌라(pu_stand.obj)의 눈 위치·간격에 맞춰 크기·위치를 옮김 → 기존 얼굴 파이프라인(cm 좌표 상수)을 그대로 씀
//  4) 몸·목도리 줄이기(meshoptimizer)
// 출력: public/models/pu_sit.obj (pu_body / pu_eyes_L / pu_eyes_R / pu_nose / pu_mouth), public/models/muffler_sit.bin (cm 좌표 + 정점별 UV)
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
globalThis.self = globalThis;
globalThis.window = globalThis;
const fakeEl = () => ({ style: {}, addEventListener() {}, removeEventListener() {}, setAttribute() {}, getContext: () => null });
globalThis.document = { createElementNS: fakeEl, createElement: fakeEl };
const THREE = await import("three");
const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
const { mergeVertices } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
const { MeshoptSimplifier } = await import("meshoptimizer");

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const src = process.argv[2] || resolve(root, "../asset/Puuvilla_V02/A.fbx");
const bodyTris = Number(process.argv[3] || 60000);
const liftDeg = Number(process.argv[4] || 12);
const mufTris = 180000;

const buf = readFileSync(src);
const fbx = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
fbx.updateMatrixWorld(true);
let bodyM, mufM;
fbx.traverse((o) => {
  if (o.isMesh && /Puvilla/i.test(o.name)) bodyM = o;
  if (o.isMesh && /Scarf/i.test(o.name)) mufM = o;
});
const bodyG = bodyM.geometry.clone().applyMatrix4(bodyM.matrixWorld);
const mufG = mufM.geometry.clone().applyMatrix4(mufM.matrixWorld);

// ── 1. 흰 몸 / 검은 부품 나누기 ──
const bp = bodyG.attributes.position;
const white = [], black = [];
for (const gr of bodyG.groups) for (let i = gr.start; i < gr.start + gr.count; i += 3) (gr.materialIndex === 0 ? black : white).push(i);
const kf = (x, y, z) => `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
// 검은 부품 연결 성분
const vid = new Map(), par = [];
const find = (a) => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
const gv = (i) => { const k = kf(bp.getX(i), bp.getY(i), bp.getZ(i)); if (!vid.has(k)) { vid.set(k, par.length); par.push(par.length); } return vid.get(k); };
for (const t of black) { const a = gv(t), b = gv(t + 1), c = gv(t + 2); par[find(b)] = find(a); par[find(c)] = find(a); }
const comps = new Map();
for (const t of black) { const r = find(gv(t)); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(t); }
const parts = [...comps.values()].map((tris) => {
  const b = new THREE.Box3();
  for (const t of tris) for (let k = 0; k < 3; k++) b.expandByPoint(new THREE.Vector3(bp.getX(t + k), bp.getY(t + k), bp.getZ(t + k)));
  const s = b.getSize(new THREE.Vector3());
  return { tris, box: b, c: b.getCenter(new THREE.Vector3()), size: s };
}).sort((a, b) => b.tris.length - a.tris.length);
if (parts.length < 4) throw new Error(`검은 부품 ${parts.length}개 (눈2·코·입 기대)`);
// 입선 = 가장 납작(세로 얇음), 코 = 나머지 중 가장 큼, 눈 = 남은 둘
const mouth = parts.slice(0, 4).reduce((a, b) => (b.size.y / b.size.x < a.size.y / a.size.x ? b : a));
const rest = parts.slice(0, 4).filter((p) => p !== mouth);
const nose = rest.reduce((a, b) => (b.tris.length > a.tris.length ? b : a));
const eyes = rest.filter((p) => p !== nose).sort((a, b) => a.c.x - b.c.x); // [화면 왼쪽(캐릭터 오른쪽), 오른쪽]

// ── 2. 방향 바로잡기 ──
// (a) 눈 높이선이 x 축과 나란하게: y 축 회전(yaw) + 정면 축 회전(roll)
const eyeVec = eyes[1].c.clone().sub(eyes[0].c);
const yaw = Math.atan2(eyeVec.z, eyeVec.x);
const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
// (b) 고개 들기: 목도리 고리 평면 위(머리 쪽)를 고리 중심 기준 x 축으로 liftDeg 만큼 (평면에서 띠 폭만큼 부드럽게)
const mp = mufG.attributes.position;
const ringPts = [];
for (let i = 0; i < mp.count; i += 7) { const y = mp.getY(i); if (y > 1.75) ringPts.push(new THREE.Vector3(mp.getX(i), y, mp.getZ(i)).applyQuaternion(qYaw)); }
const rc = new THREE.Vector3(); ringPts.forEach((p) => rc.add(p)); rc.divideScalar(ringPts.length);
let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
for (const p of ringPts) { const x = p.x - rc.x, y = p.y - rc.y, z = p.z - rc.z; xx += x * x; xy += x * y; xz += x * z; yy += y * y; yz += y * z; zz += z * z; }
const tr = xx + yy + zz, M = [tr - xx, -xy, -xz, -xy, tr - yy, -yz, -xz, -yz, tr - zz];
let rn = new THREE.Vector3(0, 1, 0);
for (let it = 0; it < 80; it++) rn = new THREE.Vector3(M[0] * rn.x + M[1] * rn.y + M[2] * rn.z, M[3] * rn.x + M[4] * rn.y + M[5] * rn.z, M[6] * rn.x + M[7] * rn.y + M[8] * rn.z).normalize();
if (rn.y < 0) rn.negate();
const qLift = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -THREE.MathUtils.degToRad(liftDeg));
const qId = new THREE.Quaternion(), qTmp = new THREE.Quaternion();
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const BAND = [-0.04, 0.16]; // 고리 평면 기준 (FBX 단위, 머리 쪽 +)
const orient = (v) => {
  v.applyQuaternion(qYaw);
  const w = ss(BAND[0], BAND[1], v.clone().sub(rc).dot(rn));
  if (w > 0) {
    qTmp.slerpQuaternions(qId, qLift, w);
    v.sub(rc).applyQuaternion(qTmp).add(rc);
  }
  return v;
};

// ── 3. 기존 푸빌라 눈에 맞추기 (크기·위치) ──
const objText = readFileSync(resolve(root, "public/models/pu_stand.obj"), "utf8");
const oldV = [], oldParts = {};
let curName = null;
for (const line of objText.split(/\r?\n/)) {
  const p = line.trim().split(/\s+/);
  if (p[0] === "v") oldV.push([+p[1], +p[2], +p[3]]);
  else if (p[0] === "o" || p[0] === "g") curName = p[1];
  else if (p[0] === "f" && curName) (oldParts[curName] ??= new Set()).add(...p.slice(1).map((t) => +t.split("/")[0] - 1));
}
const oldEyeCenters = Object.entries(oldParts)
  .map(([, set]) => { const b = new THREE.Box3(); for (const i of set) b.expandByPoint(new THREE.Vector3(...oldV[i])); return b; })
  .filter((b) => { const s = b.getSize(new THREE.Vector3()); return s.x < 6 && s.y < 6 && b.getCenter(new THREE.Vector3()).y > 140; })
  .map((b) => b.getCenter(new THREE.Vector3()))
  .sort((a, b) => a.x - b.x);
if (oldEyeCenters.length !== 2) throw new Error(`기존 OBJ 눈 ${oldEyeCenters.length}개`);
const e0 = orient(eyes[0].c.clone()), e1 = orient(eyes[1].c.clone());
const scale = oldEyeCenters[1].distanceTo(oldEyeCenters[0]) / e1.distanceTo(e0);
const newMid = e0.clone().add(e1).multiplyScalar(0.5);
const oldMid = oldEyeCenters[0].clone().add(oldEyeCenters[1]).multiplyScalar(0.5);
const toCm = (v) => orient(v).sub(newMid).multiplyScalar(scale).add(oldMid);
console.log(`yaw ${THREE.MathUtils.radToDeg(yaw).toFixed(1)}° · 고개 ${liftDeg}° 들기 · 배율 ${scale.toFixed(2)} cm/단위`);

// ── 4. 몸 줄이기 ──
const simplify = async (g, target, keepUv) => {
  const uvOf = new Map();
  if (keepUv) {
    const pa = g.attributes.position, ua = g.attributes.uv;
    for (let i = 0; i < pa.count; i++) { const k = kf(pa.getX(i), pa.getY(i), pa.getZ(i)); if (!uvOf.has(k)) uvOf.set(k, [ua.getX(i), ua.getY(i)]); }
  }
  for (const k of Object.keys(g.attributes)) if (k !== "position") g.deleteAttribute(k);
  g = mergeVertices(g, 1e-5);
  const pos = g.attributes.position.array, idx = new Uint32Array(g.index.array);
  await MeshoptSimplifier.ready;
  const [out, err] = MeshoptSimplifier.simplify(idx, pos, 3, target * 3, 0.01, ["LockBorder"]);
  const remap = new Int32Array(pos.length / 3).fill(-1);
  const P = [], UV = [], I = new Uint32Array(out.length);
  for (let i = 0; i < out.length; i++) {
    let r = remap[out[i]];
    if (r < 0) {
      r = remap[out[i]] = P.length / 3;
      const v = toCm(new THREE.Vector3(pos[out[i] * 3], pos[out[i] * 3 + 1], pos[out[i] * 3 + 2]));
      if (keepUv) { const t = uvOf.get(kf(pos[out[i] * 3], pos[out[i] * 3 + 1], pos[out[i] * 3 + 2])) ?? [0, 0]; UV.push(t[0], t[1]); }
      P.push(v.x, v.y, v.z);
    }
    I[i] = r;
  }
  return { P, UV, I, err, from: idx.length / 3 };
};
const subGeo = (tris) => {
  const arr = new Float32Array(tris.length * 9);
  tris.forEach((t, j) => { for (let k = 0; k < 3; k++) { arr[j * 9 + k * 3] = bp.getX(t + k); arr[j * 9 + k * 3 + 1] = bp.getY(t + k); arr[j * 9 + k * 3 + 2] = bp.getZ(t + k); } });
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(arr, 3)); return g;
};
// 몸은 검은 패치(눈·코·입 자리)까지 포함해 구멍 없이 — 눈·코는 위에 따로 얹고, 입은 먹선으로 그림
const body = await simplify(subGeo([...white, ...black]), bodyTris, false);
console.log(`몸: 삼각형 ${body.from} → ${body.I.length / 3} (정점 ${body.P.length / 3}, 오차 ${body.err.toFixed(4)})`);

// 검은 부품은 거의 그대로 (작음) — 줄이되 모양 유지
const small = {};
for (const [name, part, tgt] of [["pu_eyes_R", eyes[0], 600], ["pu_eyes_L", eyes[1], 600], ["pu_nose", nose, 1500], ["pu_mouth", mouth, 800]])
  small[name] = await simplify(subGeo(part.tris), tgt, false);
for (const name of ["pu_eyes_R", "pu_eyes_L", "pu_nose"]) {
  // 몸 표면과 같은 자리라 겹쳐 깜빡이지 않게 바깥으로 살짝 (cm)
  const m = small[name];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(m.P), 3));
  g.setIndex(new THREE.BufferAttribute(m.I, 1));
  g.computeVertexNormals();
  const nn = g.attributes.normal;
  for (let i = 0; i < m.P.length / 3; i++) for (let k = 0; k < 3; k++) m.P[i * 3 + k] += nn.array[i * 3 + k] * 0.35;
}

// ── OBJ 쓰기 ──
let obj = `# pu_sit.obj — scripts/build-sit.mjs 로 ${src.split(/[\\/]/).pop()} 에서 생성 (cm, y-up, 정면 +z, 기존 pu_stand 눈 위치 기준)\n`;
let base = 1;
for (const [name, m] of [["pu_body", body], ...Object.entries(small)]) {
  obj += `o ${name}\n`;
  for (let i = 0; i < m.P.length; i += 3) obj += `v ${m.P[i].toFixed(3)} ${m.P[i + 1].toFixed(3)} ${m.P[i + 2].toFixed(3)}\n`;
  for (let i = 0; i < m.I.length; i += 3) obj += `f ${m.I[i] + base} ${m.I[i + 1] + base} ${m.I[i + 2] + base}\n`;
  base += m.P.length / 3;
}
writeFileSync(resolve(root, "public/models/pu_sit.obj"), obj);

// ── 목도리 ──
const muf = await simplify(mufG, mufTris, true);
const header = Buffer.from(JSON.stringify({ src: "A.fbx (pu_sit 좌표)", verts: muf.P.length / 3, tris: muf.I.length / 3, error: muf.err, uv: true }), "utf8");
const pad = (4 - ((4 + header.length) % 4)) % 4;
const hdr = Buffer.concat([header, Buffer.alloc(pad, 32)]);
const len = Buffer.alloc(4); len.writeUInt32LE(hdr.length);
writeFileSync(resolve(root, "public/models/muffler_sit.bin"), Buffer.concat([len, hdr, Buffer.from(new Float32Array(muf.P).buffer), Buffer.from(new Float32Array(muf.UV).buffer), Buffer.from(muf.I.buffer)]));
console.log(`목도리: 삼각형 ${muf.from} → ${muf.I.length / 3}`);
// 참고 수치
const bb = new THREE.Box3(); for (let i = 0; i < body.P.length; i += 3) bb.expandByPoint(new THREE.Vector3(body.P[i], body.P[i + 1], body.P[i + 2]));
const show = (n, m) => { const b = new THREE.Box3(); for (let i = 0; i < m.P.length; i += 3) b.expandByPoint(new THREE.Vector3(m.P[i], m.P[i + 1], m.P[i + 2])); console.log(n, b.min.toArray().map((v) => v.toFixed(1)).join(","), "~", b.max.toArray().map((v) => v.toFixed(1)).join(",")); };
show("body", body); for (const [n, m] of Object.entries(small)) show(n, m); show("muffler", muf);
const rcm = toCm(rc.clone().applyQuaternion(qYaw.clone().invert()));
console.log("고리 중심(cm)", rcm.toArray().map((v) => v.toFixed(1)).join(","));
