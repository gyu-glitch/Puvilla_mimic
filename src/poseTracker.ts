import { FilesetResolver, PoseLandmarker, type PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { isEmbedded, visionFileset } from "./embedded";
import type { Config } from "./config";
import { log } from "./logger";

/** Pose 월드 랜드마크 1명분 (33개, m, 엉덩이 중심 원점, 축은 카메라 이미지 기준: x→오른쪽, y→아래, z→카메라에서 멀어짐) */
export interface RawPose {
  world: { x: number; y: number; z: number; visibility: number }[];
  /** Normalized image positions: world coordinates can hallucinate an off-screen wrist. */
  image?: { x: number; y: number }[];
  imageAspect?: number;
  /** 이미지 좌표(0~1, 미러 전) 코·어깨 — 얼굴 대상과 같은 사람인지 맞출 때 사용 */
  nose: { x: number; y: number };
  shoulderW: number;
}

export interface PoseResult {
  poses: RawPose[];
  inferenceMs: number;
  fresh: boolean;
  observedAtMs?: number;
}

/**
 * 상반신 미믹용 MediaPipe Pose Landmarker. 얼굴 트래커와 같은 비디오 프레임을 쓰되,
 * 부하를 나누기 위해 everyNFrames 로 건너뛸 수 있다.
 */
export class PoseTracker {
  private landmarker: PoseLandmarker | null = null;
  private lastVideoTime = -1;
  private frameCounter = 0;
  private last: PoseResult = { poses: [], inferenceMs: 0, fresh: false };
  private worker: Worker | null = null;
  private busy = false;
  private pending = false;
  private epoch = 0;
  mode = "";
  modelSource = "";

  constructor(private cfg: Config["pose"], private wasmPath: string) {}

  async init(): Promise<void> {
    if (this.cfg.useWorker !== false && !isEmbedded && typeof Worker !== "undefined" && typeof createImageBitmap !== "undefined") {
      try { await this.initWorker(); return; }
      catch (e) {
        log.warn("pose", `워커 초기화 실패 → 메인 추론: ${String(e)}`);
        this.worker?.terminate(); this.worker = null;
      }
    }
    const fileset = await visionFileset(this.wasmPath, (w) => FilesetResolver.forVisionTasks(w));
    const modelAssetPath = await this.resolveModelPath();
    this.modelSource = modelAssetPath;
    this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath, delegate: this.cfg.delegate },
      runningMode: "VIDEO",
      numPoses: this.cfg.numPoses,
      minPoseDetectionConfidence: this.cfg.minDetectionConfidence,
      minPosePresenceConfidence: this.cfg.minPresenceConfidence,
      minTrackingConfidence: this.cfg.minTrackingConfidence,
      outputSegmentationMasks: false,
    });
    log.info("pose", `PoseLandmarker ready delegate=${this.cfg.delegate} model=${modelAssetPath}`);
    this.mode = `main-${this.cfg.delegate}`;
  }

  private async initWorker(): Promise<void> {
    const modelPath = new URL(await this.resolveModelPath(), location.href).href;
    const wasmPath = new URL(this.wasmPath.replace(/\/?$/, "/"), location.href).href.replace(/\/$/, "");
    const worker = new Worker(new URL("./poseWorker.ts", import.meta.url), { type: "module" });
    this.worker = worker;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("pose worker timeout")), 45000);
      worker.onerror = e => { clearTimeout(timer); reject(new Error(e.message)); };
      worker.onmessage = ({ data }) => {
        if (data.type === "ready") {
          clearTimeout(timer); this.mode = `worker-${data.delegate}`; resolve();
        } else if (data.type === "error") {
          clearTimeout(timer); reject(new Error(data.message));
        }
      };
      worker.postMessage({ type: "init", cfg: this.cfg, modelPath, wasmPath });
    });
    this.modelSource = modelPath;
    worker.onmessage = ({ data }) => {
      if (data.type !== "result") return;
      this.busy = false;
      // Do not revive a lock with a delayed frame or a pre-rotation result.
      if (data.epoch !== this.epoch || !data.poses || performance.now() - data.ts > 500) return;
      this.last = { poses: data.poses, inferenceMs: data.inferenceMs, observedAtMs: data.ts, fresh: false };
      this.pending = true;
    };
    worker.onerror = e => {
      this.busy = false;
      log.error("pose", `워커 오류: ${e.message}`);
    };
    log.info("pose", `PoseLandmarker ready ${this.mode}`);
  }

  private async resolveModelPath(): Promise<string> {
    try {
      const head = await fetch(this.cfg.modelPath, { method: "HEAD" });
      if (head.ok) return this.cfg.modelPath;
    } catch {
      /* fallthrough */
    }
    log.warn("pose", `로컬 포즈 모델 없음(${this.cfg.modelPath}) → CDN 폴백. 'npm run fetch-models' 실행 권장`);
    return this.cfg.modelUrlFallback;
  }

  update(video: HTMLVideoElement, nowMs: number, input: HTMLCanvasElement | HTMLVideoElement = video): PoseResult {
    if (this.worker) {
      const result = { ...this.last, fresh: this.pending && nowMs - (this.last.observedAtMs ?? -Infinity) <= 500 };
      this.pending = false;
      if (video.readyState < 2 || this.busy || video.currentTime === this.lastVideoTime) return result;
      this.lastVideoTime = video.currentTime;
      if (++this.frameCounter % Math.max(1, this.cfg.everyNFrames) !== 0) return result;
      const worker = this.worker, epoch = this.epoch;
      this.busy = true;
      createImageBitmap(input).then(bitmap => {
        if (worker !== this.worker || epoch !== this.epoch) { bitmap.close(); this.busy = false; return; }
        worker.postMessage({ type: "frame", bitmap, ts: nowMs, epoch }, [bitmap]);
      }).catch(e => { this.busy = false; log.warn("pose", String(e)); });
      return result;
    }
    if (!this.landmarker || video.readyState < 2) return { ...this.last, fresh: false };
    if (video.currentTime === this.lastVideoTime) return { ...this.last, fresh: false };
    this.lastVideoTime = video.currentTime;
    this.frameCounter++;
    if (this.frameCounter % Math.max(1, this.cfg.everyNFrames) !== 0) return { ...this.last, fresh: false };

    const t0 = performance.now();
    let res: PoseLandmarkerResult;
    try {
      res = this.landmarker.detectForVideo(input, nowMs);
    } catch (e) {
      log.error("pose", `detectForVideo 실패: ${String(e)}`);
      return { ...this.last, fresh: false };
    }
    const poses: RawPose[] = res.worldLandmarks.map((w, i) => {
      const lm = res.landmarks[i];
      return {
        world: w.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 0 })),
        image: lm.map((p) => ({ x: p.x, y: p.y })),
        imageAspect: "videoWidth" in input ? input.videoWidth/input.videoHeight : input.width/input.height,
        nose: { x: lm[0].x, y: lm[0].y },
        shoulderW: Math.hypot(lm[11].x - lm[12].x, lm[11].y - lm[12].y),
      };
    });
    this.last = {
      poses,
      inferenceMs: performance.now() - t0,
      fresh: true,
      observedAtMs: nowMs,
    };
    return this.last;
  }

  resetInput(): void {
    this.epoch++;
    this.pending = false;
    this.last = { poses: [], inferenceMs: 0, fresh: false };
    this.lastVideoTime = -1;
    this.frameCounter = 0;
  }

  close(): void {
    this.epoch++;
    this.worker?.terminate();
    this.worker = null;
    this.busy = this.pending = false;
    this.landmarker?.close();
    this.landmarker = null;
  }
}
