"""서 있는 푸빌라 케이지(pu_stand.obj)에서 팔을 몸통과 분리 — 케이지(쿼드) 수준, 형상은 원본 그대로.
구조: 팔은 어깨 위 16각 고리(base ring)에서 몸통 옆을 따라 아래로 뽑아낸 관(extrusion). 관의 안쪽 절반은 몸통 속에 겹쳐 있음.
  1) 앞발에서 홍수 채움으로 관 면을 모음 (base ring 모서리는 못 건넘) = 팔
  2) 몸통 = 나머지 + base ring 구멍 메움(동심 고리 2단, 바깥으로 살짝 볼록 = 어깨)
  3) 팔 = 관 + base ring 을 안쪽으로 눌러 닫은 돔(쉴 땐 몸통 속)
  4) 왼팔 = 오른팔 거울 (케이지가 좌우 대칭)
출력: work/stand/pu_stand_arm.obj (pu_body, pu_arm_R, pu_arm_L + 눈·코·스카프 원본 그대로) + pu_stand_arm.json (회전 중심·팔꿈치 등, 앱 cm)
사용: python scripts/stand_arm_split.py [--obj work/stand/pu_stand.obj] [--out work/stand/pu_stand_arm.obj]
"""
import sys, json, argparse, numpy as np
ap = argparse.ArgumentParser()
ap.add_argument("--obj", default="work/stand/pu_stand.obj")
ap.add_argument("--out", default="work/stand/pu_stand_arm.obj")
ap.add_argument("--capIn", type=float, default=2.0, help="팔 뚜껑 돔 깊이 (안쪽, cm)")
ap.add_argument("--fillOut", type=float, default=1.5, help="몸통 어깨 채움 볼록 높이 (바깥, cm)")
ap.add_argument("--pivotIn", type=float, default=7.0, help="회전 중심: base ring 중심에서 안쪽으로 (cm)")
a = ap.parse_args()

V = []; parts = {}; order = []; cur = None; raw = []
for line in open(a.obj, encoding="utf8"):
    t = line.split()
    if not t: continue
    if t[0] == "v": V.append([float(x) for x in t[1:4]])
    elif t[0] in ("o", "g"):
        cur = t[1]
        if cur not in parts: parts[cur] = []; order.append(cur)
    elif t[0] == "f" and cur: parts[cur].append([int(x.split("/")[0]) - 1 for x in t[1:]])
V = np.array(V)
body = parts["pu_body"]
# 같은 자리 정점 합치기 (케이지는 보통 이미 합쳐져 있지만 안전하게)
key = {}; remap = {}
for i, p in enumerate(V):
    k = tuple(np.round(p, 3)); remap[i] = key.setdefault(k, i)
Q = np.array([[remap[i] for i in q] for q in body])
EF = {}
for fi, q in enumerate(Q):
    for k in range(4):
        e = tuple(sorted((q[k], q[(k + 1) % 4]))); EF.setdefault(e, []).append(fi)
def opposite(fi, e):
    q = Q[fi]; k = [i for i in range(4) if tuple(sorted((q[i], q[(i + 1) % 4]))) == e][0]
    return tuple(sorted((q[(k + 2) % 4], q[(k + 3) % 4])))
def edge_ring(e0):
    ring = [e0]; e = e0; prev_f = None
    for _ in range(400):
        fs = [f for f in EF[e] if f != prev_f]
        if not fs: break
        f = fs[0]; e2 = opposite(f, e)
        if e2 == e0: return ring, True
        ring.append(e2); prev_f = f; e = e2
    return ring, False

def arm_rings(sign):
    """sign=-1: 오른팔(x<0). 관의 16각 둘레 고리들을 y 순으로"""
    seen = set(); rings = []
    for e in EF:
        if e in seen: continue
        if not (V[e[0], 0] * sign > 25 and V[e[1], 0] * sign > 25 and V[e[0], 1] < 125): continue
        ring, closed = edge_ring(e)
        for r in ring: seen.add(r)
        if closed and len(ring) == 16:
            P = V[[v for r in ring for v in r]]
            rr = np.sqrt(((P[:, [0, 2]] - P[:, [0, 2]].mean(0)) ** 2).sum(1)).mean()
            if P[:, 0].mean() * sign > 27 and rr > 3.0: rings.append((P[:, 1].mean(), ring))   # 반지름 작은 극점 고리 제외
    rings.sort(key=lambda r: r[0])
    return rings

