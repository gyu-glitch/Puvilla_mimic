"""원본 Seat_A 팔 껍질(바깥 절반) -> 닫힌 팔: 팔 축을 지나는 면에서 잘라 바깥 절반을 안쪽으로 거울 복제.
  - 팔 축: 수평 단면들에 원을 맞춘 중심들이 거의 직선 -> 직선 맞춤. 거울면 = 그 축과 앞뒤(z) 방향이 만드는 평면 (법선 = 바깥쪽)
  - 바깥쪽 절반(원본 면 그대로) + 그 거울상 -> 단면이 좌우대칭인 닫힌 팔. 원본 바깥 표면은 1mm 도 안 바뀜.
  - 원래 몸통에 붙어 있던 열린 테두리 중 바깥쪽에 남는 부분은 거울상과 띠로 이어 구멍을 막음 (쉴 땐 몸통 속)
  - 어깨 회전 중심 = 껍질 윗부분(어깨 돔)에 맞춘 구의 중심. 몸통은 고정(팔 가중치 0) -> 팔 들어도 몸통 안 딸려감
입력: public/models/parts_seat.glb (dev/armsplit.html ?arm=mesh&cap=0&exportParts=1), seat.bin (뼈대·눈코입·몸 가중치)
사용: python scripts/seat/arm_mirror.py [--out public/models/seat_t2.bin] [--elbowY 80] [--dump dev/tmp/arm_mirror_R.glb]
"""
import sys, os, argparse, numpy as np, trimesh
from scipy.spatial import cKDTree
sys.path.insert(0, os.path.dirname(__file__))
import seatbin

ap = argparse.ArgumentParser()
ap.add_argument("--parts", default="public/models/parts_seat.glb")
ap.add_argument("--seat", default="public/models/seat.bin")
ap.add_argument("--out", default="public/models/seat_t2.bin")
ap.add_argument("--elbowY", type=float, default=80.0)
ap.add_argument("--wblend", type=float, default=4.0)
ap.add_argument("--smooth", type=int, default=3, help="Taubin 단계 (이음매용, 0 = 안 함)")
ap.add_argument("--ballTop", type=float, default=14.0)
ap.add_argument("--dump", default="")
ap.add_argument("--cap", type=int, default=0, help="1 = 몸통 채움면을 뚜껑으로 (기본 0: 어깨 구와 거리장으로 합침)")
ap.add_argument("--cell", type=float, default=0.5, help="거리장 격자 cm")
ap.add_argument("--faces", type=int, default=4000)
a = ap.parse_args()

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

sc = trimesh.load(a.parts)
gl = list(sc.geometry.values())   # exportParts 순서: torso, armR, armL, fillR, fillL
torso, armR, armL = gl[0], gl[1], gl[2]
if armR.bounds[0][0] > 0: armR, armL = armL, armR
fillR = None
if len(gl) >= 5:
    fillR = gl[3] if gl[3].vertices[:, 0].mean() < 0 else gl[4]
shell = trimesh.Trimesh(armR.vertices.copy(), armR.faces.copy(), process=False)   # 축·회전 중심은 껍질만으로
hdr, body, parts = seatbin.read(a.seat)
bones = [dict(b) for b in hdr["bones"]]; bi = {b["name"]: i for i, b in enumerate(bones)}

# ── 팔 축 (수평 단면 원 중심 직선 맞춤) ──
def circle_fit(P2):
    A = np.c_[2 * P2, np.ones(len(P2))]; b = (P2 ** 2).sum(1)
    sol, *_ = np.linalg.lstsq(A, b, rcond=None); c = sol[:2]; return c, np.sqrt(max(sol[2] + c @ c, 1e-6))
