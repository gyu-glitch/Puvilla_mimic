"""V03 OBJ 목도리(A_Scarf, 고개 숙인 몸에 맞춤) → Seat_A 몸(고개 든 리깅본)에 옮기기.
1) Seat_A 원본 몸과 OBJ 몸을 몸통끼리 / 머리끼리 따로 강체 정합(ICP) → OBJ→Seat 변환 두 개
2) 목도리 정점: 고리 평면 기준 높이로 머리 변환 ↔ 몸통 변환을 부드럽게 섞음 (윗단은 머리 따라, 끝자락은 몸통 따라)
3) Seat 몸을 파고든 곳은 몸 표면 밖으로 (이웃 고르게)
4) 앱 좌표(seat.bin 과 같은 변환)로 → muffler_seat_full.npz (위치·UV·면)  — 줄이기는 node(meshopt)
"""
import numpy as np, sys, json
from scipy.spatial import cKDTree
S = sys.argv[1]
OBJ = r"C:/SSG_Christmas/asset/Puuvilla_V03/Puuvilla_A.obj"
V = np.load(S + "/v03_objV.npy").astype(np.float64)
VT = []; F = []; grp = None
with open(OBJ, "rb") as f:
    for line in f:
        c = line[:3]
        if c == b"vt ":
            VT.append(line.split()[1:3])
        elif line[:2] == b"g ":
            grp = b"Scarf" in line
        elif line[:2] == b"f " and grp:
            t = [x.split(b"/") for x in line.split()[1:]]
            ids = [(int(a[0]) - 1, int(a[1]) - 1 if len(a) > 1 and a[1] else -1) for a in t]
            for k in range(1, len(ids) - 1):
                F.append((ids[0], ids[k], ids[k + 1]))
VT = np.array(VT, dtype=np.float64)
print("scarf tris", len(F), "vt", len(VT))
# (v, vt) 쌍으로 정점
key = {}; P = []; UV = []; I = []
for tri in F:
    for (v, t) in tri:
        k = (v, t)
        i = key.get(k)
        if i is None:
            i = len(P); key[k] = i; P.append(V[v]); UV.append(VT[t] if t >= 0 else (0, 0))
        I.append(i)
P = np.array(P); UV = np.array(UV); I = np.array(I, dtype=np.uint32)
print("scarf verts", len(P))

seat = np.fromfile(S + "/seat_raw.bin", np.float32).reshape(-1, 3).astype(np.float64)
b = open(S + "/v03_body.bin", "rb").read(); nv, ni = np.frombuffer(b[:8], np.uint32)
objB = np.frombuffer(b[8:8 + nv * 12], np.float32).reshape(-1, 3).astype(np.float64)

def icp(A, B, it=50):
    """A(Seat) → B(OBJ) 강체: B ≈ A R^T + t"""
    tree = cKDTree(B); R = np.eye(3); t = B.mean(0) - A.mean(0)
    for _ in range(it):
        d, idx = tree.query(A @ R.T + t)
        keep = d < np.percentile(d, 80)
        Pp = A[keep]; Q = B[idx[keep]]; pc = Pp.mean(0); qc = Q.mean(0)
        U, Sv, Vt = np.linalg.svd((Pp - pc).T @ (Q - qc)); Rn = Vt.T @ U.T
        if np.linalg.det(Rn) < 0: Vt[-1] *= -1; Rn = Vt.T @ U.T
        R = Rn; t = qc - pc @ R.T
    d, _ = tree.query(A @ R.T + t)
    return R, t, np.median(d)
torsoSel = lambda Q: Q[(np.abs(Q[:, 0]) < 50) & (Q[:, 1] > 60) & (Q[:, 1] < 170)]
headSel = lambda Q: Q[(Q[:, 1] > 205)]
Rt, tt, et = icp(torsoSel(seat), torsoSel(objB))
Rh, th, eh = icp(headSel(seat), headSel(objB))
print("몸통 정합 잔차 %.2f · 머리 %.2f" % (et, eh))
# OBJ→Seat (역변환): x_seat = (x_obj - t) R
inv = lambda R, t: (lambda X: (X - t) @ R)
toSeatT, toSeatH = inv(Rt, tt), inv(Rh, th)
# 목도리 고리 평면 (OBJ 좌표): 위쪽 고리 = 목도리 정점 중 y 상위 40%
yq = np.quantile(P[:, 1], 0.6)
ring = P[P[:, 1] > yq]; rc = ring.mean(0)
_ev, _evec = np.linalg.eigh((ring - rc).T @ (ring - rc)); rn = _evec[:, 0]
if rn[1] < 0: rn = -rn
dist = (P - rc) @ rn
lo, hi = float(sys.argv[2]) if len(sys.argv) > 2 else -6.0, float(sys.argv[3]) if len(sys.argv) > 3 else 14.0
w = np.clip((dist - lo) / (hi - lo), 0, 1); w = w * w * (3 - 2 * w)
PT = toSeatT(P); PH = toSeatH(P)
Q = PT * (1 - w[:, None]) + PH * w[:, None]
print("머리 쪽 비율 평균 %.2f" % w.mean())
# 몸 밖으로: Seat 몸 정점 노멀이 없으니 가장 가까운 몸 정점들로 근사 노멀 (몸 중심축에서 바깥 방향 + 이웃 평균)
treeS = cKDTree(seat)
gap = 0.8
for it in range(int(sys.argv[4]) if len(sys.argv) > 4 else 0):
    d, idx = treeS.query(Q, k=8)
    nb = seat[idx]                       # (n, 8, 3)
    c = nb.mean(1)
    # 근사 노멀: 이웃 점들의 주성분 최소 축, 바깥 방향 = 목 축(x=0, z=중심)에서 멀어지는 쪽
    X = nb - c[:, None, :]
    cov = np.einsum("nki,nkj->nij", X, X)
    evals, evecs = np.linalg.eigh(cov); nrm = evecs[:, :, 0]
    out = c - np.array([0, c[:, 1].mean() * 0, 0]); out[:, 1] = 0
    out = c.copy(); out[:, 1] = 0; out[:, 0] -= 0; out[:, 2] -= seat[:, 2].mean()
    sgn = np.sign(np.einsum("ni,ni->n", nrm, out)); sgn[sgn == 0] = 1; nrm *= sgn[:, None]
    pen = gap - np.einsum("ni,ni->n", Q - c, nrm)
    push = np.where(pen > 0, pen, 0)
    if push.max() < 0.05: break
    Q += nrm * push[:, None]
    print("밀어냄", it, "최대 %.2f cm" % push.max(), "정점", int((push > 0).sum()))
np.savez(S + "/muffler_seat_full.npz", P=Q.astype(np.float32), UV=UV.astype(np.float32), I=I)
print("saved", Q.min(0).round(1), Q.max(0).round(1))
