"""서 있는 푸빌라(pu_stand.obj 케이지) 오른팔 인사 자세 — 팔을 자르지 않고 ARAP(as-rigid-as-possible) 변형으로 미리 계산.
  - 몸통·머리·왼팔 고정, 오른팔 관 + 어깨 둘레(소켓 고리에서 표면 거리 FREE cm 안) 자유, 앞발(끝 PAW cm) = 손잡이
  - 앞발 손잡이를 기준 그림 자리(머리 옆, 손바닥 앞(+z), 엄지 머리 쪽(+x))로 옮김 — 소켓 중심 둘레 호를 따라 STEPS 단계로 (앞 단계 해에서 시작)
  - 각 단계 ARAP: 지역(정점마다 회전 맞춤, SVD) ↔ 전역(라플라시안 풀이, splu 1회 분해)
  - 출력: work/stand/pu_stand_wave.json — 움직인 정점(전역 OBJ 번호)과 열쇠 자세들(올림 r1..rN, 흔들기 wA/wB)
           work/stand/pu_stand_wave_<key>.obj — 확인용 (원본과 같은 구조, 정점 위치만 다름)
사용: python scripts/stand_wave_arap.py [--paw -39,146,4] [--free 12] [--steps 24]
"""
import sys, json, argparse, heapq, numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla

ap = argparse.ArgumentParser()
ap.add_argument("--obj", default="work/stand/pu_stand.obj")
ap.add_argument("--out", default="work/stand/pu_stand_wave")
ap.add_argument("--paw", default="-39,146,4", help="목표 앞발 중심 (앱 cm)")
ap.add_argument("--axis", default="-0.12,1,0.05", help="목표 앞발 방향 (팔 끝 쪽)")
ap.add_argument("--free", type=float, default=12.0, help="어깨 자유 영역: 소켓 고리에서 몸통 표면 거리 (cm)")
ap.add_argument("--pawlen", type=float, default=16.0, help="앞발 손잡이: 팔 끝에서 이 거리 안 (cm)")
ap.add_argument("--steps", type=int, default=24)
ap.add_argument("--iters", type=int, default=25)
ap.add_argument("--keys", type=int, default=4, help="올림 열쇠 자세 수")
ap.add_argument("--wiggle", type=float, default=0.22, help="흔들기 각 (rad, ±)")
a = ap.parse_args()

# ── OBJ ──
lines = open(a.obj, encoding="utf8").read().split("\n")
V = []; parts = {}; cur = None
for ln in lines:
    t = ln.split()
    if not t: continue
    if t[0] == "v": V.append([float(x) for x in t[1:4]])
    elif t[0] in ("o", "g"): cur = t[1]; parts.setdefault(cur, [])
    elif t[0] == "f" and cur: parts[cur].append([int(x.split("/")[0]) - 1 for x in t[1:]])
V = np.array(V, np.float64)
Q = np.array(parts["pu_body"])
bodyV = np.unique(Q)
print(f"body: {len(Q)} quads, {len(bodyV)} verts")

# 모서리 (쿼드 변 + 대각선 0.5)
E = {}
for q in Q:
    for k in range(4):
        i, j = q[k], q[(k + 1) % 4]; E[(min(i, j), max(i, j))] = 1.0
    for i, j in ((q[0], q[2]), (q[1], q[3])):
        E.setdefault((min(i, j), max(i, j)), 0.5)
EI = np.array(list(E.keys())); EW = np.array(list(E.values()))
nbr = {}
for (i, j), w in E.items():
    nbr.setdefault(i, []).append((j, w)); nbr.setdefault(j, []).append((i, w))

# ── 오른팔 관 · 소켓 고리 (stand_arm_split.py 와 같은 방식) ──
EF = {}
for fi, q in enumerate(Q):
    for k in range(4):
        e = tuple(sorted((q[k], q[(k + 1) % 4]))); EF.setdefault(e, []).append(fi)
