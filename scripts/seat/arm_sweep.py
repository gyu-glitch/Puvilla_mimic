"""원본 Seat_A 팔 껍질(바깥 절반, dev/armsplit.html ?arm=mesh&cap=0&exportParts=1 -> public/models/parts_seat.glb)
-> 닫힌 팔 + 원본 몸통(구멍 메움) + 원본 머리·눈·코·입 -> 앱용 seat 파일 (seat.bin 형식, armsFree).

팔 만드는 법 (팔 단면 스윕):
  1. 중심선: 껍질을 수평으로 썰어 각 단면 호(弧)에 원을 맞춘 중심들 -> 다듬은 꺾은선 (뼈 사슬은 팔 안쪽에 치우쳐 있어 못 씀)
  2. 중심선에 수직인 면으로 다시 썰어, 중심 기준 각도별 반지름 ρ(θ): 껍질이 있는 각도는 실측, 없는 안쪽 각도는 맞춘 원 반지름 (경계 ±25° 는 섞음)
  3. 거리장 = 가장 가까운 스테이션 단면 기준 (ρ - ρ_k(θ)), 위끝은 어깨 공(껍질 윗부분에 맞춘 구) 과 부드럽게 합침, 아래끝은 마지막 단면 반지름 구로 마감
  4. Surface Nets -> Taubin -> 간략화. 왼팔은 거울.
  어깨 회전 중심 = 어깨 공 중심 (팔을 돌려도 공은 제자리 -> 몸통은 고정, 팔뿌리가 딸려 올라가지 않음)
사용: python scripts/seat/arm_sweep.py [--out public/models/seat_t2.bin] [--cell 0.6] [--faces 6000]
"""
import sys, os, json, argparse, numpy as np, trimesh
from scipy.spatial import cKDTree
sys.path.insert(0, os.path.dirname(__file__))
import seatbin

ap = argparse.ArgumentParser()
ap.add_argument("--parts", default="public/models/parts_seat.glb")
ap.add_argument("--seat", default="public/models/seat.bin")
ap.add_argument("--out", default="public/models/seat_t2.bin")
ap.add_argument("--cell", type=float, default=0.6)
ap.add_argument("--faces", type=int, default=6000)
ap.add_argument("--step", type=float, default=1.0, help="스테이션 간격 cm")
ap.add_argument("--na", type=int, default=64)
ap.add_argument("--blend", type=float, default=25.0, help="실측 호 끝에서 원으로 섞는 각도 (도)")
ap.add_argument("--elbowY", type=float, default=80.0, help="팔꿈치 높이 (앱 cm, 중심선 위)")
ap.add_argument("--ballTop", type=float, default=14.0, help="어깨 공 맞춤: 껍질 위에서 이 cm 안의 정점")
ap.add_argument("--wblend", type=float, default=4.0, help="어깨/팔꿈치 가중치 섞는 반폭 cm")
ap.add_argument("--dump", default="", help="디버그: 팔 메쉬를 이 glb 로도 저장")
a = ap.parse_args()

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

# ── 입력 ──
sc = trimesh.load(a.parts)
gl = list(sc.geometry.values())
torso, armR, armL = gl[0], gl[1], gl[2]
if armR.bounds[0][0] > 0: armR, armL = armL, armR
shell = trimesh.Trimesh(armR.vertices.copy(), armR.faces.copy(), process=False)
hdr, body, parts = seatbin.read(a.seat)
bones = [dict(b) for b in hdr["bones"]]; bi = {b["name"]: i for i, b in enumerate(bones)}
print(f"껍질: {len(shell.vertices)} 정점 {len(shell.faces)} 면 bbox {shell.bounds.round(1).tolist()}")

# ── 1. 중심선 (수평 단면 원 맞춤) ──
def circle_fit(P2):
    """Kåsa 원 맞춤: (a,b) 점들 -> 중심, 반지름"""
    A = np.c_[2 * P2, np.ones(len(P2))]; bvec = (P2 ** 2).sum(1)
    sol, *_ = np.linalg.lstsq(A, bvec, rcond=None)
    c = sol[:2]; r = np.sqrt(max(sol[2] + c @ c, 1e-6)); return c, r