def split_side(sign):
    # 찾은 '고리'는 사실 관의 세로 모서리 묶음(rung ring): 이웃한 두 둘레 고리를 잇는 16개 세로 모서리.
    # 맨 위 묶음의 쿼드는 어깨 면(몸통). 팔의 맨 위 둘레 고리(base loop) = 맨 위 묶음과 그 아래 묶음이 공유하는 정점들
    rungs = arm_rings(sign)
    top = rungs[-1][1]; second = rungs[-2][1]
    vt = {v for e in top for v in e}; vs = {v for e in second for v in e}
    base_verts = vt & vs
    # 둘레 순서: base 정점끼리 잇는 모서리 따라 걷기
    nb = {v: [] for v in base_verts}
    for e in EF:
        if e[0] in base_verts and e[1] in base_verts: nb[e[0]].append(e[1]); nb[e[1]].append(e[0])
    loop = [next(iter(base_verts))]; prev = None
    while True:
        nx = [v for v in nb[loop[-1]] if v != prev]
        if not nx or nx[0] == loop[0]: break
        prev = loop[-1]; loop.append(nx[0])
    base_edges = {tuple(sorted((loop[i], loop[(i + 1) % len(loop)]))) for i in range(len(loop))}
    C = V[Q].mean(1)
    start = int(np.argmax(C[:, 0] * sign - np.abs(C[:, 1] - 58) * 0.5))
    seen = {start}; st = [start]
    while st:
        f = st.pop(); q = Q[f]
        for k in range(4):
            e = tuple(sorted((q[k], q[(k + 1) % 4])))
            if e in base_edges: continue
            for g in EF[e]:
                if g not in seen: seen.add(g); st.append(g)
    arm_faces = sorted(seen)
    P = V[loop]; c = P.mean(0)
    u, s_, vt_ = np.linalg.svd(P - c); n = vt_[2]
    if n @ np.array([sign * 1.0, 0.3, 0]) < 0: n = -n
    print(f"side {'R' if sign < 0 else 'L'}: rungs {len(rungs)} · base loop {len(loop)} verts · arm faces {len(arm_faces)} · base center {c.round(1)} normal {n.round(2)} r {np.linalg.norm(P - c, axis=1).mean():.1f}")
    # 팔 둘레 고리 중심들(아래→위): 각 묶음 쌍의 공유 정점 평균
    rings = []
    for k in range(len(rungs) - 1):
        a_ = {v for e in rungs[k][1] for v in e}; b_ = {v for e in rungs[k + 1][1] for v in e}
        shared = list(a_ & b_)
        if len(shared) >= 8: rings.append((V[shared][:, 1].mean(), shared))
    rings.sort(key=lambda r: r[0])
    return arm_faces, loop, c, n, rings

def fill_ring(loop, c, n, offset, newV, newF, reverse=False):
    """고리 안을 동심 고리 1단 + 중앙 부채꼴로 메움. offset: 중앙 점을 법선 방향으로 띄우는 cm (양 = 바깥)"""
    N = len(loop)
    ring1 = []
    for v in loop:
        p = V[v] * 0.55 + (c + n * offset * 0.6) * 0.45
        ring1.append(len(newV)); newV.append(p)
    ctr = len(newV); newV.append(c + n * offset)
    faces = []
    for i in range(N):
        a, b = loop[i], loop[(i + 1) % N]; a1, b1 = ring1[i], ring1[(i + 1) % N]
        faces.append([a, b, b1, a1]);
    for i in range(N):
        faces.append([ring1[i], ring1[(i + 1) % N], ctr])
    if reverse: faces = [f[::-1] for f in faces]
    newF.extend(faces)
    return ctr