def opposite(fi, e):
    q = Q[fi]; k = [i for i in range(4) if tuple(sorted((q[i], q[(i + 1) % 4]))) == e][0]
    return tuple(sorted((q[(k + 2) % 4], q[(k + 3) % 4])))
def edge_ring(e0):
    ring = [e0]; e = e0; prev = None
    for _ in range(400):
        fs = [f for f in EF[e] if f != prev]
        if not fs: break
        f = fs[0]; e2 = opposite(f, e)
        if e2 == e0: return ring, True
        ring.append(e2); prev = f; e = e2
    return ring, False
seen = set(); rungs = []
for e in EF:
    if e in seen or not (V[e[0], 0] < -25 and V[e[1], 0] < -25 and V[e[0], 1] < 125): continue
    ring, closed = edge_ring(e)
    for r in ring: seen.add(r)
    if closed and len(ring) == 16:
        P = V[[v for r in ring for v in r]]
        rr = np.sqrt(((P[:, [0, 2]] - P[:, [0, 2]].mean(0)) ** 2).sum(1)).mean()
        if P[:, 0].mean() < -27 and rr > 3: rungs.append((P[:, 1].mean(), ring))
rungs.sort(key=lambda r: r[0])
vt = {v for e in rungs[-1][1] for v in e}; vs = {v for e in rungs[-2][1] for v in e}
base = sorted(vt & vs)
base_edges = set()
for e in EF:
    if e[0] in vt & vs and e[1] in vt & vs: base_edges.add(e)
C = V[Q].mean(1)
start = int(np.argmax(-C[:, 0] - np.abs(C[:, 1] - 58) * 0.5))
seenF = {start}; st = [start]
while st:
    f = st.pop(); q = Q[f]
    for k in range(4):
        e = tuple(sorted((q[k], q[(k + 1) % 4])))
        if e in base_edges: continue
        for g in EF[e]:
            if g not in seenF: seenF.add(g); st.append(g)
armV = set(np.unique(Q[sorted(seenF)]).tolist()) - set(base)
socket = V[base].mean(0)
print(f"right arm: {len(armV)} verts, socket loop {len(base)} verts center {socket.round(1)}")

# 표면 거리 (다익스트라) — 소켓 고리에서
def dijkstra(sources, allowed):
    d = {s: 0.0 for s in sources}; h = [(0.0, s) for s in sources]
    while h:
        dd, u = heapq.heappop(h)
        if dd > d.get(u, 1e9): continue
        for v, w in nbr[u]:
            if w < 1 or v not in allowed: continue
            nd = dd + np.linalg.norm(V[u] - V[v])
            if nd < d.get(v, 1e9): d[v] = nd; heapq.heappush(h, (nd, v))
    return d
dArm = dijkstra(base, armV | set(base))
torsoAllowed = set(bodyV.tolist()) - armV
dTor = dijkstra(base, torsoAllowed)
smax = max(dArm[v] for v in armV)
paw = sorted(v for v in armV if dArm[v] > smax - a.pawlen)
shoulder = sorted(v for v in torsoAllowed if dTor.get(v, 1e9) < a.free)
free = sorted((armV - set(paw)) | set(shoulder))
print(f"arm length (surface) {smax:.1f} · paw handle {len(paw)} · shoulder free {len(shoulder)} · free total {len(free)}")

# ── 앞발 자세 ──
P0 = V[paw].mean(0)
fore = [v for v in armV if smax - a.pawlen - 12 < dArm[v] <= smax - a.pawlen]
a0 = P0 - V[fore].mean(0); a0 /= np.linalg.norm(a0)
n0 = np.array([1.0, 0, 0]); n0 -= (n0 @ a0) * a0; n0 /= np.linalg.norm(n0)      # 손바닥 = 몸 쪽(+x)
F0 = np.stack([a0, n0, np.cross(a0, n0)], 1)
a1 = np.array([float(x) for x in a.axis.split(",")]); a1 /= np.linalg.norm(a1)
n1 = np.array([0, 0, 1.0]); n1 -= (n1 @ a1) * a1; n1 /= np.linalg.norm(n1)       # 손바닥 = 앞(+z)
F1 = np.stack([a1, n1, np.cross(a1, n1)], 1)
Rpaw = F1 @ F0.T
P1 = np.array([float(x) for x in a.paw.split(",")])
print(f"paw rest center {P0.round(1)} axis {a0.round(2)} thumb {np.cross(a0, n0).round(2)} → target {P1} axis {a1.round(2)} thumb {np.cross(a1, n1).round(2)}")

