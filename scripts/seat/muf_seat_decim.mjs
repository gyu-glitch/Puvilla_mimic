import { readFileSync, writeFileSync } from "node:fs";
const { MeshoptSimplifier } = await import("file:///C:/SSG_Christmas/pubilla-mimic/node_modules/meshoptimizer/index.js");
await MeshoptSimplifier.ready;
const [S, out, target] = process.argv.slice(2);
// npz 대신 raw 로 (파이썬이 따로 씀)
const P = new Float32Array(readFileSync(S + "/ms_P.bin").buffer.slice(0)), UV = new Float32Array(readFileSync(S + "/ms_UV.bin").buffer.slice(0)), I = new Uint32Array(readFileSync(S + "/ms_I.bin").buffer.slice(0));
// 위치로 용접 (UV 이음매 무시하고 줄이기 → 정점마다 UV 하나)
const map = new Map(), remap = new Uint32Array(P.length / 3), WP = [], WU = [];
for (let i = 0; i < P.length / 3; i++) { const k = `${Math.round(P[i*3]*100)},${Math.round(P[i*3+1]*100)},${Math.round(P[i*3+2]*100)}`; let id = map.get(k); if (id === undefined) { id = map.size; map.set(k, id); WP.push(P[i*3], P[i*3+1], P[i*3+2]); WU.push(UV[i*2], UV[i*2+1]); } remap[i] = id; }
const Pf = new Float32Array(WP), Ix = new Uint32Array(I.length); for (let k = 0; k < I.length; k++) Ix[k] = remap[I[k]];
const [r] = MeshoptSimplifier.simplify(Ix, Pf, 3, Number(target) * 3, 0.02, []);
const used = new Map(), oP = [], oU = [];
for (const i of r) if (!used.has(i)) { used.set(i, used.size); oP.push(Pf[i*3], Pf[i*3+1], Pf[i*3+2]); oU.push(WU[i*2], WU[i*2+1]); }
const oI = Uint32Array.from(r, (i) => used.get(i));
// 앱 좌표 변환 (seat.bin 헤더: 배율 + BodyHold 위치)
const sb = readFileSync("C:/SSG_Christmas/pubilla-mimic/public/models/seat.bin"); const hl = sb.readUInt32LE(0); const H = JSON.parse(sb.subarray(4, 4 + hl).toString());
const sc = H.scale, bh = H.bones.find((b) => b.name === "BodyHold").pos, off = [bh[0] - 0 * sc, bh[1] - 100 * sc, bh[2] - 0 * sc];
for (let i = 0; i < oP.length; i += 3) for (let k = 0; k < 3; k++) oP[i + k] = oP[i + k] * sc + off[k];
let hdr = JSON.stringify({ verts: oP.length / 3, tris: oI.length / 3, uv: true }); while ((4 + hdr.length) % 4) hdr += " ";
const len = Buffer.alloc(4); len.writeUInt32LE(hdr.length);
writeFileSync(out, Buffer.concat([len, Buffer.from(hdr), Buffer.from(new Float32Array(oP).buffer), Buffer.from(new Float32Array(oU).buffer), Buffer.from(oI.buffer)]));
console.log("weld", P.length / 3, "->", map.size, "· tris", r.length / 3, "· scale", sc.toFixed(4), "off", off.map((x) => x.toFixed(1)).join(","));
