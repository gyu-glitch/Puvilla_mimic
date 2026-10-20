import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { isEmbedded, visionFileset } from "./embedded";
import * as THREE from "three";
import type { Config } from "./config";
import { log } from "./logger";

/** 한 얼굴에서 뽑은 raw 신호 (스무딩 전) */
export interface RawFace {
  /** 정규화 bbox (0~1), 카메라 원본 좌표계 (미러 전) */
  bbox: { x: number; y: number; w: number; h: number; cx: number; cy: number };
  /** deg. 카메라 기준: yaw(+)=피사체가 자기 왼쪽으로 고개 돌림 — 미러링은 mapping 에서 처리 */
  yaw: number;
  pitch: number;
  roll: number;
  /** ARKit 52 blendshape 이름 → 0~1 */
  blend: Record<string, number>;
  /**
   * 랜드마크로 직접 잰 입 (얼굴 기준 3D 좌표계 — 고개를 숙이거나 돌려도 안정).
   * open  = 윗입술 안쪽(13)–아랫입술 안쪽(14) 간격 / 입 폭
   * corner = 입꼬리(61·291)가 입 중심보다 위(+, 웃음)/아래(−, 시무룩)인 정도 / 입 폭
   * MediaPipe 블렌드셰이프(jawOpen·mouthFrown)는 고개 각도에 흔들리고 frown 이 거의 안 잡혀서 이걸 주로 쓴다.
   */
  mouth: { open: number; corner: number };
  /**
   * 랜드마크로 잰 눈 뜬 정도 (눈꺼풀 위–아래 간격 3쌍 평균 / 눈 폭). left/right = 본인 기준 (블렌드셰이프와 같음).
   * MediaPipe eyeBlink 블렌드셰이프는 한쪽만 감아도 양쪽이 같이 올라가서 윙크 구분이 안 된다.
   */
  eyes: { left: number; right: number };
}

export interface TrackResult {
  faces: RawFace[];
  inferenceMs: number;
}

const _m = new THREE.Matrix4();
const _e = new THREE.Euler();

export class FaceTracker {
  private landmarker: FaceLandmarker | null = null;
  private lastVideoTime = -1;
  private frameCounter = 0;
  private lastResult: TrackResult = { faces: [], inferenceMs: 0 };
  /** 워커 모드: 추론이 렌더 스레드를 막지 않음 (다른 코어에서 병렬) */
  private worker: Worker | null = null;
  private busy = false;
  private workerReadyAt = 0;
  private resultTimes: number[] = [];
  private falling = false;
  private inputEpoch = 0;
  /** 오버레이 표시용: "worker-GPU" / "main-GPU" 등 */
  mode = "";
  modelSource = "";

  constructor(private cfg: Config["tracker"]) {}

  async init(): Promise<void> {
    if (this.cfg.useWorker && !isEmbedded && typeof Worker !== "undefined" && typeof createImageBitmap !== "undefined") {
      try {
        await this.initWorker();
        return;
      } catch (e) {
        log.warn("tracker", `워커 모드 실패 → 메인 스레드에서 추론: ${String(e)}`);
        this.worker?.terminate();
        this.worker = null;
      }
    }
    await this.initMain();
  }