def quat_from_R(R):
    w = np.sqrt(max(1e-12, 1 + R[0, 0] + R[1, 1] + R[2, 2])) / 2
    return np.array([w, (R[2, 1] - R[1, 2]) / (4 * w), (R[0, 2] - R[2, 0]) / (4 * w), (R[1, 0] - R[0, 1]) / (4 * w)])
def R_from_quat(q):
    w, x, y, z = q / np.linalg.norm(q)
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
def slerp(q0, q1, t):
    d = q0 @ q1
    if d < 0: q1 = -q1; d = -d
    if d > 0.9995: q = q0 + t * (q1 - q0); return q / np.linalg.norm(q)
    th = np.arccos(d); return (np.sin((1 - t) * th) * q0 + np.sin(t * th) * q1) / np.sin(th)
qI = np.array([1.0, 0, 0, 0]); qP = quat_from_R(Rpaw)
v0 = P0 - socket; v1 = P1 - socket
def paw_target(t):
    """소켓 중심 둘레 호: 방향은 구면 보간(바깥쪽으로 도는 짧은 길), 길이는 선형"""
    d0, d1 = v0 / np.linalg.norm(v0), v1 / np.linalg.norm(v1)
    om = np.arccos(np.clip(d0 @ d1, -1, 1))
    d = (np.sin((1 - t) * om) * d0 + np.sin(t * om) * d1) / np.sin(om)
    L = np.linalg.norm(v0) * (1 - t) + np.linalg.norm(v1) * t
    R = R_from_quat(slerp(qI, qP, t))
    return socket + d * L, R

# ── ARAP ──
allIdx = bodyV
pos = {int(v): i for i, v in enumerate(allIdx)}
nV = len(allIdx)
Prest = V[allIdx].copy()
freeL = np.array([pos[v] for v in free]); pawL = np.array([pos[v] for v in paw])
isFree = np.zeros(nV, bool); isFree[freeL] = True
fmap = -np.ones(nV, int); fmap[freeL] = np.arange(len(freeL))
ei = np.array([pos[i] for i in EI[:, 0]]); ej = np.array([pos[j] for j in EI[:, 1]])
# 라플라시안 (자유 정점 행만)
rows, cols, vals = [], [], []
diag = np.zeros(nV)
for (i, j, w) in zip(ei, ej, EW):
    diag[i] += w; diag[j] += w
    if isFree[i] and isFree[j]:
        rows += [fmap[i], fmap[j]]; cols += [fmap[j], fmap[i]]; vals += [-w, -w]
for i in freeL: rows.append(fmap[i]); cols.append(fmap[i]); vals.append(diag[i])
L = sp.csc_matrix((vals, (rows, cols)), shape=(len(freeL), len(freeL)))
solve = spla.splu(L)
print(f"ARAP: {len(freeL)} free unknowns")
erest = Prest[ei] - Prest[ej]

