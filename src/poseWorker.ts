/// <reference lib="webworker" />
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { Config } from "./config";
declare const self: DedicatedWorkerGlobalScope;
let landmarker: PoseLandmarker | null = null;
type Init = { type: "init"; cfg: Config["pose"]; modelPath: string; wasmPath: string };
type Frame = { type: "frame"; bitmap: ImageBitmap; ts: number; epoch: number };
self.onmessage = async ({ data: d }: MessageEvent<Init | Frame>) => {
  if (d.type === "init") {
    try {
      const fileset = await FilesetResolver.forVisionTasks(d.wasmPath, true);
      for (const delegate of d.cfg.delegate === "GPU" ? ["GPU", "CPU"] as const : ["CPU"] as const) {
        try {
          landmarker = await PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: d.modelPath, delegate }, runningMode: "VIDEO",
            numPoses: d.cfg.numPoses, minPoseDetectionConfidence: d.cfg.minDetectionConfidence,
            minPosePresenceConfidence: d.cfg.minPresenceConfidence,
            minTrackingConfidence: d.cfg.minTrackingConfidence, outputSegmentationMasks: false,
          });
          self.postMessage({ type: "ready", delegate }); return;
        } catch (e) { if (delegate === "CPU") throw e; }
      }
    } catch (e) { self.postMessage({ type: "error", message: String(e) }); }
    return;
  }
  const start = performance.now();
  try {
    const res = landmarker!.detectForVideo(d.bitmap, d.ts);
    const poses = res.worldLandmarks.map((world, i) => {
      const lm = res.landmarks[i];
      return {
        world: world.map(p => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 0 })),
        image: lm.map(p => ({ x: p.x, y: p.y })), imageAspect: d.bitmap.width / d.bitmap.height,
        nose: { x: lm[0].x, y: lm[0].y },
        shoulderW: Math.hypot(lm[11].x - lm[12].x, lm[11].y - lm[12].y),
      };
    });
    self.postMessage({ type: "result", poses, ts: d.ts, epoch: d.epoch, inferenceMs: performance.now() - start });
  } catch {
    self.postMessage({ type: "result", poses: null, ts: d.ts, epoch: d.epoch });
  } finally { d.bitmap.close(); }
};
