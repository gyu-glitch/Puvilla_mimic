// `node scripts/build-muffler.mjs` — 새 푸빌라 FBX(asset/Puuvilla_V02/A.fbx)의 뜨개 목도리를 꺼내 줄여서 public/models/muffler.bin 으로.
// 원본은 190만 삼각형(뜨개 코가 전부 지오메트리)이라 그대로는 폰에서 못 씀 → 용접 + meshoptimizer 로 약 12만 삼각형.
// 좌표는 FBX 그대로(곰 키 ≈3) — 기존 푸빌라 목에 맞추는 건 런타임(character/outfit.ts)에서.
// 포맷: [u32 헤더 길이][JSON 헤더][f32 positions][f32 uv][u32 index]. 텍스처(muffler_color/normal.jpg)는 FBX 에 내장된 것을 꺼내 2048 로 줄여 둠
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
const targetTris = Number(process.argv[3] || 120000);
const buf = readFileSync(src);
const fbx = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
fbx.updateMatrixWorld(true);
let scarf = null;
fbx.traverse((o) => { if (o.isMesh && /scarf/i.test(o.name)) scarf = o; });
if (!scarf) throw new Error("목도리 메쉬(이름에 Scarf) 없음");
let g = scarf.geometry.clone().applyMatrix4(scarf.matrixWorld);
// 위치 → UV (UV 이음매가 많은 아틀라스라 UV 째로 줄이면 거의 안 줄어듦 → 위치로만 줄이고 정점마다 UV 하나를 붙여 둠.
// 런타임에 그 UV 로 텍스처 색을 정점 색으로 구워 씀)
const key = (x, y, z) => `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
const uvOf = new Map();
{
  const pa = g.attributes.position, ua = g.attributes.uv;
  for (let i = 0; i < pa.count; i++) {
    const k = key(pa.getX(i), pa.getY(i), pa.getZ(i));
    if (!uvOf.has(k)) uvOf.set(k, [ua.getX(i), ua.getY(i)]);
  }
}
for (const k of Object.keys(g.attributes)) if (k !== "position") g.deleteAttribute(k);
g = mergeVertices(g, 1e-5);
const pos = g.attributes.position.array;
const idx = new Uint32Array(g.index.array);
console.log(`원본: 정점 ${pos.length / 3} · 삼각형 ${idx.length / 3}`);
await MeshoptSimplifier.ready;
const [out, err] = MeshoptSimplifier.simplify(idx, pos, 3, targetTris * 3, 0.01, ["LockBorder"]);
// 쓰는 정점만 남김
const remap = new Int32Array(pos.length / 3).fill(-1);
const P = [];
const UV = [];
const I = new Uint32Array(out.length);
for (let i = 0; i < out.length; i++) {
  let r = remap[out[i]];
  if (r < 0) {
    r = remap[out[i]] = P.length / 3;
    P.push(pos[out[i] * 3], pos[out[i] * 3 + 1], pos[out[i] * 3 + 2]);
    const t = uvOf.get(key(pos[out[i] * 3], pos[out[i] * 3 + 1], pos[out[i] * 3 + 2])) ?? [0, 0];
    UV.push(t[0], t[1]);
  }
  I[i] = r;
}
const header = Buffer.from(JSON.stringify({ src: src.split(/[\/]/).pop(), verts: P.length / 3, tris: I.length / 3, error: err, uv: true }), "utf8");
const pad = (4 - ((4 + header.length) % 4)) % 4;
const hdr = Buffer.concat([header, Buffer.alloc(pad, 32)]);
const len = Buffer.alloc(4);
len.writeUInt32LE(hdr.length);
const file = resolve(root, "public/models/muffler.bin");
writeFileSync(file, Buffer.concat([len, hdr, Buffer.from(new Float32Array(P).buffer), Buffer.from(new Float32Array(UV).buffer), Buffer.from(I.buffer)]));
console.log(`줄임: 정점 ${P.length / 3} · 삼각형 ${I.length / 3} · 오차 ${err.toFixed(4)} → ${file}`);