  private async initMain(): Promise<void> {
    const fileset = await visionFileset(this.cfg.wasmPath, (w) => FilesetResolver.forVisionTasks(w));
    const modelAssetPath = await this.resolveModelPath();
    this.modelSource = modelAssetPath;
    this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath, delegate: this.cfg.delegate },
      runningMode: "VIDEO",
      numFaces: this.cfg.numFaces,
      minFaceDetectionConfidence: this.cfg.minFaceDetectionConfidence,
      minFacePresenceConfidence: this.cfg.minFacePresenceConfidence,
      minTrackingConfidence: this.cfg.minTrackingConfidence,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
    log.info("tracker", `FaceLandmarker ready delegate=${this.cfg.delegate} model=${modelAssetPath}`);
    this.mode = `main-${this.cfg.delegate}`;
  }

  private async initWorker(): Promise<void> {
    const modelPath = new URL(await this.resolveModelPath(), location.href).href;
    const wasmPath = new URL(this.cfg.wasmPath.replace(/\/?$/, "/"), location.href).href.replace(/\/$/, "");
    const w = new Worker(new URL("./trackerWorker.ts", import.meta.url), { type: "module" });
    this.worker = w;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("워커 초기화 시간 초과")), 45000);
      w.onerror = (ev) => {
        clearTimeout(timer);
        reject(new Error(ev.message || "worker error"));
      };
      w.onmessage = (ev: MessageEvent) => {
        const d = ev.data;
        if (d.type === "log") log.warn("tracker", d.msg);
        else if (d.type === "error") {
          clearTimeout(timer);
          reject(new Error(d.msg));
        } else if (d.type === "ready") {
          clearTimeout(timer);
          log.info("tracker", `FaceLandmarker ready (워커) delegate=${d.delegate} model=${modelPath}`);
          this.mode = `worker-${d.delegate}`;
          resolve();
        }
      };
      w.postMessage({
        type: "init", wasmPath, modelPath, delegate: this.cfg.delegate, transpose: this.cfg.transposeMatrix,
        options: {
          runningMode: "VIDEO",
          numFaces: this.cfg.numFaces,
          minFaceDetectionConfidence: this.cfg.minFaceDetectionConfidence,
          minFacePresenceConfidence: this.cfg.minFacePresenceConfidence,
          minTrackingConfidence: this.cfg.minTrackingConfidence,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        },
      });
    });
    this.modelSource = modelPath;
    this.workerReadyAt = performance.now();
    w.onmessage = (ev: MessageEvent) => {
      const d = ev.data;
      if (d.type !== "result") return;
      this.busy = false;
      if (d.epoch !== this.inputEpoch) return;
      this.resultTimes.push(performance.now());
      if (d.faces) this.lastResult = { faces: d.faces as RawFace[], inferenceMs: d.inferenceMs };
    };
  }

  /**
   * 워커 추론이 너무 느리면(일부 안드로이드: 워커 안 WebGL 이 소프트웨어로 떨어져 초당 1~2회) 메인 스레드 GPU 로 전환.
   * 워커가 준비되고 3초 뒤부터, 최근 2초 동안 결과가 초당 8회 미만이면.
   */
  private checkWorkerSpeed(nowMs: number): void {
    if (this.falling || !this.workerReadyAt || nowMs - this.workerReadyAt < 3000) return;
    this.resultTimes = this.resultTimes.filter((t) => nowMs - t < 2000);
    if (this.resultTimes.length >= 16) return;
    this.falling = true;
    log.warn("tracker", `워커 추론이 느림 (최근 2초 ${this.resultTimes.length}회) → 메인 스레드 GPU 로 전환`);
    this.worker?.terminate();
    this.worker = null;
    this.busy = false;
    this.mode = "전환 중…";
    void this.initMain().catch((e) => log.error("tracker", `메인 스레드 전환 실패: ${String(e)}`));
  }

  /** 로컬 모델 우선, 없으면 CDN 폴백 */
  private async resolveModelPath(): Promise<string> {
    try {
      const head = await fetch(this.cfg.modelPath, { method: "HEAD" });
      if (head.ok) return this.cfg.modelPath;
    } catch {
      /* fallthrough */
    }
    log.warn("tracker", `로컬 모델 없음(${this.cfg.modelPath}) → CDN 폴백. 'npm run fetch-models' 실행 권장`);
    return this.cfg.modelUrlFallback;
  }

  /** 매 렌더 프레임에 호출. 새 비디오 프레임일 때만 추론. */
  update(video: HTMLVideoElement, nowMs: number, input: HTMLCanvasElement | HTMLVideoElement = video): TrackResult {
    if ((!this.landmarker && !this.worker) || video.readyState < 2) return this.lastResult;
    if (this.worker) this.checkWorkerSpeed(nowMs);
    if (this.worker && this.busy) return this.lastResult; // 앞 프레임 추론 중 — 렌더는 기다리지 않음
    if (video.currentTime === this.lastVideoTime) return this.lastResult;
    this.lastVideoTime = video.currentTime;

    this.frameCounter++;
    if (this.frameCounter % Math.max(1, this.cfg.inferenceEveryNFrames) !== 0) return this.lastResult;

    if (this.worker) {
      const w = this.worker;
      const epoch = this.inputEpoch;
      this.busy = true;
      createImageBitmap(input).then(
        (bitmap) => w.postMessage({ type: "frame", bitmap, ts: performance.now(), epoch }, [bitmap]),
        () => (this.busy = false),
      );
      return this.lastResult;
    }
    if (!this.landmarker) return this.lastResult;

    const t0 = performance.now();
    let res: FaceLandmarkerResult;
    try {
      res = this.landmarker.detectForVideo(input, nowMs);
    } catch (e) {
      log.error("tracker", `detectForVideo 실패: ${String(e)}`);
      return this.lastResult;
    }
    const inferenceMs = performance.now() - t0;

    const width = "videoWidth" in input ? input.videoWidth : input.width;
    const height = "videoHeight" in input ? input.videoHeight : input.height;
    const faces = toRawFaces(res, width || 1, height || 1, this.cfg.transposeMatrix);
    this.lastResult = { faces, inferenceMs };
    return this.lastResult;
  }

  resetInput(): void {
    this.inputEpoch++;
    this.lastResult = { faces: [], inferenceMs: 0 };
    this.lastVideoTime = -1;
    this.frameCounter = 0;
  }

  close(): void {
    this.worker?.terminate();
    this.worker = null;
    this.landmarker?.close();
    this.landmarker = null;
  }
}