def slice_polylines(mesh, origin, normal):
    """평면 단면 선분들을 이어 꺾은선 목록으로 (열린 것도 포함 — trimesh Path.discrete 는 닫힌 고리만 줌)"""
    seg = trimesh.intersections.mesh_plane(mesh, normal, origin)
    if len(seg) == 0: return []
    key = {}; pts = []
    def vid(p):
        k = tuple(np.round(p, 4))
        if k not in key: key[k] = len(pts); pts.append(p)
        return key[k]
    adj = {}
    for s in seg:
        i, j = vid(s[0]), vid(s[1])
        if i == j: continue
        adj.setdefault(i, set()).add(j); adj.setdefault(j, set()).add(i)
    used = set(); out = []
    starts = [v for v in adj if len(adj[v]) == 1] + list(adj)
    for s0 in starts:
        if s0 in used: continue
        line = [s0]; used.add(s0); cur = s0
        while True:
            nxt = [v for v in adj[cur] if v not in used]
            if not nxt: break
            cur = nxt[0]; used.add(cur); line.append(cur)
        if len(line) >= 2 and line[0] in adj[line[-1]]: line.append(line[0])   # 닫힌 고리
        if len(line) >= 3: out.append(np.array([pts[v] for v in line]))
    return out

ymin, ymax = shell.bounds[0][1], shell.bounds[1][1]
centers0 = []
for y in np.arange(ymax - 2, ymin + 2, -2.0):
    pls = slice_polylines(shell, [0, y, 0], [0, 1, 0])
    if not pls: continue
    pl = max(pls, key=len)
    c2, r = circle_fit(pl[:, [0, 2]])
    centers0.append([c2[0], y, c2[1], r, len(pl)])
centers0 = np.array(centers0)
print("수평 단면 원 중심 (x,y,z,r):"); print(np.round(centers0[::4, :4], 1))
# 다듬기 (x,z 를 y 에 대해 이동 평균)
C = centers0[:, :3].copy()
for _ in range(3):
    C[1:-1, [0, 2]] = (C[:-2, [0, 2]] + 2 * C[1:-1, [0, 2]] + C[2:, [0, 2]]) / 4
# 위끝: 어깨 공
topsel = shell.vertices[:, 1] > ymax - a.ballTop
Ptop = shell.vertices[topsel]
A3 = np.c_[2 * Ptop, np.ones(len(Ptop))]; b3 = (Ptop ** 2).sum(1)
sol, *_ = np.linalg.lstsq(A3, b3, rcond=None); ball_c = sol[:3]; ball_r = float(np.sqrt(max(sol[3] + ball_c @ ball_c, 1e-6)))
print(f"어깨 공: 중심 {ball_c.round(1)} 반지름 {ball_r:.1f} (정점 {topsel.sum()})")
# 중심선 = 어깨 공 중심 -> 수평 단면 중심들 -> 아래로 (호 길이 1cm 스테이션으로 재샘플)
poly = np.vstack([ball_c[None], C])
poly = poly[np.argsort(-poly[:, 1])]
seglen = np.linalg.norm(np.diff(poly, axis=0), axis=1); cum = np.r_[0, np.cumsum(seglen)]
S_total = cum[-1]
s_st = np.arange(0, S_total + 1e-6, a.step)
cl = np.stack([np.interp(s_st, cum, poly[:, k]) for k in range(3)], 1)
for _ in range(4):
    cl[1:-1] = (cl[:-2] + 2 * cl[1:-1] + cl[2:]) / 4
tang = np.gradient(cl, axis=0); tang /= np.linalg.norm(tang, axis=1, keepdims=True)
NS = len(cl)
print(f"중심선: 스테이션 {NS} (길이 {S_total:.1f}cm) 위 {cl[0].round(1)} 아래 {cl[-1].round(1)}")

