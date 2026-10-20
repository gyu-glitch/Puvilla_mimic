"""생성한 A포즈 푸빌라(GLB, Hunyuan3D-2mv <- dev/armsplit.html ?ref=1 참고 렌더) -> 앱용 Seat 리그 파일(seat.bin 형식).
사용: python scripts/seat/gen_to_seat.py dev/tmp/tpose_r4.glb [--out public/models/seat_t.bin] [--head orig|gen] [--faces 60000]
  1) 생성 메쉬: Taubin 다듬기(생성 노이즈) -> 쿼드릭 간략화(--faces)
  2) seat.bin(원본 Seat_A, 앱 cm) 에 정합: 키 배율 -> 팔 뺀 몸통·머리·다리로 ICP(강체+배율)
  3) --head orig: 목도리 띠 한가운데(방위각마다 다름 — 뒤는 높고 앞은 낮음) 에서 잘라 원본 머리(눈·코·입·목도리 자리 그대로) + 생성 몸통·팔
     --head gen : 생성 메쉬 통째 (눈·코·입은 새 표면에 다시 얹음)
  4) 뼈대: 몸·목·머리는 원본, 팔 사슬은 생성 팔 축 위에 (어깨 = 참고 렌더의 회전 중심, 팔꿈치 = 팔 길이 45%)
  5) 가중치: 몸 = 원본 최근접 정점(팔 성분 제거), 팔 = 축 위치별 어깨/팔꿈치 (어깨·팔꿈치 ±6cm 섞음), 팔뿌리 둘레에서 몸과 부드럽게
"""
import sys, os, json, argparse, struct, numpy as np, trimesh
from scipy.spatial import cKDTree
sys.path.insert(0, os.path.dirname(__file__))
import seatbin

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("--seat", default="public/models/seat.bin")
ap.add_argument("--muffler", default="public/models/muffler_seat.bin")
ap.add_argument("--out", default="public/models/seat_t.bin")
ap.add_argument("--head", choices=["orig", "gen"], default="orig")
ap.add_argument("--faces", type=int, default=60000)
ap.add_argument("--smooth", type=int, default=10, help="Taubin 단계 (0 = 안 함)")
ap.add_argument("--pivot", default="-75,165,-4", help="참고 렌더 때 오른팔 회전 중심 (Seat_A FBX cm, armsplit ?sh=)")
ap.add_argument("--elbow", type=float, default=0.45, help="팔꿈치 위치 (어깨->손끝 비율)")
ap.add_argument("--overlap", type=float, default=4.0, help="머리/몸 겹침 (cm, 목도리 띠 안)")
ap.add_argument("--blend", type=float, default=6.0, help="어깨/팔꿈치 가중치 섞는 반폭 (cm)")
a = ap.parse_args()

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

# ── 1. 생성 메쉬 ──
m = trimesh.load(a.src, force="mesh")
V, F = np.asarray(m.vertices, np.float64), np.asarray(m.faces, np.int64)
print(f"gen: {len(V)} verts {len(F)} faces bbox {V.min(0).round(2)} {V.max(0).round(2)}")
import pymeshlab
ms = pymeshlab.MeshSet(); ms.add_mesh(pymeshlab.Mesh(V, F))
if a.smooth > 0:
    try: ms.apply_coord_taubin_smoothing(stepsmoothnum=a.smooth)
    except AttributeError: ms.taubin_smooth(stepsmoothnum=a.smooth)
if len(F) > a.faces:
    ms.meshing_decimation_quadric_edge_collapse(targetfacenum=a.faces, preservenormal=True, preservetopology=True, planarquadric=True, qualitythr=0.4)
ms.meshing_remove_unreferenced_vertices()
V, F = ms.current_mesh().vertex_matrix().astype(np.float64), ms.current_mesh().face_matrix().astype(np.int64)
print(f"cleaned: {len(V)} verts {len(F)} faces")
# 방향: glTF y-up, 앞 = +z (three 에서 본 대로). 확인: 머리 높이(위 35%) 단면에서 주둥이가 튀어나온 쪽이 앞 (발끝은 머리보다 더 앞이라 전체 최대 z 로는 못 잼)
ext = V.max(0) - V.min(0)
assert ext[1] > ext[2], "y 가 키 축이 아님"
hd = V[V[:, 1] > V[:, 1].min() + ext[1] * 0.65]; zc = np.median(hd[:, 2])
if (zc - hd[:, 2].min()) > (hd[:, 2].max() - zc):
    print("!! 주둥이가 -z 쪽 -> 앞뒤 뒤집음"); V[:, 0] *= -1; V[:, 2] *= -1

