"""생성한 T포즈 푸빌라(GLB, Hunyuan3D) → 앱용 OBJ (pu_stand 좌표계 cm) + 팔 관절 JSON.
사용: python scripts/seat/tpose_to_app.py <in.glb> [out_stem=public/models/pu_tpose]
  1) 생성 메쉬를 pu_stand 에 맞춤: 키(높이)로 배율 → 머리·몸통 가운데(팔 제외)로 ICP(강체+배율)
  2) 눈·코 부품은 pu_stand 것을 그대로 (같은 좌표), 눈 축 방향으로 새 표면까지 거리 보고
  3) 입선: pu_stand 와 같은 자리(y = a + k·x²) 를 짧은 선 메쉬로 넣어 앱이 재게
  4) 팔 관절: 몸통 폭 밖(|x| > 몸통 반폭)의 정점 = 팔 → 어깨(몸통 가장자리) · 팔꿈치(중간) · 손(끝 8cm 앞) 을 JSON 으로
"""
import sys, json, numpy as np, trimesh
from scipy.spatial import cKDTree

src = sys.argv[1]
stem = sys.argv[2] if len(sys.argv) > 2 else "public/models/pu_tpose"
STAND = "public/models/pu_stand.obj"

# ── pu_stand 읽기 (o 별) ──
V = []; parts = {}; cur = None
for line in open(STAND, encoding="utf8"):
    t = line.split()
    if not t: continue
    if t[0] == "v": V.append([float(x) for x in t[1:4]])
    elif t[0] in ("o", "g"): cur = t[1]; parts.setdefault(cur, [])
    elif t[0] == "f" and cur: parts[cur].append([int(x.split("/")[0]) - 1 for x in t[1:]])
V = np.array(V)
def part_pts(n): return V[sorted({i for f in parts[n] for i in f})]
body_old = part_pts("pu_body")
print("pu_stand body", len(body_old), body_old.min(0).round(1), body_old.max(0).round(1))

# ── 생성 메쉬 ──
m = trimesh.load(src, force="mesh")
P = np.asarray(m.vertices, dtype=np.float64); F = np.asarray(m.faces)
print("gen", len(P), "verts", len(F), "faces", P.min(0).round(3), P.max(0).round(3))
# 축: Hunyuan 출력은 y-up/z-front 가 아닐 수 있음 → 키가 가장 긴 축을 y 로, 팔이 뻗은(가장 넓은) 축을 x 로
ext = P.max(0) - P.min(0)
order = np.argsort(ext)            # 작은→큰: 두께(z), 키(y)?, 팔(x)?  T포즈면 팔 폭 > 키 일 수 있음
# 팔 폭 vs 키: 둘 다 두께보다 큼. 둘 중 '아래쪽 끝이 좁은(다리)' 축이 y. 간단히: 가장 짧은 축 = z, 나머지 둘은 뒤에서 판정
zi = order[0]; cand = [i for i in range(3) if i != zi]
# 각 후보 축을 y 라 가정했을 때, 그 축의 하위 15% 구간 폭(다른 후보 축 방향)이 좁으면 다리 → y
def low_width(yi, xi):
    lo = P[:, yi] < P[:, yi].min() + ext[yi] * 0.15
    return P[lo, xi].max() - P[lo, xi].min()
w0, w1 = low_width(cand[0], cand[1]), low_width(cand[1], cand[0])
yi, xi = (cand[0], cand[1]) if w0 < w1 else (cand[1], cand[0])
Q = np.stack([P[:, xi], P[:, yi], P[:, zi]], 1)
# 앞뒤: 코(가장 앞으로 튀어나온 점)가 +z 가 되게 — 머리 높이(상위 25%)에서 z 분포 치우침으로
head = Q[:, 1] > Q[:, 1].min() + (Q[:, 1].max() - Q[:, 1].min()) * 0.75
zc = Q[head, 2] - np.median(Q[head, 2])
if np.abs(zc.min()) > np.abs(zc.max()): Q[:, 2] *= -1; Q[:, 0] *= -1   # 거울 안 되게 x 도 같이
# 손 방향(위아래)을 확인하려면 y 뒤집힘도 봐야 함: 머리(큰 덩어리)가 위
print("axes x,y,z =", xi, yi, zi)
# ── 배율·이동: 키 맞춤 ──
h_old = body_old[:, 1].max() - body_old[:, 1].min()
s = h_old / (Q[:, 1].max() - Q[:, 1].min())
Q = Q * s
Q[:, 1] += body_old[:, 1].min() - Q[:, 1].min()
Q[:, 0] -= np.median(Q[:, 0]); Q[:, 2] += np.median(body_old[:, 2]) - np.median(Q[:, 2])

