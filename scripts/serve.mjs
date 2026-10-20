// 상시 호스팅용 정적 서버: ../pubilla-mimic-codex-hosting/<current.txt 의 버전>/ 을 http://127.0.0.1:4175 으로 서빙
// (외부 공개는 Tailscale Funnel 이 HTTPS 로 앞에서 받음). `npm run deploy` 가 current.txt 를 바꾸면 다음 요청부터 새 버전 (재시작 불필요).
import { createServer } from "node:http";
import { createReadStream, statSync, readFileSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const hosting = resolve(fileURLToPath(new URL("..", import.meta.url)), "..", "pubilla-mimic-codex-hosting");
// ROOT_FILE: 어느 포인터 파일의 빌드를 루트로 서빙할지 — 공개 서버 = current.txt (4175), 테스트 서버 = preview.txt (4175, 별도 Funnel 포트 10000)
const ROOT_FILE = process.env.ROOT_FILE || "current.txt";
const currentRoot = () => resolve(hosting, readFileSync(resolve(hosting, ROOT_FILE), "utf8").trim());
// (옛 방식) /preview/ 경로 — 같은 주소라 localStorage 가 공개 버전과 섞여서 안 씀. 테스트는 ROOT_FILE=preview.txt 인 별도 서버로
const previewRoot = () => resolve(hosting, readFileSync(resolve(hosting, "preview.txt"), "utf8").trim());
const PORT = Number(process.env.PORT || 4175);
const HOST = process.env.HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".task": "application/octet-stream",
  ".obj": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
};

createServer((req, res) => {
  let root;
  let path = decodeURIComponent((req.url || "/").split("?")[0]);
  const preview = ROOT_FILE === "current.txt" && (path === "/preview" || path.startsWith("/preview/"));
  if (preview) path = path.slice("/preview".length) || "/";
  try {
    root = preview ? previewRoot() : currentRoot();
  } catch {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" }).end(preview ? "작업 버전 없음 — npm run deploy:preview" : "아직 배포된 버전 없음 — npm run deploy");
    return;
  }
  if (path.endsWith("/")) path += "index.html";
  const file = resolve(root, "." + path);
  if (!file.startsWith(root + sep) && file !== root) {
    res.writeHead(403).end();
    return;
  }
  let st;
  try {
    st = statSync(file);
    if (st.isDirectory()) throw new Error("dir");
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
    return;
  }
  // 캐시: 해시 번들 = 영구 / 모델·엔진(wasm·task·obj) = 하루 / 나머지(index.html·config.json) = 매번 확인 → 패치 즉시 반영
  // 어느 경우든 ETag 로 재방문 시 304 (Tailscale Funnel 은 대역폭이 작아서 다시 받지 않는 게 중요)
  const hashed = /\/assets\/.+-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(path);
  const heavy = /\.(wasm|task|obj|bin)$/.test(path);
  const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  const headers = {
    "content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
    "cache-control": hashed ? "public, max-age=31536000, immutable" : heavy ? "public, max-age=86400" : "no-cache",
    etag,
    vary: "Accept-Encoding",
  };
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers).end();
    return;
  }
  // 배포 때 미리 만든 .gz 가 있고 브라우저가 받으면 압축본 전송
  let body = file, size = st.size;
  if (/\bgzip\b/.test(String(req.headers["accept-encoding"] || ""))) {
    try {
      size = statSync(file + ".gz").size;
      body = file + ".gz";
      headers["content-encoding"] = "gzip";
    } catch {
      /* 압축본 없음 → 원본 */
    }
  }
  headers["content-length"] = size;
  res.writeHead(200, headers);
  if (req.method === "HEAD") return res.end();
  createReadStream(body).pipe(res);
}).listen(PORT, HOST, () => console.log(`[serve] ${hosting} (current.txt) → http://${HOST}:${PORT}`));