# ── 2. 정합 (seat.bin 몸, 앱 cm) ──
hdr, body, parts = seatbin.read(a.seat)
T = body["pos"].astype(np.float64)
Tu = np.unique(np.round(T, 3), axis=0)
s0 = (Tu[:, 1].max() - Tu[:, 1].min()) / ext[1]
Q = V * s0
Q[:, 1] += Tu[:, 1].min() - Q[:, 1].min(); Q[:, 0] -= np.median(Q[:, 0]); Q[:, 2] += np.median(Tu[:, 2]) - np.median(Q[:, 2])
XIN = 33.0   # 팔 뺀 영역 |x| < XIN (원본은 늘어뜨린 팔·무릎 위 손, 생성은 벌린 팔 모두 밖)
tgt = Tu[np.abs(Tu[:, 0]) < XIN]; tree = cKDTree(tgt)
src0 = Q[np.abs(Q[:, 0]) < XIN]
def umeyama(src, dst):
    ms_, md_ = src.mean(0), dst.mean(0); Sc, Dc = src - ms_, dst - md_
    H = Dc.T @ Sc / len(src); U, D, Vt = np.linalg.svd(H)
    S = np.eye(3); S[2, 2] = np.sign(np.linalg.det(U) * np.linalg.det(Vt))
    R = U @ S @ Vt; s = np.trace(np.diag(D) @ S) / ((Sc ** 2).sum() / len(src))
    return s, R, md_ - s * R @ ms_
sc, Rm, tv = 1.0, np.eye(3), np.zeros(3)
for it in range(40):
    X = (sc * (Rm @ src0.T)).T + tv
    d, idx = tree.query(X)
    keep = d < np.percentile(d, 80)
    s_, R_, t_ = umeyama(X[keep], tgt[idx[keep]])
    sc, Rm, tv = s_ * sc, R_ @ Rm, s_ * (R_ @ tv) + t_
X = (sc * (Rm @ src0.T)).T + tv; d, _ = tree.query(X)
print(f"ICP: 배율 {s0*sc:.4f} 회전 {np.degrees(np.arccos(np.clip((np.trace(Rm)-1)/2,-1,1))):.1f}deg 잔차 median {np.median(d):.2f} p90 {np.percentile(d,90):.2f} cm")
G = (sc * (Rm @ Q.T)).T + tv          # 생성 메쉬, 앱 cm
print(f"gen aligned bbox {G.min(0).round(1)} {G.max(0).round(1)}")

# ── 3. 머리 ──
bones = [dict(b) for b in hdr["bones"]]
bname = [b["name"] for b in bones]
bi = {n: i for i, n in enumerate(bname)}
# 목도리 띠: 목 축(x=0, z=neck center) 둘레 방위각마다 띠의 y 범위 -> 자르는 높이 = 띠 가운데
mb = open(a.muffler, "rb").read(); mn = struct.unpack_from("<I", mb, 0)[0]; mh = json.loads(mb[4:4 + mn])
M = np.frombuffer(mb, dtype=np.float32, count=mh["verts"] * 3, offset=(4 + mn + 3) & ~3).reshape(-1, 3)
neckV = T[(T[:, 1] > 118) & (T[:, 1] < 132)]; ncx, ncz = neckV[:, 0].mean(), neckV[:, 2].mean()
def azimuth(P): return np.arctan2(P[:, 0] - ncx, P[:, 2] - ncz)
maz = azimuth(M); mrad = np.hypot(M[:, 0] - ncx, M[:, 2] - ncz)
ring = (mrad < 42) & (M[:, 1] > 98)
NB = 36; cut = np.zeros(NB)
for k in range(NB):
    lo, hi = -np.pi + k * 2 * np.pi / NB, -np.pi + (k + 1) * 2 * np.pi / NB
    s = M[ring & (maz >= lo) & (maz < hi)]
    cut[k] = (s[:, 1].min() + s[:, 1].max()) / 2 if len(s) else np.nan