def slice_polylines(mesh, origin, normal):
    seg = trimesh.intersections.mesh_plane(mesh, normal, origin)
    if len(seg) == 0: return []
    key, pts, adj = {}, [], {}
    def vid(p):
        k = tuple(np.round(p, 4))
        if k not in key: key[k] = len(pts); pts.append(p)
        return key[k]
    for s in seg:
        i, j = vid(s[0]), vid(s[1])
        if i != j: adj.setdefault(i, set()).add(j); adj.setdefault(j, set()).add(i)
    used, out = set(), []
    for s0 in [v for v in adj if len(adj[v]) == 1] + list(adj):
        if s0 in used: continue
        line, cur = [s0], s0; used.add(s0)
        while True:
            nxt = [v for v in adj[cur] if v not in used]
            if not nxt: break
            cur = nxt[0]; used.add(cur); line.append(cur)
        if len(line) >= 3: out.append(np.array([pts[v] for v in line]))
    return out
ymin, ymax = shell.bounds[0][1], shell.bounds[1][1]
cen = []
for y in np.arange(ymax - 8, ymin + 4, -2.0):
    pls = slice_polylines(shell, [0, y, 0], [0, 1, 0])
    if not pls: continue
    pl = max(pls, key=len); c2, r = circle_fit(pl[:, [0, 2]])
    if r < 25: cen.append([c2[0], y, c2[1]])
cen = np.array(cen)
# 직선: x,z 를 y 의 1차식으로
kx = np.polyfit(cen[:, 1], cen[:, 0], 1); kz = np.polyfit(cen[:, 1], cen[:, 2], 1)
yc = cen[:, 1].mean(); c0 = np.array([np.polyval(kx, yc), yc, np.polyval(kz, yc)])
t = np.array([kx[0], 1.0, kz[0]]); t /= np.linalg.norm(t); t = -t   # 아래쪽(손) 방향
u = np.array([-1.0, 0, 0]); u -= (u @ t) * t; u /= np.linalg.norm(u)  # 바깥쪽 (축에 수직)
w = np.cross(t, u)
print(f"팔 축: 점 {c0.round(1)} 방향 {t.round(3)} 바깥 {u.round(3)} (단면 {len(cen)}개, 중심 잔차 {np.abs(cen[:,0]-np.polyval(kx,cen[:,1])).mean():.2f}cm)")
# 어깨 돔 구 맞춤 -> 회전 중심
top = shell.vertices[shell.vertices[:, 1] > ymax - a.ballTop]
A3 = np.c_[2 * top, np.ones(len(top))]; sol, *_ = np.linalg.lstsq(A3, (top ** 2).sum(1), rcond=None)
ball_c = sol[:3]; ball_r = float(np.sqrt(max(sol[3] + ball_c @ ball_c, 1e-6)))
# 회전 중심은 축 위에 (돔 중심을 축에 투영)
pivot = c0 + ((ball_c - c0) @ t) * t
print(f"어깨 돔: 중심 {ball_c.round(1)} r {ball_r:.1f} -> 회전 중심(축 위) {pivot.round(1)}")

# ── 껍질 + 채움 뚜껑 = 닫힌 반쪽 팔 ──
# 채움면의 바깥 고리 정점은 몸통 쪽 이음매 다듬기로 조금 움직여 있어 껍질 테두리와 어긋남 → 가장 가까운 껍질 테두리 정점에 붙임
if fillR is not None and a.cap:
    e0 = np.sort(shell.faces[:, [[0, 1], [1, 2], [2, 0]]].reshape(-1, 2), axis=1); u0, c0n = np.unique(e0, axis=0, return_counts=True)
    bverts = np.unique(u0[c0n == 1]); BV = shell.vertices[bverts]
    FV = np.asarray(fillR.vertices, np.float64).copy(); FF = np.asarray(fillR.faces, np.int64)
    dd, jj = cKDTree(BV).query(FV)
    snap = dd < 2.5
    FV[snap] = BV[jj[snap]]
    Vs = np.vstack([shell.vertices, FV]); Fs = np.vstack([shell.faces, FF[:, ::-1] + len(shell.vertices)])
    closedShell = trimesh.Trimesh(Vs, Fs, process=True); closedShell.merge_vertices()
    print(f"껍질+채움 뚜껑: {len(closedShell.vertices)} 정점 {len(closedShell.faces)} 면 watertight {closedShell.is_watertight} (붙인 정점 {snap.sum()}/{len(FV)})")
else:
    closedShell = shell
