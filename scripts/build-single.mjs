// `npm run build:single` — dist/ 를 HTML 파일 하나로 묶는다 (서버·Node 없이 다른 PC 의 Chrome 에서 더블클릭으로 실행).
// JS·CSS 인라인 + 모델/wasm/config 를 base64 로 window.__MIMIC_EMBED 에 넣는다 (src/embedded.ts 가 사용).
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const outDir = resolve(root, "release");
const outFile = resolve(outDir, "pubilla-mimic.html");

// 실행에 필요한 것만 (SIMD wasm 만 — 최근 Chrome 은 전부 지원)
const EMBED = [
  "config.json",
  "models/pu_stand.obj",
  "models/pu_sit.obj",
  "models/muffler_sit.bin",
  "models/muffler_fit.bin",
  "models/seat.bin",
  "models/seat_t.bin",
  "models/muffler_seat.bin",
  "models/muffler_color.jpg",
  "bg/bg_far.webp",
  "bg/village_left.webp",
  "bg/village_right.webp",
  "bg/branches_left.webp",
  "bg/branches_right.webp",
  "models/face_landmarker.task",
  "models/pose_landmarker_full.task",
  "mediapipe/wasm/vision_wasm_internal.js",
  "mediapipe/wasm/vision_wasm_internal.wasm",
];

let html = readFileSync(resolve(dist, "index.html"), "utf8");

// <script type="module" src="./assets/x.js"> → 인라인
html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_, src) => {
  const js = readFileSync(resolve(dist, src), "utf8").replace(/<\/script/gi, "<\\/script");
  return `<script type="module">${js}</script>`;
});
// <link rel="stylesheet" href="./assets/x.css"> → 인라인
html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, href) => `<style>${readFileSync(resolve(dist, href), "utf8")}</style>`);
// modulepreload 같은 남은 외부 참조 제거
html = html.replace(/<link rel="modulepreload"[^>]*>/g, "");

const parts = [];
for (const p of EMBED) {
  let b = readFileSync(resolve(dist, p));
  if (p === "config.json") {
    // 다른 PC·다른 카메라: 이 PC 에 맞춘 수동 노출을 강제하지 않고 카메라 자동 노출로 시작 (그 PC 에서 슬라이더로 조정 → 그 브라우저에 저장)
    const c = JSON.parse(b.toString("utf8"));
    c.camera = { ...c.camera, applyImageSettings: false, autoExposure: true };
    b = Buffer.from(JSON.stringify(c), "utf8");
  }
  parts.push(`${JSON.stringify(p)}:"${b.toString("base64")}"`);
}
const embedTag = `<script>window.__MIMIC_EMBED={${parts.join(",")}};</script>`;
html = html.replace("<head>", `<head>\n${embedTag}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, html, "utf8");
const mb = (statSync(outFile).size / 1024 / 1024).toFixed(1);
console.log(`단일 HTML: ${outFile} (${mb} MB)`);
if (/src="\.\/assets|href="\.\/assets/.test(html)) console.warn("경고: 인라인되지 않은 assets 참조가 남아 있음");
