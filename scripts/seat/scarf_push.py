"""Seat 몸을 파고든 목도리를 밖으로 — 정점마다 따로 밀면 뜨개가 구겨지므로 밀어낼 양을 공간에서 흐려 덩어리째.
입력: muffler_seat_full.npz (Seat 원본 cm), seat_raw.bin (FBX 삼각형 묶음)
"""
import numpy as np, sys
from scipy.spatial import cKDTree
from scipy.ndimage import gaussian_filter
S = sys.argv[1]
GAP = float(sys.argv[2]) if len(sys.argv) > 2 else 2.0      # 원본 cm (앱 ×0.424)
SIG = float(sys.argv[3]) if len(sys.argv) > 3 else 6.0
d = np.load(S + "/muffler_seat_full.npz"); Q = d["P"].astype(np.float64)
tri = np.fromfile(S + "/seat_raw.bin", np.float32).reshape(-1, 3, 3).astype(np.float64)
cen = tri.mean(1)
nrm = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]); nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-12
# 바깥 방향 확인: 몸 중심에서 면 중심 쪽과 같은 방향이 다수면 그대로
body_c = cen.mean(0)
if np.mean(np.einsum("ni,ni->n", nrm, cen - body_c) > 0) < 0.5: nrm = -nrm
tree = cKDTree(cen)
def signed_dist(X):
    dd, idx = tree.query(X, k=6)
    best = np.full(len(X), np.inf); bn = np.zeros((len(X), 3)); sd = np.zeros(len(X))
    for j in range(idx.shape[1]):
        t = idx[:, j]
        # 삼각형 평면까지 거리 (중심 거리로 근사 대신 평면 거리 + 중심 거리 혼합)
        pl = np.einsum("ni,ni->n", X - cen[t], nrm[t])
        dist = np.linalg.norm(X - cen[t], axis=1)
        better = dist < best
        best[better] = dist[better]; sd[better] = pl[better]; bn[better] = nrm[t][better]
    return sd, bn
lo = Q.min(0) - 3 * SIG; CELL = SIG / 2
shape = np.ceil((Q.max(0) + 3 * SIG - lo) / CELL).astype(int) + 1
for it in range(6):
    sd, bn = signed_dist(Q)
    pen = np.clip(GAP - sd, 0, None)
    # 너무 깊은(반대쪽 면을 잡은) 것은 무시
    pen[sd < -25] = 0
    print(f"반복 {it}: 파고든 정점 {(pen > 0.05).sum()} · 최대 {pen.max():.2f}")
    if pen.max() < 0.1: break
    disp = bn * pen[:, None]
    gi = np.floor((Q - lo) / CELL).astype(int)
    acc = np.zeros(tuple(shape) + (3,)); wgt = np.zeros(tuple(shape)); mx = np.zeros(tuple(shape))
    np.add.at(acc, (gi[:, 0], gi[:, 1], gi[:, 2]), disp); np.add.at(wgt, (gi[:, 0], gi[:, 1], gi[:, 2]), 1.0)
    np.maximum.at(mx, (gi[:, 0], gi[:, 1], gi[:, 2]), pen)
    sacc = np.stack([gaussian_filter(acc[..., k], SIG / CELL) for k in range(3)], -1); sw = gaussian_filter(wgt, SIG / CELL) + 1e-9
    field = sacc / sw[..., None]
    # 흐리면 양이 줄어듦 → 칸 최대 침투를 흐린 값으로 크기 보정
    smx = gaussian_filter(mx, SIG / CELL / 1.5)
    f = field[gi[:, 0], gi[:, 1], gi[:, 2]]
    fl = np.linalg.norm(f, axis=1) + 1e-9
    mag = np.maximum(fl, smx[gi[:, 0], gi[:, 1], gi[:, 2]] * 0.9)
    Q += f / fl[:, None] * mag[:, None] * (fl[:, None] > 1e-4)
np.savez(S + "/muffler_seat_full.npz", P=Q.astype(np.float32), UV=d["UV"], I=d["I"])
Q.astype(np.float32).tofile(S + "/ms_P.bin")
print("saved")