cut = np.where(np.isnan(cut), np.nanmean(cut), cut)
for _ in range(2): cut = (np.roll(cut, 1) + 2 * cut + np.roll(cut, -1)) / 4
def cut_at(P):
    az = azimuth(P); k = (az + np.pi) / (2 * np.pi) * NB
    k0 = np.floor(k).astype(int) % NB; f = k - np.floor(k)
    return cut[k0] * (1 - f) + cut[(k0 + 1) % NB] * f
print("목도리 띠 가운데 y (뒤->옆->앞->옆):", np.round(cut[::3], 1).tolist())

if a.head == "orig":
    Tf = body["idx"]
    cT = T[Tf].mean(1); keepT = cT[:, 1] > cut_at(cT) - a.overlap
    cG = G[F].mean(1); keepG = cG[:, 1] < cut_at(cG) + a.overlap
    # 원본 머리 조각 (정점 다시 번호)
    hf = Tf[keepT]; used = np.unique(hf); remap = -np.ones(len(T), np.int64); remap[used] = np.arange(len(used))
    head_pos, head_idx = T[used], remap[hf]
    head_si, head_sw = body["si"][used], body["sw"][used]
    gf = F[keepG]; usedG = np.unique(gf); remapG = -np.ones(len(G), np.int64); remapG[usedG] = np.arange(len(usedG))
    gen_pos, gen_idx = G[usedG], remapG[gf]
    print(f"머리(원본) {len(head_pos)} 정점 {len(head_idx)} 면 · 몸(생성) {len(gen_pos)} 정점 {len(gen_idx)} 면")
    new_parts = parts
else:
    gen_pos, gen_idx = G, F
    head_pos = np.zeros((0, 3)); head_idx = np.zeros((0, 3), np.int64); head_si = np.zeros((0, 4), np.uint16); head_sw = np.zeros((0, 4), np.float32)
    # 눈·코·입: 원본 표면 기준 법선 띄움을 새 표면에서 유지
    tmO = trimesh.Trimesh(T, body["idx"], process=False); tmG = trimesh.Trimesh(G, F, process=False)
    new_parts = {}
    for k, p in parts.items():
        c = p["pos"].mean(0, keepdims=True)
        c0, _, f0 = trimesh.proximity.closest_point(tmO, c); n0 = tmO.face_normals[f0[0]]
        c1, _, f1 = trimesh.proximity.closest_point(tmG, c); n1 = tmG.face_normals[f1[0]]
        lift = float((c[0] - c0[0]) @ n0)
        new_parts[k] = {"pos": p["pos"] - c[0] + c1[0] + n1 * lift, "idx": p["idx"]}
        print(f"  {k}: 옮김 {np.round(c1[0] + n1*lift - c[0], 1)} (띄움 {lift:.2f})")

# ── 4. 팔 뼈대 (생성 팔 축) ──
sc_fbx = hdr["scale"]
# FBX -> 앱: 원본 R_Shoulder 가 FBX (-58,182,-4) 에서 왔음 (dev/rigmirror ?sh=) -> 이동 성분
shR = np.array(bones[bi["R_Shoulder"]]["pos"]); t_fbx = shR - sc_fbx * np.array([-58, 182, -4])
pivR = sc_fbx * np.array([float(x) for x in a.pivot.split(",")]) + t_fbx
print(f"팔 회전 중심 R (앱 cm): {pivR.round(1)}")
chain = ["Shoulder", "Elbow", "Forearm", "Wrist", "Hand", "Thumb"]
frac = {"Elbow": a.elbow, "Forearm": 0.6, "Wrist": 0.74, "Hand": 0.88}
armInfo = {}
for side, sg in (("R", -1), ("L", 1)):
    piv = pivR * np.array([sg * -1, 1, 1]) if side == "L" else pivR
    arm = G[(G[:, 0] * sg > 44)]
    c = arm.mean(0); u, s_, vt = np.linalg.svd(arm - c, full_matrices=False); d = vt[0]
    if d[0] * sg < 0: d = -d
    # 축 선 = 생성 팔 PCA 선, 어깨 = 회전 중심을 그 선에 투영
    S = c + ((piv - c) @ d) * d
    t_all = (G - S) @ d
    L = float(np.percentile(t_all[(G[:, 0] * sg > 44)], 99.7))
    J = {"Shoulder": S}
    for nm, f in frac.items(): J[nm] = S + d * (L * f)
    J["Thumb"] = J["Hand"] + np.array([0, 0, 5.0]) + d * 3
    for nm in chain: bones[bi[f"{side}_{nm}"]]["pos"] = [round(float(x), 4) for x in J[nm]]
    armInfo[side] = {"S": S, "d": d, "L": L}
    print(f"팔 {side}: 축 {d.round(3)} 어깨 {S.round(1)} 길이 {L:.1f} 팔꿈치 {J['Elbow'].round(1)} 손 {J['Hand'].round(1)}")

