// `npm run deploy` — 새 버전을 빌드해 호스팅에 반영. 보는 사람은 같은 링크에서 새로고침만 하면 된다.
// 빌드는 프로젝트 밖 호스팅 폴더(../pubilla-mimic-codex-hosting/<시각>/)에 하고, current.txt 가 가리키는 버전을 서버가 서빙
// (Windows 에선 개발 서버가 감시 중인 폴더의 이름 바꾸기가 막혀서 교체 대신 '가리키기' 방식).
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, readdirSync, mkdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const hosting = resolve(root, "..", "pubilla-mimic-codex-hosting");
// `--preview`: 컨펌 전 작업 버전 — 공개 링크(current.txt)는 건드리지 않고 preview.txt 로만 올림
// (테스트 서버 scripts/serve-loop-test.cmd 가 preview.txt 를 루트로 4174 에 서빙, Funnel 8443 → 공개와 다른 주소·다른 저장소)
const preview = process.argv.includes("--preview");
const stamp = (preview ? "preview-codex-" : "codex-") + new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
const out = resolve(hosting, stamp);
mkdirSync(hosting, { recursive: true });

execSync("npx tsc --noEmit", { cwd: root, stdio: "inherit" });
execSync(`npx vite build --outDir "${out}" --emptyOutDir`, { cwd: root, stdio: "inherit" });

// 받는 사람 PC·카메라는 다르다: 이 PC 에 맞춘 수동 노출은 끄고 카메라 자동 노출로 시작
const cfgPath = resolve(out, "config.json");
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
cfg.build = stamp;
cfg.camera = { ...cfg.camera, applyImageSettings: false, autoExposure: true };
// DEPLOY_CONFIG='{"outfit":{"seatBody":true}}' — 이 빌드에만 넣는 config 덮어쓰기 (public/config.json 은 안 건드림)
if (process.env.DEPLOY_CONFIG) {
  const merge = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === "object" && !Array.isArray(v) ? merge({ ...(a[k] ?? {}) }, v) : v; return a; };
  merge(cfg, JSON.parse(process.env.DEPLOY_CONFIG));
  console.log("[deploy] config 덮어쓰기:", process.env.DEPLOY_CONFIG);
}
// 무거운 공용 파일(엔진 13MB·얼굴 3.7MB·상반신 9MB)은 공용 CDN 에서 — Tailscale Funnel 회선이 느려서(≈150KB/s) 여기선 앱 본체만 나가게.
// 로컬과 바이트 단위로 같은 파일(배포 시 확인함). 모델은 CDN 이 막히면 로컬 사본으로 대체.
const mpVersion = JSON.parse(readFileSync(resolve(root, "node_modules/@mediapipe/tasks-vision/package.json"), "utf8")).version;
cfg.tracker = {
  ...cfg.tracker,
  wasmPath: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${mpVersion}/wasm`,
  modelPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  modelUrlFallback: "./models/face_landmarker.task",
};
cfg.pose = {
  ...cfg.pose,
  modelPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
  modelUrlFallback: "./models/pose_landmarker_full.task",
};
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

// nosimd 변형 wasm 과 소스맵은 안 씀 (module 변형은 얼굴 인식 워커가 씀)
for (const f of ["vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"])
  rmSync(resolve(out, "mediapipe/wasm", f), { force: true });
for (const f of readdirSync(resolve(out, "assets"))) if (f.endsWith(".map")) rmSync(resolve(out, "assets", f));

// 미리 gzip (서버가 Accept-Encoding 보고 .gz 전송) — 이미 압축된 .task(zip)는 제외
const gz = (dir) => {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const f = resolve(dir, d.name);
    if (d.isDirectory()) gz(f);
    else if (/\.(wasm|js|css|html|json|obj|svg|bin)$/.test(d.name) && statSync(f).size > 1024) writeFileSync(f + ".gz", gzipSync(readFileSync(f), { level: 9 }));
  }
};
gz(out);

writeFileSync(resolve(hosting, preview ? "preview.txt" : "current.txt"), stamp);


console.log(`[codex deploy] ${stamp} → https://nau-gyuchan.tailc22fe0.ts.net:10000/`);