# ── ICP (팔 제외: |x| < 30, 몸통·머리·다리) ──
def sel(A): return A[(np.abs(A[:, 0]) < 30)]
B = sel(body_old); tree = cKDTree(B)
R = np.eye(3); t = np.zeros(3); sc = 1.0
A0 = sel(Q)
for it in range(60):
    X = (A0 * sc) @ R.T + t
    d, idx = tree.query(X)
    keep = d < np.percentile(d, 80)
    Pp = A0[keep] * sc; Qq = B[idx[keep]]
    pc, qc = Pp.mean(0), Qq.mean(0)
    H = (Pp - pc).T @ (Qq - qc); U, Sv, Vt = np.linalg.svd(H); Rn = Vt.T @ U.T
    if np.linalg.det(Rn) < 0: Vt[-1] *= -1; Rn = Vt.T @ U.T
    # 배율: 분산 비
    var = ((Pp - pc) ** 2).sum(); scn = Sv.sum() / var if var > 0 else 1
    R = Rn; t = qc - (pc * scn) @ R.T; sc *= scn
    A0 = A0  # (sc 누적)
X = (sel(Q) * sc) @ R.T + t; d, _ = tree.query(X)
print(f"ICP: 배율 {s*sc:.3f} · 잔차 median {np.median(d):.2f} p90 {np.percentile(d,90):.2f} cm")
Qf = (Q * sc) @ R.T + t

# ── 팔 관절 (몸통 반폭 밖) ──
torso = Qf[np.abs(Qf[:, 0]) < 40]
# 어깨 높이: 팔 정점(|x|>45)의 y 중앙
arm = Qf[Qf[:, 0] > 45]
armL = arm if len(arm) else Qf[Qf[:, 0] > 35]
ay, az = np.median(armL[:, 1]), np.median(armL[:, 2])
# 몸통 가장자리 x (어깨 높이 ±8cm 에서 몸통 정점 중 가장 바깥)
band = Qf[(np.abs(Qf[:, 1] - ay) < 8)]
xs = np.sort(band[:, 0]);
torso_half = float(np.percentile(torso[np.abs(torso[:, 1] - ay) < 8][:, 0], 99)) if len(torso) else 35
hand_x = float(np.percentile(armL[:, 0], 99.5))
shoulder = [torso_half - 2, ay, az]; hand = [hand_x - 8, ay, az]; elbow = [(shoulder[0] + hand[0]) / 2, ay, az]
# 팔 축이 정확히 수평이 아닐 수 있음: 팔 x 구간을 3 등분해 y,z 중앙값으로
def axis_pt(x0, x1):
    q = armL[(armL[:, 0] >= x0) & (armL[:, 0] < x1)]
    return [float((x0 + x1) / 2), float(np.median(q[:, 1])), float(np.median(q[:, 2]))] if len(q) > 20 else None
pts = [axis_pt(torso_half + 2, torso_half + 12), axis_pt((torso_half + hand_x) / 2 - 5, (torso_half + hand_x) / 2 + 5), axis_pt(hand_x - 14, hand_x - 4)]
if all(pts):
    shoulder = [torso_half - 2, pts[0][1], pts[0][2]]; elbow = pts[1]; hand = pts[2]
arms = {"shoulderL": shoulder, "elbowL": elbow, "handL": hand, "torsoHalf": torso_half, "handX": hand_x}
print("arm joints", json.dumps({k: (np.round(v, 1).tolist() if isinstance(v, list) else round(v, 1)) for k, v in arms.items()}))

# ── 눈·코 (pu_stand 부품) 과 새 표면 거리 ──
treeQ = cKDTree(Qf)
for n in ("pu_eyes_L", "pu_eyes_R", "pu_nose"):
    c = part_pts(n).mean(0); d, _ = treeQ.query(c)
    print(f"{n} center {c.round(1)} → 새 표면까지 {d:.1f}cm")

# ── OBJ 쓰기 ──
out = open(stem + ".obj", "w", encoding="utf8")
out.write("# T-pose Puuvilla (Hunyuan3D) aligned to pu_stand cm\n")
base = 0
def write_part(name, pts, faces):
    global base
    out.write(f"o {name}\n")
    for p in pts: out.write(f"v {p[0]:.4f} {p[1]:.4f} {p[2]:.4f}\n")
    for f in faces: out.write("f " + " ".join(str(i + 1 + base) for i in f) + "\n")
    base += len(pts)
write_part("pu_body", Qf, F)
for n in ("pu_eyes_L", "pu_eyes_R", "pu_nose"):
    ids = sorted({i for f in parts[n] for i in f}); remap = {v: k for k, v in enumerate(ids)}
    write_part(n, V[ids], [[remap[i] for i in f] for f in parts[n]])
# 입선: pu_stand 입 홈 자리 (mouthRig 가 재던 y=a+kx²) — 앱 기본값 seamY 131.3, k 0.04 (config face 값과 같게)
seamY, k = 131.3, 0.04
xs = np.linspace(-10, 10, 11); mouth = np.array([[x, seamY + k * x * x, 44.0] for x in xs] + [[x, seamY + k * x * x - 0.3, 44.0] for x in xs])
mf = [[i, i + 1, i + 12] for i in range(10)] + [[i, i + 12, i + 11] for i in range(10)]
write_part("pu_mouth", mouth, mf)
out.close()
json.dump(arms, open(stem + ".json", "w"), indent=1)
print("saved", stem + ".obj", stem + ".json")