# ── 2. 스테이션 단면 ρ(θ) ──
NA = a.na
th = np.linspace(0, 2 * np.pi, NA, endpoint=False)
frames = []   # (center, t, u, v)
prof = np.zeros((NS, NA)); meas = np.zeros((NS, NA), bool)
def ray_poly_hit(c2, d2, pl2):
    """2D: c2 에서 d2 방향 반직선과 꺾은선 pl2 의 가장 가까운 교점 거리 (없으면 nan)"""
    P0 = pl2[:-1]; P1 = pl2[1:]; e = P1 - P0
    denom = d2[0] * e[:, 1] - d2[1] * e[:, 0]
    ok = np.abs(denom) > 1e-9
    w = P0 - c2
    t = (w[:, 0] * e[:, 1] - w[:, 1] * e[:, 0]) / np.where(ok, denom, 1)
    u = (w[:, 0] * d2[1] - w[:, 1] * d2[0]) / np.where(ok, denom, 1)
    good = ok & (t > 0) & (u >= -1e-6) & (u <= 1 + 1e-6)
    return t[good].min() if good.any() else np.nan
for k in range(NS):
    c = cl[k]; t = tang[k]
    u = np.array([-1.0, 0, 0]); u -= (u @ t) * t; u /= np.linalg.norm(u); v = np.cross(t, u)
    frames.append((c, t, u, v))
    pls = slice_polylines(shell, c, t)
    if not pls:
        prof[k] = np.nan; continue
    # 단면 중심 근처(반지름 40 안) 조각만, 가장 긴 것
    pls2 = [np.c_[(pl - c) @ u, (pl - c) @ v] for pl in pls]
    pls2 = [p for p in pls2 if np.linalg.norm(p, axis=1).min() < 40] or pls2
    pl2 = max(pls2, key=len)
    c2, r = circle_fit(pl2)
    # 중심을 맞춘 원 중심으로 옮김 (중심선 보정)
    c = c + c2[0] * u + c2[1] * v; frames[k] = (c, t, u, v); pl2 = pl2 - c2
    rho = np.array([ray_poly_hit(np.zeros(2), np.array([np.cos(q), np.sin(q)]), pl2) for q in th])
    m = ~np.isnan(rho)
    meas[k] = m
    if m.all():
        prof[k] = rho
    else:
        # 없는 각도 = 원 반지름, 실측 호 끝 ±blend 도 섞음
        filled = np.where(m, rho, r)
        bl = np.radians(a.blend)
        # 각도별 '가장 가까운 실측 끝'까지 각거리
        idx_m = np.where(m)[0]
        out = filled.copy()
        for i in range(NA):
            if m[i]: continue
            dq = np.abs((th[i] - th[idx_m] + np.pi) % (2 * np.pi) - np.pi); j = idx_m[np.argmin(dq)]
            w = np.clip(dq.min() / bl, 0, 1)
            out[i] = rho[j] * (1 - w) + r * w
        prof[k] = out
# 비어 있는 스테이션(위끝 공 근처 등)은 이웃으로 채움
for k in range(NS):
    if np.isnan(prof[k]).any():
        src = next((j for j in list(range(k + 1, NS)) + list(range(k - 1, -1, -1)) if not np.isnan(prof[j]).any()), None)
        prof[k] = prof[src]
# 각도·축 방향 다듬기
for _ in range(2): prof = (np.roll(prof, 1, 1) + 2 * prof + np.roll(prof, -1, 1)) / 4
for _ in range(2): prof[1:-1] = (prof[:-2] + 2 * prof[1:-1] + prof[2:]) / 4
centers = np.array([f[0] for f in frames])
print("단면 반지름(평균, 위->아래):", np.round(prof.mean(1)[::5], 1).tolist())
print("실측 각도 비율(위->아래):", np.round(meas.mean(1)[::5], 2).tolist())

