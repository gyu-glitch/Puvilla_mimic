import { FilesetResolver, PoseLandmarker, type PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { visionFileset } from "./embedded";
import type { Config } from "./config";
import { log } from "./logger";

/** Pose 월드 랜드마크 1명분 (33개, m, 엉덩이 중심 원점, 축은 카메라 이미지 기준: x→오른쪽, y→아래, z→카메라에서 멀어짐) */
export interface RawPose {
  world: { x: number; y: number; z: number; visibility: number }[];
  /** Normalized image positions: world coordinates can hallucinate an off-screen wrist. */
  image?: { x: number; y: number }[];
  /** 이미지 좌표(0~1, 미러 전) 코·어깨 — 얼굴 대상과 같은 사람인지 맞출 때 사용 */
  nose: { x: number; y: number };
  shoulderW: number;
}

export interface PoseResult {
  poses: RawPose[];
  inferenceMs: number;
  fresh: boolean;
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
  modelSource = "";

  constructor(private cfg: Config["pose"], private wasmPath: string) {}

  async init(): Promise<void> {
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

  update(video: HTMLVideoElement, nowMs: number): PoseResult {
    if (!this.landmarker || video.readyState < 2) return { ...this.last, fresh: false };
    if (video.currentTime === this.lastVideoTime) return { ...this.last, fresh: false };
    this.lastVideoTime = video.currentTime;
    this.frameCounter++;
    if (this.frameCounter % Math.max(1, this.cfg.everyNFrames) !== 0) return { ...this.last, fresh: false };

    const t0 = performance.now();
    let res: PoseLandmarkerResult;
    try {
      res = this.landmarker.detectForVideo(video, nowMs);
    } catch (e) {
      log.error("pose", `detectForVideo 실패: ${String(e)}`);
      return { ...this.last, fresh: false };
    }
    const poses: RawPose[] = res.worldLandmarks.map((w, i) => {
      const lm = res.landmarks[i];
      return {
        world: w.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 0 })),
        image: lm.map((p) => ({ x: p.x, y: p.y })),
        nose: { x: lm[0].x, y: lm[0].y },
        shoulderW: Math.hypot(lm[11].x - lm[12].x, lm[11].y - lm[12].y),
      };
    });
    this.last = {
      poses,
      inferenceMs: performance.now() - t0,
      fresh: true,
    };
    return this.last;
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