# ── 5. 가중치 ──
NBONE = len(bones)
isArm = np.array([n.startswith("R_") or n.startswith("L_") for n in bname])
# 원본 가중치(팔 성분 제거) -> 생성 정점 최근접
W_T = np.zeros((len(T), NBONE));
for k in range(4): np.add.at(W_T, (np.arange(len(T)), body["si"][:, k].astype(int)), body["sw"][:, k])
W_T[:, isArm] = 0
rs = W_T.sum(1); W_T[rs < 1e-6, bi["BodyHold"]] = 1; W_T /= W_T.sum(1, keepdims=True)
treeT = cKDTree(T); _, nn = treeT.query(gen_pos)
W = W_T[nn].copy()
wArm = np.zeros((len(gen_pos), 2))
for j, (side, sg) in enumerate((("R", -1), ("L", 1))):
    S, d, L = armInfo[side]["S"], armInfo[side]["d"], armInfo[side]["L"]
    rel = gen_pos - S; t = rel @ d; r = np.linalg.norm(rel - np.outer(t, d), axis=1)
    mid = (t > 0.3 * L) & (t < 0.6 * L) & (gen_pos[:, 0] * sg > 44)
    rArm = float(np.median(r[mid]))
    w = smoothstep(-10, 4, t) * (1 - smoothstep(1.8 * rArm, 2.6 * rArm, r)) * (t > -12)
    fE = smoothstep(L * a.elbow - a.blend, L * a.elbow + a.blend, t)
    wArm[:, j] = w
    W[:, bi[f"{side}_Shoulder"]] = w * (1 - fE); W[:, bi[f"{side}_Elbow"]] = w * fE
    print(f"팔 {side}: 반지름 {rArm:.1f}cm · 팔 가중치>0.5 정점 {(w>0.5).sum()}")
wBody = np.clip(1 - wArm.sum(1), 0, 1)
W[:, ~isArm] *= wBody[:, None]
W /= np.maximum(W.sum(1, keepdims=True), 1e-9)
top = np.argsort(-W, axis=1)[:, :4]
gen_si = top.astype(np.uint16); gen_sw = np.take_along_axis(W, top, 1).astype(np.float32); gen_sw /= gen_sw.sum(1, keepdims=True)

# ── 6. 쓰기 ──
pos = np.vstack([gen_pos, head_pos]).astype(np.float32)
idx = np.vstack([gen_idx, head_idx + len(gen_pos)]).astype(np.uint32)
si = np.vstack([gen_si, head_si]).astype(np.uint16); sw = np.vstack([gen_sw, head_sw]).astype(np.float32)
header = {"version": 2, "scale": sc_fbx, "bones": bones, "armsFree": True, "head": a.head, "src": os.path.basename(a.src),
          "arm": {s: {"dir": [round(float(x), 4) for x in v["d"]], "len": round(v["L"], 2)} for s, v in armInfo.items()}}
n = seatbin.write(a.out, header, {"pos": pos, "idx": idx, "si": si, "sw": sw}, new_parts)
print(f"saved {a.out} {n/1024:.0f}KB · 정점 {len(pos)} 면 {len(idx)}")