# ── 3. 거리장 + Surface Nets ──
tree = cKDTree(centers)
U = np.array([f[2] for f in frames]); Vv = np.array([f[3] for f in frames]); Tt = np.array([f[1] for f in frames])
def sdf(Q):
    d, k = tree.query(Q)
    rel = Q - centers[k]
    ax = (rel * Tt[k]).sum(1)
    pa = (rel * U[k]).sum(1); pb = (rel * Vv[k]).sum(1)
    ang = np.arctan2(pb, pa) % (2 * np.pi); rho = np.hypot(pa, pb)
    fi = ang / (2 * np.pi) * NA; i0 = np.floor(fi).astype(int) % NA; f = fi - np.floor(fi)
    rk = prof[k, i0] * (1 - f) + prof[k, (i0 + 1) % NA] * f
    ds = rho - rk
    # 끝 너머: 축 방향 거리와 합침 (상자식 마감)
    over_top = np.where(k == 0, -ax, -np.inf); over_bot = np.where(k == NS - 1, ax, -np.inf)   # 끝 스테이션에서만 마감 (다른 데선 영향 없게 -inf)
    ds = np.maximum(ds, np.maximum(over_top, over_bot))
    # 어깨 공
    db = np.linalg.norm(Q - ball_c, axis=1) - ball_r
    # 아래끝 구
    de = np.linalg.norm(Q - centers[-1], axis=1) - prof[-1].mean()
    def smin(x, y, kk):
        h = np.clip(0.5 + 0.5 * (y - x) / kk, 0, 1); return y + (x - y) * h - kk * h * (1 - h)
    return smin(smin(ds, db, 4.0), de, 2.0)

lo = np.minimum(shell.bounds[0], ball_c - ball_r) - 4; hi = np.maximum(shell.bounds[1], ball_c + ball_r) + 4
cell = a.cell
nx, ny, nz = [int(np.ceil((hi[i] - lo[i]) / cell)) + 1 for i in range(3)]
gx, gy, gz = [lo[i] + np.arange(n) * cell for i, n in enumerate((nx, ny, nz))]
G = np.stack(np.meshgrid(gx, gy, gz, indexing="ij"), -1).reshape(-1, 3)
field = sdf(G).reshape(nx, ny, nz)
print(f"격자 {nx}x{ny}x{nz} · 안쪽 셀 {(field < 0).sum()}")
from skimage import measure
verts, faces, _, _ = measure.marching_cubes(field, level=0.0, spacing=(cell, cell, cell))
verts = verts + lo
armMesh = trimesh.Trimesh(verts, faces[:, ::-1], process=True)  # skimage 감김은 안쪽 -> 뒤집음
print(f"팔 메쉬: {len(armMesh.vertices)} 정점 {len(armMesh.faces)} 면 watertight {armMesh.is_watertight}")
# 가장 큰 덩어리만
comps = armMesh.split(only_watertight=False)
armMesh = max(comps, key=lambda m: len(m.faces))
import pymeshlab
ms = pymeshlab.MeshSet(); ms.add_mesh(pymeshlab.Mesh(np.asarray(armMesh.vertices), np.asarray(armMesh.faces)))
try: ms.apply_coord_taubin_smoothing(stepsmoothnum=6)
except AttributeError: ms.taubin_smooth(stepsmoothnum=6)
ms.meshing_decimation_quadric_edge_collapse(targetfacenum=a.faces, preservenormal=True, preservetopology=True, planarquadric=True, qualitythr=0.4)
ms.meshing_remove_unreferenced_vertices()
AV = ms.current_mesh().vertex_matrix().astype(np.float64); AF = ms.current_mesh().face_matrix().astype(np.int64)
# 법선이 바깥인지 (부피 양수)
if trimesh.Trimesh(AV, AF, process=False).volume < 0: AF = AF[:, ::-1]
print(f"팔 최종: {len(AV)} 정점 {len(AF)} 면")
if a.dump:
    trimesh.Trimesh(AV, AF, process=False).export(a.dump); print("dump", a.dump)

