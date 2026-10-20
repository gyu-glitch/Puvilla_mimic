/**
 * 개발용 표정 테스트: t 키 → 화면 안내에 따라 표정을 하면 그 구간에 정답 라벨이 붙어 .trace/trace.jsonl 에 기록된다.
 * 실제 웹캠에서 눈·입 판정 문턱을 정답 기준으로 맞추기 위한 것 (영상은 기록하지 않음, 수치만).
 */
interface Step {
  label: string;
  text: string;
}

const STEPS: Step[] = [
  { label: "neutral", text: "무표정 (정면 보기)" },
  { label: "smileBig", text: "활짝 웃기 (이 보이게)" },
  { label: "smileSoft", text: "입 다물고 살짝 미소" },
  { label: "sulk", text: "시무룩 (입꼬리 내리기)" },
  { label: "pout", text: "입술 앞으로 내밀기 (뾰로통)" },
  { label: "openA", text: "입 크게 벌리기 '아'" },
  { label: "openO", text: "입 동그랗게 '오'" },
  { label: "talk", text: "아무 말이나 계속 하기" },
  { label: "winkSelfL", text: "본인 왼쪽 눈만 감고 유지" },
  { label: "winkSelfR", text: "본인 오른쪽 눈만 감고 유지" },
  { label: "closeBoth", text: "두 눈 다 감고 유지" },
  { label: "blink", text: "평소처럼 눈 깜빡이기" },
  { label: "neutralDown", text: "무표정 + 고개 살짝 숙이기" },
  { label: "neutralTurn", text: "무표정 + 고개 천천히 좌우로" },
];
const PREP_MS = 1500;
const HOLD_MS = 4000;

export class ExpressionTest {
  private el: HTMLDivElement;
  private startMs = 0;
  private running = false;
  /** 지금 기록 중인 정답 라벨 (준비 구간·꺼짐 = null) */
  label: string | null = null;

  constructor() {
    this.el = document.createElement("div");
    this.el.style.cssText =
      "position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:20;padding:14px 22px;border-radius:12px;" +
      "background:rgba(0,0,0,.72);color:#fff;font:600 26px system-ui;text-align:center;display:none;pointer-events:none";
    document.body.appendChild(this.el);
    window.addEventListener("keydown", (e) => {
      if (e.key === "t" || e.key === "T") this.toggle();
    });
  }

  private toggle(): void {
    this.running = !this.running;
    this.startMs = performance.now();
    this.label = null;
    this.el.style.display = this.running ? "block" : "none";
  }

  update(now: number): void {
    if (!this.running) return;
    const t = now - this.startMs;
    const per = PREP_MS + HOLD_MS;
    const i = Math.floor(t / per);
    if (i >= STEPS.length) {
      this.label = null;
      this.el.innerHTML = "테스트 끝 — 기록 저장됨<br><span style='font-size:15px;opacity:.7'>t 키로 닫기</span>";
      return;
    }
    const inStep = t - i * per;
    const s = STEPS[i];
    const prep = inStep < PREP_MS;
    this.label = prep ? null : s.label;
    const left = prep ? "준비…" : `${Math.ceil((per - inStep) / 1000)}초`;
    this.el.innerHTML =
      `<span style="font-size:15px;opacity:.7">${i + 1}/${STEPS.length}</span><br>${s.text}<br>` +
      `<span style="font-size:18px;color:${prep ? "#ffd166" : "#7bed9f"}">${left}</span>`;
  }
}