armR, loopR, cR, nR, ringsR = split_side(-1)
armL, loopL, cL, nL, ringsL = split_side(1)
armSet = set(armR) | set(armL)
torso_faces = [fi for fi in range(len(Q)) if fi not in armSet]
# 감김 확인: 몸통 면의 감김 방향(바깥 법선)과 고리 순서 관계 — 채움 면은 몸통 면과 같은 방향이어야 함.
# 고리 순서로 만든 면의 법선이 n 과 반대면 뒤집음
def ring_orient(loop, c, n):
    P = V[loop]; nn = np.zeros(3)
    for i in range(len(loop)): nn += np.cross(P[i] - c, P[(i + 1) % len(loop)] - c)
    return nn @ n > 0
newV = [p for p in V]; torsoF = [list(Q[fi]) for fi in torso_faces]
armF = {"R": [list(Q[fi]) for fi in armR], "L": [list(Q[fi]) for fi in armL]}
pivots = {}
for side, loop, c, n, rings in (("R", loopR, cR, nR, ringsR), ("L", loopL, cL, nL, ringsL)):
    out = ring_orient(loop, c, n)
    # 몸통 채움: 바깥으로 볼록 (법선 = 바깥쪽이면 고리 순서가 바깥 감김일 때 그대로)
    fill_ring(loop, c, n, +a.fillOut, newV, torsoF, reverse=not out)
    # 팔 뚜껑: 안쪽으로 눌린 돔, 팔 관 쪽에서 보면 바깥(= -n) 을 봐야 함 → 몸통 채움과 반대 감김
    fill_ring(loop, c, n, -a.capIn, newV, armF[side], reverse=out)
    piv = c - n * a.pivotIn
    # 팔꿈치: 고리 중심들 중 팔 길이 45% 지점, 손: 앞발 고리
    cs = np.array([V[vs_].mean(0) for _, vs_ in rings])   # 둘레 고리 중심, 아래(앞발)→위(어깨)
    L = np.linalg.norm(np.diff(np.vstack([cs, piv[None]]), axis=0), axis=1).sum()
    acc = 0; elbow = cs[len(cs) // 2]
    pts = np.vstack([piv[None], cs[::-1]])
    for i in range(1, len(pts)):
        seg = np.linalg.norm(pts[i] - pts[i - 1])
        if acc + seg >= L * 0.45: elbow = pts[i - 1] + (pts[i] - pts[i - 1]) * (L * 0.45 - acc) / seg; break
        acc += seg
    pivots[side] = {"shoulder": piv.round(2).tolist(), "elbow": elbow.round(2).tolist(), "hand": cs[0].round(2).tolist(), "baseCenter": c.round(2).tolist(), "baseNormal": n.round(3).tolist(), "armLen": round(float(L), 1)}
    print(f"  {side}: pivot {piv.round(1)} elbow {elbow.round(1)} hand {cs[0].round(1)} len {L:.1f}")
newV = np.array(newV)

# ── OBJ 쓰기: 원본 부품 순서 유지, pu_body 대신 몸통+팔 ──
with open(a.out, "w", encoding="utf8") as f:
    f.write("# pu_stand with arms split (scripts/stand_arm_split.py)\n")
    for p in newV: f.write(f"v {p[0]:.4f} {p[1]:.4f} {p[2]:.4f}\n")
    for name in order:
        if name == "pu_body":
            for nm, faces in (("pu_body", torsoF), ("pu_arm_R", armF["R"]), ("pu_arm_L", armF["L"])):
                f.write(f"o {nm}\n")
                for q in faces: f.write("f " + " ".join(str(i + 1) for i in q) + "\n")
        else:
            f.write(f"o {name}\n")
            for q in parts[name]: f.write("f " + " ".join(str(i + 1) for i in q) + "\n")
json.dump(pivots, open(a.out.replace(".obj", ".json"), "w"), indent=1)
print("saved", a.out, "faces torso", len(torsoF), "armR", len(armF["R"]), "armL", len(armF["L"]))