/** MediaPipe 결과 → RawFace[] (메인 스레드·워커 공용) */
export function toRawFaces(res: FaceLandmarkerResult, vw: number, vh: number, transpose: boolean): RawFace[] {
  const faces: RawFace[] = [];
  for (let i = 0; i < res.faceLandmarks.length; i++) {
    const lm = res.faceLandmarks[i];
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const p of lm) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const w = maxX - minX, h = maxY - minY;

    // 머리 회전: facialTransformationMatrix(4x4, column-major) → Euler YXZ
    let yaw = 0, pitch = 0, roll = 0;
    const mat = res.facialTransformationMatrixes[i];
    if (mat && mat.data.length === 16) {
      _m.fromArray(mat.data);
      if (transpose) _m.transpose();
      _e.setFromRotationMatrix(_m, "YXZ");
      yaw = THREE.MathUtils.radToDeg(_e.y);
      pitch = THREE.MathUtils.radToDeg(_e.x);
      roll = THREE.MathUtils.radToDeg(_e.z);
    }

    const blend: Record<string, number> = {};
    const cats = res.faceBlendshapes[i]?.categories ?? [];
    for (const c of cats) blend[c.categoryName] = c.score;

    faces.push({
      bbox: { x: minX, y: minY, w, h, cx: minX + w / 2, cy: minY + h / 2 },
      yaw, pitch, roll, blend,
      mouth: measureMouth(lm, vw, vh),
      eyes: measureEyes(lm, vw, vh),
    });
  }

  return faces;
}

/** 얼굴 기준 좌표계에서 입 벌림·입꼬리 높이 측정 (설명은 RawFace.mouth) */
export function measureMouth(lm: { x: number; y: number; z: number }[], vw: number, vh: number): { open: number; corner: number } {
  if (lm.length < 292) return { open: 0, corner: 0 };
  // MediaPipe: x·y 는 이미지 정규화, z 는 x 와 같은 스케일 → 픽셀 단위로 맞춤 (y 는 위가 + 가 되게 뒤집음)
  const P = (i: number) => new THREE.Vector3(lm[i].x * vw, -lm[i].y * vh, -lm[i].z * vw);
  const eyeR = P(33), eyeL = P(263), top = P(10), chin = P(152);
  const u = eyeL.clone().sub(eyeR).normalize();                 // 얼굴 가로
  const up = top.clone().sub(chin).normalize();                 // 얼굴 세로(대략)
  const w = new THREE.Vector3().crossVectors(u, up).normalize(); // 얼굴 정면
  const v = new THREE.Vector3().crossVectors(w, u).normalize();  // 얼굴 위 (u 와 직교)
  const lipT = P(13), lipB = P(14), cL = P(61), cR = P(291);
  const center = lipT.clone().add(lipB).multiplyScalar(0.5);
  const width = cR.clone().sub(cL).length() || 1;
  const open = Math.max(0, lipT.clone().sub(lipB).dot(v)) / width;
  const corner = (cL.clone().sub(center).dot(v) + cR.clone().sub(center).dot(v)) / 2 / width;
  return { open, corner };
}

/** 눈 뜬 정도 (설명은 RawFace.eyes). 얼굴 세로축으로 투영해 고개 기울기(roll)에 안 흔들리게 */
export function measureEyes(lm: { x: number; y: number; z: number }[], vw: number, vh: number): { left: number; right: number } {
  if (lm.length < 388) return { left: 0, right: 0 };
  const P = (i: number) => new THREE.Vector3(lm[i].x * vw, -lm[i].y * vh, -lm[i].z * vw);
  const u = P(263).sub(P(33)).normalize();
  const up = P(10).sub(P(152)).normalize();
  const w = new THREE.Vector3().crossVectors(u, up).normalize();
  const v = new THREE.Vector3().crossVectors(w, u).normalize();
  const ear = (inner: number, outer: number, upper: number[], lower: number[]) => {
    const width = P(outer).sub(P(inner)).length() || 1;
    let gap = 0;
    for (let k = 0; k < upper.length; k++) gap += Math.max(0, P(upper[k]).sub(P(lower[k])).dot(v));
    return gap / upper.length / width;
  };
  return {
    // 본인 왼눈 = 이미지 오른쪽 (362 안쪽, 263 바깥)
    left: ear(362, 263, [385, 386, 387], [380, 374, 373]),
    right: ear(133, 33, [158, 159, 160], [153, 145, 144]),
  };
}