# ── 자르기 + 거울 ──
def clip_plane(V0, F0, origin, normal):
    """평면 양(+normal)쪽만 남기고 가로지르는 삼각형은 잘라 붙임. 잘린 모서리의 새 정점은 모서리마다 하나(용접된 결과)"""
    d0 = (V0 - origin) @ normal
    V = [v for v in V0]; cache = {}; out = []
    def cut(i, j):
        k = (i, j) if i < j else (j, i)
        if k not in cache:
            tt = d0[i] / (d0[i] - d0[j]); cache[k] = len(V); V.append(V0[i] + (V0[j] - V0[i]) * tt)
        return cache[k]
    for tri in F0:
        keep = [d0[v] >= 0 for v in tri]
        n = sum(keep)
        if n == 3: out.append(list(tri)); continue
        if n == 0: continue
        # 회전시켜 keep 패턴을 [T,F,F] 또는 [T,T,F] 로
        r = next(i for i in range(3) if keep[i] and not keep[(i - 1) % 3])
        a_, b_, c_ = tri[r], tri[(r + 1) % 3], tri[(r + 2) % 3]
        if n == 1:   # a 만 남음
            out.append([a_, cut(a_, b_), cut(a_, c_)])
        else:        # a, b 남음 (c 버림)
            pb, pa = cut(b_, c_), cut(a_, c_)
            out.append([a_, b_, pb]); out.append([a_, pb, pa])
    V = np.array(V); F = np.array(out, np.int64)
    used = np.unique(F); remap = -np.ones(len(V), np.int64); remap[used] = np.arange(len(used))
    return V[used], remap[F]
V, F = clip_plane(np.asarray(closedShell.vertices, np.float64), np.asarray(closedShell.faces, np.int64), c0, u)
print(f"바깥 절반: {len(V)} 정점 {len(F)} 면")
d = (V - c0) @ u
Vm = V - 2 * d[:, None] * u[None]
N = len(V)
Vall = np.vstack([V, Vm]); Fall = np.vstack([F, F[:, ::-1] + N])
# 열린 테두리(몸통에 붙어 있던 자리) 중 거울면 밖(d>0) 부분: 원본 테두리와 거울상 테두리를 띠로 잇기
edges = np.sort(F.reshape(-1, 3)[:, [[0, 1], [1, 2], [2, 0]]].reshape(-1, 2), axis=1)
ue, cnt = np.unique(edges, axis=0, return_counts=True)
bnd = ue[cnt == 1]
bnd = bnd[(d[bnd[:, 0]] > 0.05) | (d[bnd[:, 1]] > 0.05)]
strip = []
for i, j in bnd:
    strip.append([i, j, j + N]); strip.append([i, j + N, i + N])
strip = np.array(strip, np.int64) if len(strip) else np.zeros((0, 3), np.int64)
print(f"테두리 띠: 모서리 {len(bnd)} -> 면 {len(strip)}")
arm = trimesh.Trimesh(Vall, np.vstack([Fall, strip]), process=True)   # 거울면 위 정점(d≈0) 용접
arm.merge_vertices(merge_tex=True, merge_norm=True)
trimesh.repair.fix_winding(arm)
if arm.volume < 0: arm.invert()
print(f"닫힌 팔: {len(arm.vertices)} 정점 {len(arm.faces)} 면 watertight {arm.is_watertight} 부피 {arm.volume:.0f}")
if a.smooth > 0:
    import pymeshlab
    ms = pymeshlab.MeshSet(); ms.add_mesh(pymeshlab.Mesh(np.asarray(arm.vertices), np.asarray(arm.faces)))
    try: ms.apply_coord_taubin_smoothing(stepsmoothnum=a.smooth)
    except AttributeError: ms.taubin_smooth(stepsmoothnum=a.smooth)
    arm = trimesh.Trimesh(ms.current_mesh().vertex_matrix(), ms.current_mesh().face_matrix(), process=False)