def arap(Pcur, pawPos, iters):
    P = Pcur.copy(); P[pawL] = pawPos
    for _ in range(iters):
        # 지역: 정점마다 회전
        ecur = P[ei] - P[ej]
        S = np.zeros((nV, 3, 3))
        outer = EW[:, None, None] * np.einsum("ni,nj->nij", erest, ecur)
        np.add.at(S, ei, outer); np.add.at(S, ej, outer)
        U, _, Vt = np.linalg.svd(S)
        R = np.einsum("nij,njk->nki", U, Vt)     # R = V U^T  (Vt^T U^T)
        R = np.transpose(np.einsum("nij,njk->nik", np.transpose(Vt, (0, 2, 1)), np.transpose(U, (0, 2, 1))), (0, 1, 2))
        det = np.linalg.det(R)
        if (det < 0).any():
            Vt2 = Vt.copy(); Vt2[det < 0, 2, :] *= -1
            R[det < 0] = np.einsum("nij,njk->nik", np.transpose(Vt2[det < 0], (0, 2, 1)), np.transpose(U[det < 0], (0, 2, 1)))
        # 전역
        b = np.zeros((len(freeL), 3))
        rhs_e = 0.5 * EW[:, None] * np.einsum("nij,nj->ni", R[ei] + R[ej], erest)
        fi_ = isFree[ei]; fj_ = isFree[ej]
        np.add.at(b, fmap[ei[fi_]], rhs_e[fi_]); np.add.at(b, fmap[ej[fj_]], -rhs_e[fj_])
        # 고정 이웃 → 오른쪽
        m = fi_ & ~fj_; np.add.at(b, fmap[ei[m]], EW[m, None] * P[ej[m]])
        m = fj_ & ~fi_; np.add.at(b, fmap[ej[m]], EW[m, None] * P[ei[m]])
        P[freeL] = np.stack([solve.solve(b[:, k]) for k in range(3)], 1)
    return P

Pcur = Prest.copy(); keys = {}
pawRest = Prest[pawL]
for s in range(1, a.steps + 1):
    t = s / a.steps
    c, R = paw_target(t)
    pawPos = (pawRest - P0) @ R.T + c
    Pcur = arap(Pcur, pawPos, a.iters)
    if s % (a.steps // a.keys) == 0: keys[f"r{s // (a.steps // a.keys)}"] = Pcur.copy()
    if s % 4 == 0:
        el = np.linalg.norm(Pcur[ei] - Pcur[ej], axis=1) / np.maximum(np.linalg.norm(erest, axis=1), 1e-6)
        print(f"  step {s:2d}/{a.steps} paw {c.round(1)} · edge stretch min {el.min():.2f} max {el.max():.2f}")
# 흔들기: 마지막 자세에서 앞발을 팔 가운데 둘레 z 축으로 ±
mid = [pos[v] for v in armV if abs(dArm[v] - smax * 0.5) < 3]
pivot = Pcur[mid].mean(0)
cF, RF = paw_target(1.0)
for name, ang in (("wA", +a.wiggle), ("wB", -a.wiggle)):
    Rz = np.array([[np.cos(ang), -np.sin(ang), 0], [np.sin(ang), np.cos(ang), 0], [0, 0, 1]])
    pawPos = ((pawRest - P0) @ RF.T + cF - pivot) @ Rz.T + pivot
    keys[name] = arap(keys[f"r{a.keys}"], pawPos, a.iters * 2)

moved = sorted(set(free) | set(paw))
out = {"keys": list(keys), "idx": [int(v) for v in moved], "rest": V[moved].round(4).ravel().tolist(),
       "poses": {k: P[[pos[v] for v in moved]].round(4).ravel().tolist() for k, P in keys.items()},
       "socket": socket.round(3).tolist(), "paw": paw_target(1.0)[0].round(3).tolist()}
json.dump(out, open(a.out + ".json", "w"))
for k, P in keys.items():
    Vk = V.copy(); Vk[allIdx] = P
    vi = 0; res = []
    for ln in lines:
        if ln.startswith("v "):
            res.append(f"v {Vk[vi, 0]:.4f} {Vk[vi, 1]:.4f} {Vk[vi, 2]:.4f}"); vi += 1
        else: res.append(ln)
    open(f"{a.out}_{k}.obj", "w", encoding="utf8").write("\n".join(res))
print("saved", a.out + ".json", "keys", list(keys), "moved verts", len(moved))
