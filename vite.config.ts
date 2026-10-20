import { defineConfig } from "vite";
import configSaver from "./scripts/config-saver.mjs";

// 키오스크 PC에서 file:// 가 아니라 `vite preview` 또는 정적 서버로 서빙한다.
// base "./" 로 두면 어떤 경로에 올려도 상대경로로 동작.
export default defineConfig({
  base: "./",
  plugins: [configSaver()],
  // config.json 은 앱이 직접 저장하므로 저장할 때마다 페이지가 새로고침되지 않게 감시 제외
  // hmr: false — 코드를 고쳐도 열린 페이지가 저절로 새로고침되지 않게 (새로고침마다 카메라가 다시 열려 노출이 리셋됨).
  // 바뀐 코드는 직접 새로고침(F5)할 때 반영.
  server: { port: 5175, strictPort: true, hmr: false, watch: { ignored: ["**/public/config.json", "**/.trace/**"] } },
  preview: { port: 4175, strictPort: true },
  // 얼굴 인식 워커는 ES 모듈 (MediaPipe wasm 로더도 모듈판 사용)
  worker: { format: "es" },
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
  },
  optimizeDeps: {
    exclude: ["@mediapipe/tasks-vision"],
  },
});
