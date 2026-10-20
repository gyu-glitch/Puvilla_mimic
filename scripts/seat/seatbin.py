"""public/models/seat.bin 읽기·쓰기 (dev/armsplit.html exportSeat 와 같은 형식).
[u32 헤더 길이][JSON][f32 몸 위치][u32 몸 면][u16×4 스킨 본][f32×4 스킨 가중치][눈L·눈R·코·입: f32 위치 + u32 면] — 덩어리마다 4바이트 정렬
"""
import json, struct, numpy as np

PART_ORDER = ["eyeL", "eyeR", "nose", "mouth"]


def _pad(n): return (n + 3) & ~3


def read(path):
    b = open(path, "rb").read()
    n = struct.unpack_from("<I", b, 0)[0]
    h = json.loads(b[4:4 + n])
    off = 4 + _pad(n)

    def take(dtype, count):
        nonlocal off
        a = np.frombuffer(b, dtype=dtype, count=count, offset=off).copy()
        off += _pad(count * a.itemsize)
        return a

    nv, nt = h["body"]["verts"], h["body"]["tris"]
    body = {
        "pos": take(np.float32, nv * 3).reshape(-1, 3),
        "idx": take(np.uint32, nt * 3).reshape(-1, 3),
        "si": take(np.uint16, nv * 4).reshape(-1, 4),
        "sw": take(np.float32, nv * 4).reshape(-1, 4),
    }
    parts = {}
    for k in PART_ORDER:
        q = h["parts"][k]
        parts[k] = {"pos": take(np.float32, q["verts"] * 3).reshape(-1, 3), "idx": take(np.uint32, q["tris"] * 3).reshape(-1, 3)}
    return h, body, parts


def write(path, header, body, parts):
    h = dict(header)
    h["body"] = {"verts": int(len(body["pos"])), "tris": int(len(body["idx"]))}
    h["parts"] = {k: {"verts": int(len(parts[k]["pos"])), "tris": int(len(parts[k]["idx"]))} for k in PART_ORDER}
    enc = json.dumps(h).encode("utf8")
    chunks = [np.ascontiguousarray(body["pos"], np.float32), np.ascontiguousarray(body["idx"], np.uint32),
              np.ascontiguousarray(body["si"], np.uint16), np.ascontiguousarray(body["sw"], np.float32)]
    for k in PART_ORDER:
        chunks += [np.ascontiguousarray(parts[k]["pos"], np.float32), np.ascontiguousarray(parts[k]["idx"], np.uint32)]
    out = bytearray(struct.pack("<I", len(enc)) + enc + b"\0" * (_pad(len(enc)) - len(enc)))
    for c in chunks:
        raw = c.tobytes(); out += raw + b"\0" * (_pad(len(raw)) - len(raw))
    open(path, "wb").write(out)
    return len(out)
