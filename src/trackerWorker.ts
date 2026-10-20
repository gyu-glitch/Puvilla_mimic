/// <reference lib="webworker" />
/**
 * 얼굴 인식(MediaPipe FaceLandmarker) 전용 워커 — 렌더 스레드와 병렬로 다른 CPU 코어에서 돈다.
 * 메인: createImageBitmap(video) → {type:"frame"} 전송 / 워커: 추론 → RawFace[] 회신 (영상은 저장·전송하지 않음, 같은 기기 안에서만)
 */
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { toRawFaces } from "./tracker";

declare const self: DedicatedWorkerGlobalScope;
let landmarker: FaceLandmarker | null = null;
let transpose = false;

type InitMsg = {
  type: "init";
  wasmPath: string;
  modelPath: string;
  delegate: "GPU" | "CPU";
  transpose: boolean;
  options: Record<string, unknown>;
};
type FrameMsg = { type: "frame"; bitmap: ImageBitmap; ts: number };

self.onmessage = async (e: MessageEvent<InitMsg | FrameMsg>) => {
  const d = e.data;
  if (d.type === "init") {
    transpose = d.transpose;
    // 모듈 워커에선 importScripts 가 안 돼서 wasm 로더도 ES 모듈 판으로
    const fileset = await FilesetResolver.forVisionTasks(d.wasmPath, true);
    for (const delegate of d.delegate === "GPU" ? (["GPU", "CPU"] as const) : (["CPU"] as const)) {
      try {
        landmarker = await FaceLandmarker.createFromOptions(fileset, { ...d.options, baseOptions: { modelAssetPath: d.modelPath, delegate } });
        self.postMessage({ type: "ready", delegate });
        return;
      } catch (err) {
        self.postMessage({ type: "log", msg: `워커 ${delegate} 초기화 실패: ${String(err).split("\n")[0]}` });
      }
    }
    self.postMessage({ type: "error", msg: "워커에서 FaceLandmarker 초기화 실패" });
    return;
  }
  if (d.type === "frame") {
    const t0 = performance.now();
    try {
      if (!landmarker) throw new Error("not ready");
      const res = landmarker.detectForVideo(d.bitmap, d.ts);
      const faces = toRawFaces(res, d.bitmap.width, d.bitmap.height, transpose);
      self.postMessage({ type: "result", faces, inferenceMs: performance.now() - t0 });
    } catch (err) {
      self.postMessage({ type: "result", faces: null, inferenceMs: 0, msg: String(err) });
    } finally {
      d.bitmap.close();
    }
  }
};
