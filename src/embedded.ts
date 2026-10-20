import type { FilesetResolver } from "@mediapipe/tasks-vision";

type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

/**
 * 단일 HTML 빌드(`npm run build:single`)용.
 * 빌드 스크립트가 `window.__MIMIC_EMBED = { "models/x.task": "<base64>", ... }` 를 HTML 에 넣어 두면
 * 서버 없이(file://) 열어도 fetch·wasm 로딩이 그 내용을 쓴다. 개발/일반 빌드에선 아무 일도 안 함.
 */
// globalThis: 얼굴 인식 워커에서도 이 모듈을 불러오므로 window 를 직접 쓰지 않음
const EMBED = (globalThis as unknown as { __MIMIC_EMBED?: Record<string, string> }).__MIMIC_EMBED;
export const isEmbedded = !!EMBED;

const bytesCache = new Map<string, Uint8Array>();
const urlCache = new Map<string, string>();

function key(url: string): string {
  return url.replace(/[?#].*$/, "").replace(/^\.?\//, "").replace(/^.*?\/(models|mediapipe)\//, "$1/");
}

function bytes(k: string): Uint8Array | null {
  if (!EMBED || !(k in EMBED)) return null;
  let b = bytesCache.get(k);
  if (!b) {
    const s = atob(EMBED[k]);
    b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    bytesCache.set(k, b);
  }
  return b;
}

function mime(k: string): string {
  if (k.endsWith(".wasm")) return "application/wasm";
  if (k.endsWith(".js")) return "text/javascript";
  if (k.endsWith(".json")) return "application/json";
  if (k.endsWith(".webp")) return "image/webp";
  if (k.endsWith(".jpg")) return "image/jpeg";
  return "application/octet-stream";
}

/** 내장 파일의 blob URL (스크립트 태그로 로드해야 하는 wasm 로더용) */
function blobUrl(k: string): string | null {
  const b = bytes(k);
  if (!b) return null;
  let u = urlCache.get(k);
  if (!u) {
    u = URL.createObjectURL(new Blob([b as BlobPart], { type: mime(k) }));
    urlCache.set(k, u);
  }
  return u;
}

if (EMBED) {
  const orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const b = bytes(key(url));
    if (b) return Promise.resolve(new Response(init?.method === "HEAD" ? null : (b as BlobPart), { status: 200, headers: { "content-type": mime(key(url)) } }));
    return orig(input, init);
  };
}

/** 이미지 태그 등 fetch 를 안 거치는 곳: 내장본이 있으면 blob URL, 없으면 경로 그대로 */
export function assetUrl(path: string): string {
  return blobUrl(key(path)) ?? path;
}

/** MediaPipe wasm 파일 묶음: 내장본이 있으면 blob URL, 없으면 경로 그대로 */
export async function visionFileset(wasmPath: string, resolve: (p: string) => Promise<WasmFileset>): Promise<WasmFileset> {
  const loader = blobUrl("mediapipe/wasm/vision_wasm_internal.js");
  const binary = blobUrl("mediapipe/wasm/vision_wasm_internal.wasm");
  if (loader && binary) return { wasmLoaderPath: loader, wasmBinaryPath: binary };
  return resolve(wasmPath);
}