# ── 어깨 구와 합치기: 거울 팔의 거리장(부호 = 일반화 감김수) ∪ 구 → marching cubes ──
# 거울면 위 열린 테두리 띠가 만드는 위끝 V자 홈이 구 안에 묻힘. 바깥 표면은 격자 0.5cm 안에서 원본 그대로
trimesh.repair.fill_holes(arm)
surf, _ = trimesh.sample.sample_surface(arm, 150000)
stree = cKDTree(np.vstack([surf, arm.vertices]))
def winding(Q, mesh, chunk=4000):
    """일반화 감김수 (안 = 1, 밖 = 0) — 삼각형 입체각 합 (van Oosterom & Strackee)"""
    T = mesh.vertices[mesh.faces]  # (F,3,3)
    out = np.zeros(len(Q))
    for s0 in range(0, len(Q), chunk):
        q = Q[s0:s0 + chunk]
        A = T[None, :, 0, :] - q[:, None, :]; B = T[None, :, 1, :] - q[:, None, :]; C = T[None, :, 2, :] - q[:, None, :]
        la, lb, lc = np.linalg.norm(A, axis=2), np.linalg.norm(B, axis=2), np.linalg.norm(C, axis=2)
        num = np.einsum("ijk,ijk->ij", A, np.cross(B, C))
        den = la * lb * lc + np.einsum("ijk,ijk->ij", A, B) * lc + np.einsum("ijk,ijk->ij", A, C) * lb + np.einsum("ijk,ijk->ij", B, C) * la
        out[s0:s0 + chunk] = np.arctan2(num, den).sum(1) / (2 * np.pi)
    return out
lo = np.minimum(arm.bounds[0], ball_c - ball_r) - 3; hi = np.maximum(arm.bounds[1], ball_c + ball_r) + 3
cell = a.cell
nx, ny, nz = [int(np.ceil((hi[i] - lo[i]) / cell)) + 1 for i in range(3)]
G = np.stack(np.meshgrid(*[lo[i] + np.arange(n) * cell for i, n in enumerate((nx, ny, nz))], indexing="ij"), -1).reshape(-1, 3)
dist, _ = stree.query(G)
near = dist < 3.0 * cell + 1.0          # 표면 근처만 감김수 계산 (나머지는 구/거리로 충분)
wn = np.zeros(len(G)); wn[near] = winding(G[near], arm)
far_in = np.zeros(len(G), bool)
# 표면에서 먼 점의 안/밖: 가장 가까운 표면 점의 법선 방향으로 판정
if (~near).any():
    cp, cd, cf = trimesh.proximity.closest_point(arm, G[~near])
    far_in = np.zeros(len(G), bool); far_in[~near] = np.einsum("ij,ij->i", G[~near] - cp, arm.face_normals[cf]) < 0
inside = np.where(near, wn > 0.5, far_in)
d_arm = np.where(inside, -dist, dist)
# 회전 중심보다 위(축 반대쪽)는 어깨 구만 — 테두리 띠 조각이 구 밖으로 삐죽 나오는 것 제거
above = (G - pivot) @ t < -1.0
d_arm = np.where(above, np.inf, d_arm)
d_ball = np.linalg.norm(G - ball_c, axis=1) - ball_r
field = np.minimum(d_arm, d_ball).reshape(nx, ny, nz)
from skimage import measure
mv, mf, _, _ = measure.marching_cubes(field, level=0.0, spacing=(cell, cell, cell))
um = trimesh.Trimesh(mv + lo, mf, process=True)
um = max(um.split(only_watertight=False), key=lambda m: len(m.faces))
if um.volume < 0: um.invert()
import pymeshlab
ms = pymeshlab.MeshSet(); ms.add_mesh(pymeshlab.Mesh(np.asarray(um.vertices), np.asarray(um.faces)))
try: ms.apply_coord_taubin_smoothing(stepsmoothnum=4)
except AttributeError: ms.taubin_smooth(stepsmoothnum=4)
ms.meshing_decimation_quadric_edge_collapse(targetfacenum=a.faces, preservenormal=True, preservetopology=True, planarquadric=True, qualitythr=0.4)
ms.meshing_remove_unreferenced_vertices()
arm = trimesh.Trimesh(ms.current_mesh().vertex_matrix(), ms.current_mesh().face_matrix(), process=False)
if arm.volume < 0: arm.invert()
print(f"구와 합친 팔: 격자 {nx}x{ny}x{nz} · {len(arm.vertices)} 정점 {len(arm.faces)} 면 watertight {arm.is_watertight}")
AV = np.asarray(arm.vertices, np.float64); AF = np.asarray(arm.faces, np.int64)
if a.dump: arm.export(a.dump); print("dump", a.dump)

