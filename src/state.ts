import type { Config } from "./config";
import type { FaceSignal } from "./signals";
import { log } from "./logger";

/**
 * 체험 상태머신 (공통 골격: IDLE → ATTRACT → ACTIVE → REACT → COOLDOWN → IDLE 을 미믹에 맞춰 구체화)
 *
 * IDLE    : 아무도 없음. 캐릭터 숨김(또는 프레임만).
 * ATTRACT : IDLE 이 attractAfterMs 지속 → 캐릭터가 빼꼼/손짓하며 유도.
 * ENTER   : 가까이 온 사람 감지 → 캐릭터 등장 연출 (enterDurationMs).
 * MIMIC   : 고개·표정 따라하기. 메인.
 * EXIT    : 사람이 멀어지거나 사라져 exitHoldMs 경과 → 손 흔들고 퇴장 (exitDurationMs).
 */
export type State = "IDLE" | "ATTRACT" | "ENTER" | "MIMIC" | "EXIT";

export interface StateSnapshot {
  state: State;
  /** 현재 상태 진입 후 경과 ms */
  elapsedMs: number;
  /** ENTER/EXIT 진행률 0~1 */
  progress: number;
}

export class MimicStateMachine {
  private state: State = "IDLE";
  private enteredAt = 0;
  private awayAt: number | null = null; // near=false 가 된 시점
  private listeners: Array<(from: State, to: State) => void> = [];

  constructor(private cfg: Config) {}

  onTransition(fn: (from: State, to: State) => void): void {
    this.listeners.push(fn);
  }

  get current(): State {
    return this.state;
  }

  private go(to: State, nowMs: number): void {
    const from = this.state;
    if (from === to) return;
    this.state = to;
    this.enteredAt = nowMs;
    log.info("state", `${from} → ${to}`);
    for (const l of this.listeners) l(from, to);
  }

  update(sig: FaceSignal, nowMs: number): StateSnapshot {
    const p = this.cfg.presence;
    const c = this.cfg.character;
    const elapsed = nowMs - this.enteredAt;

    // 멀어짐 타이머 — MIMIC 중에만 의미 있음
    if (sig.present && sig.near) this.awayAt = null;
    else if (this.awayAt === null) this.awayAt = nowMs;

    switch (this.state) {
      case "IDLE":
        if (sig.present && sig.near) this.go("ENTER", nowMs);
        else if (elapsed >= p.attractAfterMs) this.go("ATTRACT", nowMs);
        break;
      case "ATTRACT":
        if (sig.present && sig.near) this.go("ENTER", nowMs);
        break;
      case "ENTER":
        if (elapsed >= c.enterDurationMs) this.go("MIMIC", nowMs);
        break;
      case "MIMIC":
        if (this.awayAt !== null && nowMs - this.awayAt >= p.exitHoldMs) this.go("EXIT", nowMs);
        break;
      case "EXIT":
        // 퇴장 중 다시 다가오면 바로 복귀 (반복 재미)
        if (sig.present && sig.near) this.go("ENTER", nowMs);
        else if (elapsed >= c.exitDurationMs) this.go("IDLE", nowMs);
        break;
    }

    const e2 = nowMs - this.enteredAt;
    const progress =
      this.state === "ENTER" ? Math.min(1, e2 / c.enterDurationMs)
      : this.state === "EXIT" ? Math.min(1, e2 / c.exitDurationMs)
      : 0;
    return { state: this.state, elapsedMs: e2, progress };
  }
}
