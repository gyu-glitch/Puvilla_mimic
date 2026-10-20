import type { Config } from "./config";
import { log } from "./logger";

/** `?kiosk=1` 이면 키오스크 모드: 오버레이 숨김, 커서 숨김, 절전 방지, 치명 오류 시 자동 재시작 */
export function isKiosk(): boolean {
  return new URLSearchParams(location.search).get("kiosk") === "1";
}

export async function setupKiosk(cfg: Config["kiosk"]): Promise<void> {
  document.body.classList.add("kiosk");
  if (!cfg.hideCursor) document.body.style.cursor = "auto";

  if (cfg.wakeLock && "wakeLock" in navigator) {
    const req = async () => {
      try {
        await (navigator as Navigator & { wakeLock: { request(t: "screen"): Promise<unknown> } }).wakeLock.request("screen");
        log.info("kiosk", "wakeLock acquired");
      } catch (e) {
        log.warn("kiosk", `wakeLock 실패: ${String(e)}`);
      }
    };
    await req();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void req();
    });
  }
}

/** 복구 불가 상황 → N초 후 새로고침 (watchdog 는 OS 레벨에서 별도) */
export function scheduleFatalReload(cfg: Config["kiosk"], reason: string): void {
  log.error("kiosk", `fatal: ${reason} → ${cfg.reloadOnFatalMs}ms 후 reload`);
  if (!isKiosk()) return; // 개발 중엔 리로드하지 않고 로그만
  setTimeout(() => location.reload(), cfg.reloadOnFatalMs);
}

/** 중앙 헬스체크(선택). healthPostUrl 이 비어 있으면 아무것도 안 함. */
export function startHealthBeat(cfg: Config["kiosk"], getPayload: () => Record<string, unknown>): void {
  if (!cfg.healthPostUrl) return;
  setInterval(() => {
    fetch(cfg.healthPostUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app: "pubilla-mimic", t: Date.now(), ...getPayload() }),
      keepalive: true,
    }).catch(() => {/* 네트워크 없을 수 있음 — 조용히 */});
  }, cfg.healthIntervalMs);
}
