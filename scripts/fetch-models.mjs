// Face Landmarker 모델(.task)을 public/models/ 로 내려받는다.
// 런타임은 로컬 파일을 우선 쓰고, 없으면 config.json 의 modelUrlFallback(CDN)으로 넘어간다.
import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(root, "public/models");
mkdirSync(dir, { recursive: true });

const MODELS = [
  {
    name: "face_landmarker.task",
    url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  },
  {
    // 상반신 미믹 (config.json pose.modelPath)
    name: "pose_landmarker_full.task",
    url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
  },
];

for (const m of MODELS) {
  const out = resolve(dir, m.name);
  if (existsSync(out) && statSync(out).size > 1_000_000) {
    console.log("[fetch-models] 이미 있음:", m.name);
    continue;
  }
  console.log("[fetch-models] 다운로드:", m.url);
  const res = await fetch(m.url);
  if (!res.ok || !res.body) throw new Error(`${m.name}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(out));
  console.log("[fetch-models] ->", out, `${(statSync(out).size / 1e6).toFixed(1)} MB`);
}
