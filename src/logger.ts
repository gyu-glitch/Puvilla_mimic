/**
 * 콘솔 + 링버퍼 로거. 현장에서 window.__mimic.logs 로 최근 로그를 꺼내 볼 수 있다.
 * 상태 전이·센서 이상·복구 이벤트는 반드시 여기로 남긴다.
 */
export type LogLevel = "info" | "warn" | "error";
export interface LogEntry { t: number; level: LogLevel; tag: string; msg: string }

const RING = 500;
const buf: LogEntry[] = [];

function push(level: LogLevel, tag: string, msg: string) {
  const e = { t: Date.now(), level, tag, msg };
  buf.push(e);
  if (buf.length > RING) buf.shift();
  const line = `[${new Date(e.t).toISOString().slice(11, 23)}] [${tag}] ${msg}`;
  (level === "error" ? console.error : level === "warn" ? console.warn : console.info)(line);
}

export const log = {
  info: (tag: string, msg: string) => push("info", tag, msg),
  warn: (tag: string, msg: string) => push("warn", tag, msg),
  error: (tag: string, msg: string) => push("error", tag, msg),
  entries: () => buf.slice(),
};