# ── 뼈대 ──
def set_bone(nm, p): bones[bi[nm]]["pos"] = [round(float(x), 4) for x in p]
sE = (a.elbowY - pivot[1]) / t[1]          # 축 위에서 y=elbowY 인 점의 s
elbow = pivot + t * sE
s_all = (AV - pivot) @ t; sTip = float(s_all.max())
for side, sg in (("R", 1), ("L", -1)):
    M = np.array([sg, 1, 1])
    set_bone(f"{side}_Shoulder", pivot * M); set_bone(f"{side}_Elbow", elbow * M)
    for nm, f in (("Forearm", 0.3), ("Wrist", 0.55), ("Hand", 0.8)):
        set_bone(f"{side}_{nm}", (pivot + t * (sE + (sTip - sE) * f)) * M)
    set_bone(f"{side}_Thumb", (pivot + t * (sE + (sTip - sE) * 0.8) + np.array([0, 0, 6.0])) * M)
print(f"어깨 {pivot.round(1)} 팔꿈치 {elbow.round(1)} 손끝 s {sTip:.1f}")

# ── 가중치 ──
NB = len(bones)
isArm = np.array([b["name"].startswith(("R_", "L_")) for b in bones])
T = body["pos"].astype(np.float64)
W_T = np.zeros((len(T), NB))
for k in range(4): np.add.at(W_T, (np.arange(len(T)), body["si"][:, k].astype(int)), body["sw"][:, k])
W_T[:, isArm] = 0; rs = W_T.sum(1); W_T[rs < 1e-6, bi["BodyHold"]] = 1; W_T /= W_T.sum(1, keepdims=True)
TV = np.asarray(torso.vertices, np.float64); TF = np.asarray(torso.faces, np.int64)
_, nn = cKDTree(T).query(TV); W_torso = W_T[nn]
def arm_weights(Vx, sg):
    s = ((Vx * np.array([sg, 1, 1])) - pivot) @ t
    fE = smoothstep(sE - a.wblend, sE + a.wblend, s)
    W = np.zeros((len(Vx), NB)); side = "R" if sg > 0 else "L"
    W[:, bi[f"{side}_Shoulder"]] = 1 - fE; W[:, bi[f"{side}_Elbow"]] = fE
    return W
def top4(W):
    top = np.argsort(-W, axis=1)[:, :4]; sw = np.take_along_axis(W, top, 1); sw /= np.maximum(sw.sum(1, keepdims=True), 1e-9)
    return top.astype(np.uint16), sw.astype(np.float32)
AVL = AV * np.array([-1, 1, 1]); AFL = AF[:, ::-1]
posL, idxL, WL = [TV, AV, AVL], [TF, AF, AFL], [W_torso, arm_weights(AV, 1), arm_weights(AVL, -1)]
pos = np.vstack(posL).astype(np.float32)
off = np.cumsum([0] + [len(p) for p in posL[:-1]])
idx = np.vstack([f + o for f, o in zip(idxL, off)]).astype(np.uint32)
si, sw = zip(*[top4(w) for w in WL]); si = np.vstack(si); sw = np.vstack(sw)
header = {"version": 2, "scale": hdr["scale"], "bones": bones, "armsFree": True, "restIsIdle": True, "src": "arm_mirror",
          "arm": {"pivot": [round(float(x), 2) for x in pivot], "axis": [round(float(x), 4) for x in t], "tip": round(sTip, 1)}}
n = seatbin.write(a.out, header, {"pos": pos, "idx": idx, "si": si, "sw": sw}, parts)
print(f"saved {a.out} {n/1024:.0f}KB · 몸통 {len(TV)} + 팔 {len(AV)}x2 정점 · 면 {len(idx)}")
