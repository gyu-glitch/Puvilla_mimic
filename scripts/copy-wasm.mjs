// @mediapipe/tasks-vision 의 wasm 런타임을 public/ 으로 복사한다.
// CDN(jsdelivr) 의존 없이 로컬에서만 로드하기 위함 — 현장 PC는 외부망이 불안정할 수 있다.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "node_modules/@mediapipe/tasks-vision/wasm");
const dst = resolve(root, "public/mediapipe/wasm");

if (!existsSync(src)) {
  console.warn("[copy-wasm] node_modules/@mediapipe/tasks-vision/wasm 없음 — npm install 후 다시 실행");
  process.exit(0);
}
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log("[copy-wasm] ->", dst);