# ── 4. 뼈대 · 가중치 ──
# 팔꿈치 = 중심선에서 y 가 elbowY 인 스테이션
kE = int(np.argmin(np.abs(centers[:, 1] - a.elbowY)))
sE = s_st[kE] if kE < len(s_st) else s_st[-1]
def set_bone(nm, p): bones[bi[nm]]["pos"] = [round(float(x), 4) for x in p]
for side, sg in (("R", 1), ("L", -1)):
    M = np.array([sg, 1, 1])
    set_bone(f"{side}_Shoulder", ball_c * M)
    set_bone(f"{side}_Elbow", centers[kE] * M)
    kF, kW, kH = [min(NS - 1, int(kE + (NS - 1 - kE) * f)) for f in (0.3, 0.55, 0.8)]
    set_bone(f"{side}_Forearm", centers[kF] * M); set_bone(f"{side}_Wrist", centers[kW] * M); set_bone(f"{side}_Hand", centers[kH] * M)
    set_bone(f"{side}_Thumb", (centers[kH] + np.array([0, 0, 6.0])) * M)
print(f"어깨 {ball_c.round(1)} 팔꿈치 {centers[kE].round(1)} (스테이션 {kE}/{NS})")
NB = len(bones)
isArm = np.array([n.startswith("R_") or n.startswith("L_") for n in [b["name"] for b in bones]])
# 몸통(구멍 메운 원본): 원본 seat.bin 가중치(팔 성분 제거)를 최근접으로
T = body["pos"].astype(np.float64)
W_T = np.zeros((len(T), NB))
for k in range(4): np.add.at(W_T, (np.arange(len(T)), body["si"][:, k].astype(int)), body["sw"][:, k])
W_T[:, isArm] = 0; rs = W_T.sum(1); W_T[rs < 1e-6, bi["BodyHold"]] = 1; W_T /= W_T.sum(1, keepdims=True)
TV = np.asarray(torso.vertices, np.float64); TF = np.asarray(torso.faces, np.int64)
_, nn = cKDTree(T).query(TV); W_torso = W_T[nn]
# 팔: 스테이션 s 로 어깨/팔꿈치
def arm_weights(V, sg):
    Vm = V * np.array([sg, 1, 1])
    _, k = tree.query(Vm); s = s_st[np.minimum(k, len(s_st) - 1)]
    fE = smoothstep(sE - a.wblend, sE + a.wblend, s)
    W = np.zeros((len(V), NB)); W[:, bi[f"{'R' if sg > 0 else 'L'}_Shoulder"]] = 1 - fE; W[:, bi[f"{'R' if sg > 0 else 'L'}_Elbow"]] = fE
    return W
def top4(W):
    top = np.argsort(-W, axis=1)[:, :4]; sw = np.take_along_axis(W, top, 1); sw /= np.maximum(sw.sum(1, keepdims=True), 1e-9)
    return top.astype(np.uint16), sw.astype(np.float32)
AVL = AV * np.array([-1, 1, 1]); AFL = AF[:, ::-1]
posL = [TV, AV, AVL]; idxL = [TF, AF, AFL]; WL = [W_torso, arm_weights(AV, 1), arm_weights(AVL, -1)]
pos = np.vstack(posL).astype(np.float32)
off = np.cumsum([0] + [len(p) for p in posL[:-1]])
idx = np.vstack([f + o for f, o in zip(idxL, off)]).astype(np.uint32)
si, sw = zip(*[top4(w) for w in WL]); si = np.vstack(si); sw = np.vstack(sw)
header = {"version": 2, "scale": hdr["scale"], "bones": bones, "armsFree": True, "restIsIdle": True, "src": "arm_sweep",
          "arm": {"ball": [round(float(x), 2) for x in ball_c], "ballR": round(ball_r, 2), "len": round(float(S_total), 1)}}
n = seatbin.write(a.out, header, {"pos": pos, "idx": idx, "si": si, "sw": sw}, parts)
print(f"saved {a.out} {n/1024:.0f}KB · 몸통 {len(TV)} + 팔 {len(AV)}x2 정점 · 면 {len(idx)}")
