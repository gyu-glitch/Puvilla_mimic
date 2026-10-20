import type { Config } from "./config";
import { log } from "./logger";

/** 현재 열린 스트림 — 페이지를 닫거나 새로고침할 때 확실히 놓아 준다 (안 놓으면 다음 로드에서 NotReadableError) */
let current: MediaStream | null = null;
const imageRetryTimers = new Set<ReturnType<typeof setTimeout>>();
const imageRequests = new WeakMap<MediaStreamTrack, Promise<void>>();
const release = () => {
  for (const timer of imageRetryTimers) clearTimeout(timer);
  imageRetryTimers.clear();
  current?.getTracks().forEach((t) => t.stop());
  current = null;
};
window.addEventListener("pagehide", release);
window.addEventListener("beforeunload", release);
// Vite 개발 서버 HMR 로 모듈이 교체될 때도 놓아 줌
if (import.meta.hot) import.meta.hot.dispose(release);

/** 지금 열린 카메라 영상 트랙 (노출 슬라이더용) */
export function currentVideoTrack(): MediaStreamTrack | null {
  return current?.getVideoTracks()[0] ?? null;
}

/** 자동노출은 항상 명시적으로 적용. 기기별 수치는 사용자가 저장한 경우에만 적용한다. */
export async function applyImageSettings(cfg: Config["camera"]): Promise<void> {
  const track = currentVideoTrack();
  if (!track?.getCapabilities) return;
  const settings = { ...cfg };
  const isActive = () => track === currentVideoTrack() && track.readyState !== "ended";
  // UI changes and driver warm-up retries must reach this track in request order.
  const request = (imageRequests.get(track) ?? Promise.resolve()).then(async () => {
    if (!isActive()) return;
    try {
      const caps = track.getCapabilities() as Record<string, unknown>;
      const modes = Array.isArray(caps.exposureMode) ? caps.exposureMode : [];
      const manual = settings.applyImageSettings && !settings.autoExposure &&
        modes.includes("manual") && !!caps.exposureTime;
      const mode = manual ? "manual" : modes.includes("continuous") ? "continuous" : null;
      // Keep mode separate: an unsupported saved brightness must not cancel auto exposure.
      if (mode) await track.applyConstraints({
        advanced: [{ exposureMode: mode } as MediaTrackConstraintSet],
      });
      if (!isActive() || !settings.applyImageSettings) return;
      const adv: Record<string, unknown> = {};
      if (manual) adv.exposureTime = settings.exposureTime;
      if (caps.exposureCompensation && mode === "continuous") adv.exposureCompensation = settings.exposureCompensation;
      if (caps.brightness) adv.brightness = settings.brightness;
      if (caps.contrast) adv.contrast = settings.contrast;
      if (Object.keys(adv).length) await track.applyConstraints({ advanced: [adv as MediaTrackConstraintSet] });
    } catch (e) {
      log.warn("camera", `노출 설정 적용 실패: ${String(e)}`);
    }
  });
  imageRequests.set(track, request);
  await request;
}

/** 사람이 읽을 수 있는 원인 설명 */
export function describeCameraError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? "";
  if (name === "NotReadableError" || name === "TrackStartError")
    return "카메라를 다른 곳에서 쓰고 있습니다 — 이 페이지가 열린 다른 탭/창, Zoom·Teams·카메라 앱 등을 닫으면 자동으로 다시 연결합니다";
  if (name === "NotAllowedError") return "카메라 권한이 거부됐습니다 — 주소창 왼쪽 자물쇠 아이콘에서 카메라 '허용' 후 새로고침";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "카메라를 찾지 못했습니다 — 연결 확인";
  return String(e);
}

/**
 * 웹캠 열기. deviceLabelIncludes 가 있으면 라벨 부분일치로 장치를 고정한다
 * (USB 포트가 바뀌어 deviceId 가 달라져도 같은 카메라를 잡기 위해).
 * 장치가 바쁘면(NotReadableError) 해상도 조건을 낮춰 가며 몇 초 간격으로 다시 시도한다.
 */
export async function openCamera(
  video: HTMLVideoElement,
  cfg: Config["camera"],
  onRetry?: (attempt: number, err: unknown) => void,
): Promise<MediaStream> {
  release();
  let deviceId: string | undefined;
  if (cfg.deviceLabelIncludes) {
    try {
      // 라벨을 읽으려면 한 번 권한이 있어야 한다. 먼저 아무 카메라나 열고 라벨을 조회.
      const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      probe.getTracks().forEach((t) => t.stop());
    } catch {
      /* 아래 본 요청에서 다시 처리 */
    }
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    const hit = devs.find((d) => d.label.toLowerCase().includes(cfg.deviceLabelIncludes.toLowerCase()));
    if (hit) deviceId = hit.deviceId;
    else log.warn("camera", `라벨 '${cfg.deviceLabelIncludes}' 매칭 실패, 기본 카메라 사용. 목록: ${devs.map((d) => d.label).join(" | ")}`);
  }

  const dev = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" };
  // 시도 순서: 설정 해상도 → 720p 이하 아무거나 → 조건 없음
  const tries: MediaTrackConstraints[] = [
    { ...dev, width: { ideal: cfg.width }, height: { ideal: cfg.height }, frameRate: { ideal: cfg.frameRate } },
    { ...dev, width: { max: 1280 }, height: { max: 720 } },
    deviceId ? { deviceId: { exact: deviceId } } : {},
  ];

  let stream: MediaStream | null = null;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 30 && !stream; attempt++) {
    const c = tries[Math.min(attempt, tries.length - 1)];
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: c });
    } catch (e) {
      lastErr = e;
      const name = (e as { name?: string })?.name;
      log.warn("camera", `열기 실패 #${attempt + 1} ${name}: ${(e as Error)?.message ?? e}`);
      if (name === "NotAllowedError") break; // 권한 거부는 재시도해도 소용없음
      onRetry?.(attempt + 1, e);
      await new Promise((r) => setTimeout(r, attempt < 3 ? 800 : 2000));
    }
  }
  if (!stream) throw lastErr ?? new Error("camera open failed");
  current = stream;

  video.srcObject = stream;
  await new Promise<void>((resolve) => {
    if (video.readyState >= 2) resolve();
    else video.onloadedmetadata = () => resolve();
  });
  await video.play();
  const s = stream.getVideoTracks()[0]?.getSettings();
  log.info("camera", `open ${s?.width}x${s?.height}@${s?.frameRate} label="${stream.getVideoTracks()[0]?.label}"`);
  // 막 켜진 직후엔 드라이버가 노출 설정을 무시하는 일이 있어(Windows) 조금 뒤 몇 번 더 적용
  await applyImageSettings(cfg);
  for (const ms of [500, 1500, 3000]) {
    const timer = setTimeout(() => {
      imageRetryTimers.delete(timer);
      if (current === stream) void applyImageSettings(cfg);
    }, ms);
    imageRetryTimers.add(timer);
  }

  // 케이블이 빠지는 등 트랙이 끝나면 상위에서 복구하도록 이벤트를 띄운다
  stream.getVideoTracks()[0]?.addEventListener("ended", () => {
    log.error("camera", "video track ended");
    window.dispatchEvent(new CustomEvent("mimic:camera-lost"));
  });
  return stream;
}
