// 개발 서버 전용: 오버레이에서 바꾼 튜닝값을 public/config.json 에 바로 저장한다 (새로고침해도 유지).
// POST /__mimic/save-config  body = config JSON
import { appendFileSync, mkdirSync, writeFileSync, createReadStream, statSync } from "node:fs";
import { resolve } from "node:path";

export default function configSaver() {
  return {
    name: "mimic-config-saver",
    configureServer(server) {
      // Local render exports only. Separate from camera/pose telemetry.
      server.middlewares.use("/__mimic/capture", (req, res) => {
        if(req.method!=="POST" || !/^http:\/\/(localhost|127\.0\.0\.1):5175$/.test(req.headers.origin||"")){
          res.statusCode=403;res.end();return;
        }
        let body="",size=0,tooLarge=false;
        req.on("data",chunk=>{size+=chunk.length;if(size>24*1024*1024){tooLarge=true;return;}body+=chunk;});
        req.on("end",()=>{
          if(tooLarge){res.statusCode=413;res.end();return;}
          try{
            const {name,data}=JSON.parse(body);
            if(!/^[a-z0-9-]{1,80}$/.test(name))throw new Error('Invalid name');
            const match=/^data:(image\/png|video\/webm)(?:;codecs=[^;,]+)?;base64,([A-Za-z0-9+/=]+)$/.exec(data);
            if(!match)throw new Error('Invalid render data');
            const extension=match[1]==='image/png'?'png':'webm';
            const dir=resolve(server.config.root,'docs/arm-review');mkdirSync(dir,{recursive:true});
            const file=`${name}.${extension}`;
            writeFileSync(resolve(dir,file),Buffer.from(match[2],'base64'));
            res.setHeader('content-type','application/json');res.end(JSON.stringify({file}));
          }catch{res.statusCode=400;res.end('Invalid render capture');}
        });
      });
      server.middlewares.use("/__mimic/save-config", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          try {
            const obj = JSON.parse(body);
            const file = resolve(server.config.root, "public/config.json");
            writeFileSync(file, JSON.stringify(obj, null, 2) + "\n", "utf8");
            res.setHeader("content-type", "text/plain");
            res.end("ok");
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
      // 개발용: 구운 모델 저장 — POST /__mimic/save-model?name=xxx.bin (또는 .glb) → public/models/xxx
      server.middlewares.use("/__mimic/save-model", (req, res) => {
        const name = new URL(req.url || "", "http://x").searchParams.get("name") || "";
        if (req.method !== "POST" || !/^[A-Za-z0-9_.-]+[.](bin|glb)$/.test(name)) {
          res.statusCode = 400;
          res.end();
          return;
        }
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          writeFileSync(resolve(server.config.root, "public/models", name), Buffer.concat(chunks));
          res.end("ok");
        });
      });
      // 개발용: 원본 에셋 폴더(../asset) 파일 보기 — GET /__asset/<경로> (FBX 확인용)
      server.middlewares.use("/__asset", (req, res) => {
        const rel = decodeURIComponent((req.url || "/").split("?")[0]).replace(/^\/+/, "");
        const base = resolve(server.config.root, "../asset");
        const file = resolve(base, rel);
        if (!file.startsWith(base)) {
          res.statusCode = 403;
          res.end();
          return;
        }
        try {
          const st = statSync(file);
          res.setHeader("content-length", st.size);
          res.setHeader("content-type", "application/octet-stream");
          createReadStream(file).pipe(res);
        } catch {
          res.statusCode = 404;
          res.end();
        }
      });
      // 개발용 수치 기록(표정 튜닝): POST /__mimic/trace  body = JSON 줄들 → .trace/trace.jsonl 에 덧붙임. 영상은 절대 안 보냄.
      server.middlewares.use("/__mimic/trace", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const dir = resolve(server.config.root, ".trace");
          mkdirSync(dir, { recursive: true });
          appendFileSync(resolve(dir, "trace.jsonl"), body.endsWith("\n") ? body : body + "\n", "utf8");
          res.end("ok");
        });
      });
    },
  };
}
