import GUI from "lil-gui";
import { downloadConfig, saveConfig, type Config } from "./config";
import type { FaceSignal } from "./signals";
import type { StateSnapshot } from "./state";
import type { BodyPose } from "./body";

export interface OverlayStats {
  renderFps: number;
  inferFps: number;
  inferenceMs: number;
  poseMs: number;
  body: BodyPose | null;
  modelSource: string;
  sig: FaceSignal;
  snap: StateSnapshot;
  /** 'o' 전환 기준 (입술 간격, 입 폭 대비) */
  mouthOpenFrom: number;
}

const STATE_KO: Record<string, string> = {
  IDLE: "대기(아무도 없음)",
  ATTRACT: "유도(빼꼼·손짓)",
  ENTER: "등장",
  MIMIC: "따라하기",
  EXIT: "퇴장",
};

/**
 * 개발용 튜닝 오버레이. `d` 키로 토글. 값은 config 객체를 직접 바꾸므로 즉시 반영된다.
 * '저장' 은 config.json 을 다운로드 → public/config.json 에 덮어쓰면 다음 실행부터 적용.
 * 라벨 = "설명 (단위)", 괄호 안 영문은 config.json 키 이름.
 */
export class Overlay {
  private gui: GUI;
  private statsEl: HTMLElement;
  private visible = true;

  constructor(private cfg: Config, hooks: { onSmoothingChange: () => void; onCharacterChange: () => void; onSceneChange: () => void; onFaceNeutral?: () => void }) {
    this.statsEl = document.getElementById("stats")!;
    this.gui = new GUI({ title: `푸빌라 미믹 튜닝  (d: 숨기기) · 버전 ${cfg.build}`, width: 360 });
    const onC = hooks.onCharacterChange;

    const f1 = this.gui.addFolder("접근 판정 — 언제 등장/퇴장할지");
    f1.add(cfg.presence, "mimicOnLock").name("락온되면 바로 따라하기 (거리 제한 해제)");
    f1.add(cfg.presence, "enterBboxHeight", 0.05, 0.6, 0.005)
      .name("등장: 얼굴 크기 ≥ (입력 짧은 변 비율)");
    f1.add(cfg.presence, "exitBboxHeight", 0.03, 0.5, 0.005)
      .name("멀어짐: 얼굴 크기 ≤ (입력 짧은 변 비율)");
    f1.add(cfg.presence, "centerToleranceX", 0.05, 0.5, 0.01)
      .name("중앙 인정 범위 (화면 폭 비율, ±)");
    f1.add(cfg.presence, "faceLostHoldMs", 0, 3000, 50)
      .name("얼굴 놓쳐도 유지 (ms)");
    f1.add(cfg.presence, "exitHoldMs", 0, 6000, 100)
      .name("멀어진 뒤 퇴장까지 (ms)");
    f1.add(cfg.presence, "attractAfterMs", 1000, 60000, 500)
      .name("아무도 없을 때 유도 시작 (ms)");
    f1.add(cfg.presence, "lockCenterWeight", 0, 1, 0.05)
      .name("거리 제한 모드: 가운데 우선 정도");
    const hint = document.createElement("div");
    hint.style.cssText = "padding:4px 8px 8px;font-size:11px;line-height:1.4;color:#9aa0ad";
    hint.textContent = "기본은 노란 영역 안에서 가장 큰 얼굴을 잡아 바로 따라한다. 잡은 사람은 크기가 조금 변해도 유지하고, 놓치면 다시 선택한다. '락온되면 바로 따라하기'를 끄면 얼굴 크기·중앙 범위·가운데 우선 조건을 추가로 적용한다. 노란 박스를 끌어 락온 영역을 옮기거나 크기를 바꿀 수 있다.";
    f1.$children.appendChild(hint);

    const f2 = this.gui.addFolder("고개·표정 매핑 — 얼마나 크게 따라할지");
    f2.add(cfg.mapping, "autoNeutral").name("카메라 각도·뜬 눈 자동 기준").onChange(() => hooks.onFaceNeutral?.());
    f2.add({ calibrate: () => hooks.onFaceNeutral?.() }, "calibrate").name("화면 보고 눈 뜬 상태로 기준 다시 맞춤");
    const neutralHint = document.createElement("div");
    neutralHint.style.cssText = "padding:4px 8px;font-size:11px;line-height:1.5;color:#b9c2d0";
    neutralHint.textContent = "처음 잡힌 사람이 화면을 보고 눈을 뜬 채 약 1초 멈추면 고개·눈 기준을 맞춥니다. 이후 고개 숙이기와 깜빡임은 그대로 따라갑니다. 처음 자세가 잘못 잡혔으면 위 버튼으로 다시 맞추세요.";
    f2.$children.appendChild(neutralHint);
    f2.add(cfg.mapping, "yawGain", 0, 3, 0.05).name("좌우 고개 배율 (×)");
    f2.add(cfg.mapping, "pitchGain", 0, 3, 0.05).name("상하 고개 배율 (×)");
    f2.add(cfg.mapping, "rollGain", 0, 3, 0.05).name("갸웃 배율 (×)");
    f2.add(cfg.mapping, "headDeadzoneDeg", 0, 8, 0.1).name("고개 무시 범위 (°)");
    f2.add(cfg.mapping, "yawClampDeg", 10, 80, 1).name("좌우 최대 (°)");
    f2.add(cfg.mapping, "pitchClampDeg", 10, 60, 1).name("상하 최대 (°)");
    f2.add(cfg.mapping, "rollClampDeg", 5, 45, 1).name("갸웃 최대 (°)");
    f2.add(cfg.mapping, "smileGain", 0, 3, 0.05).name("웃음 배율 (×)");
    f2.add(cfg.mapping, "cornerSmileGain", 0, 30, 0.5).name("입꼬리↑ 웃음 배율 (×)");
    f2.add(cfg.mapping, "cornerFrownGain", 0, 40, 0.5).name("입꼬리↓ 시무룩 배율 (×)");
    f2.add(cfg.mapping, "mouthOpenGeoFrom", 0, 0.5, 0.01).name("입 벌림 시작 (입술간격, 입폭 대비)");
    f2.add(cfg.mapping, "mouthOpenGeoRange", 0.05, 1, 0.01).name("입 벌림 최대까지 폭");
    f2.add(cfg.mapping, "frownGain", 0, 8, 0.1).name("시무룩 배율 (×, 보조)");
    f2.add(cfg.mapping, "puckerDeadzone", 0, 0.9, 0.01).name("오므림 무시 범위 (0~1)");
    f2.add(cfg.mapping, "mouthBaselineSec", 2, 30, 1).name("입 무표정 기준 학습 (초)");
    f2.add(cfg.mapping, "jawGain", 0, 3, 0.05).name("입 벌림 배율 (×)");
    f2.add(cfg.mapping, "browGain", 0, 3, 0.05).name("눈썹 배율 (×)");
    f2.add(cfg.mapping, "blinkThreshold", 0.1, 0.95, 0.01).name("눈 감음 판정 (0~1, 낮을수록 잘 감음)");
    f2.add(cfg.mapping, "blinkOpenBelow", 0.05, 0.9, 0.01).name("눈 다시 뜸 판정 (0~1, 감음 판정보다 낮게)");
    f2.add(cfg.mapping, "blendDeadzone", 0, 0.3, 0.01).name("표정 무시 범위 (0~1)");
    f2.close();

    const f8 = this.gui.addFolder("상반신 — 몸통·팔 따라하기");
    f8.add(cfg.body, "enabled").name("상반신 미믹 켜기");
    f8.add(cfg.body, "torsoYawGain", 0, 2, 0.05).name("몸 비틀기 배율 (×)");
    f8.add(cfg.body, "torsoRollGain", 0, 2, 0.05).name("몸 옆으로 기울기 배율 (×)");
    f8.add(cfg.body, "torsoPitchGain", 0, 2, 0.05).name("몸 앞뒤 숙이기 배율 (×)");
    f8.add(cfg.body, "torsoYawClampDeg", 0, 60, 1).name("비틀기 최대 (°)");
    f8.add(cfg.body, "torsoRollClampDeg", 0, 45, 1).name("옆 기울기 최대 (°)");
    f8.add(cfg.body, "torsoPitchClampDeg", 0, 45, 1).name("앞뒤 숙이기 최대 (°)");
    f8.add(cfg.body, "elbowGain", 0, 2, 0.05).name("팔꿈치 굽힘 배율 (×)");
    f8.add(cfg.body, "armRaiseMaxRad", 1, 3, 0.05).name("팔 드는 최대 각 (rad, 아래=0)");
    f8.add(cfg.body, "minVisibility", 0, 1, 0.05).name("관절 신뢰도 최소 (0~1)");
    f8.add(cfg.body, "lostHoldMs", 0, 3000, 50).name("몸 놓쳐도 유지 (ms)");
    f8.add(cfg.body, "minCutoff", 0.1, 5, 0.05).name("팔 부드러움 (작을수록 부드럽고 느림)").onChange(hooks.onSmoothingChange);
    f8.add(cfg.body, "beta", 0, 2, 0.01).name("팔 빠른 동작 반응 (클수록 빠름)").onChange(hooks.onSmoothingChange);
    f8.add(cfg.body, "responsiveArms").name("큰 팔 동작 빠르게 따라가기");
    f8.close();

    const f8b = this.gui.addFolder("자유 팔 (생성 A포즈 몸) — 쉬는 자세·인사");
    f8b.add(cfg.character, "freeArmIdleTheta", 0, 1.5, 0.01).name("쉴 때 팔 벌림 (rad, 아래=0)");
    f8b.add(cfg.character, "freeArmIdlePhi", -0.5, 1.5, 0.01).name("쉴 때 팔 앞으로 (rad)");
    f8b.add(cfg.character, "freeArmIdleElbow", -0.5, 1.5, 0.01).name("쉴 때 팔꿈치 굽힘 (rad)");
    f8b.add(cfg.character, "freeArmWaveTheta", 0.5, 3.0, 0.01).name("인사 팔 들기 (rad, 아래=0)");
    f8b.add(cfg.character, "freeArmWavePhi", -0.5, 1.5, 0.01).name("인사 팔 앞으로 (rad)");
    f8b.add(cfg.character, "freeArmWaveElbow", -1.5, 1.5, 0.01).name("인사 팔꿈치 굽힘 (rad)");
    f8b.add(cfg.character, "freeArmWaveSwing", 0, 1, 0.01).name("인사 까딱 폭 (rad)");
    f8b.add(cfg.character, "freeArmWaveHz", 0.2, 4, 0.05).name("인사 까딱 속도 (회/초)");
    f8b.add(cfg.character, "freeArmRaiseMaxRad", 1, 3.1, 0.05).name("미믹 팔 드는 최대 (rad)");
    f8b.close();

    const f3 = this.gui.addFolder("떨림 보정 — 부드러움 vs 반응속도");
    f3.add(cfg.smoothing, "headMinCutoff", 0.1, 5, 0.05).name("고개 부드러움 (작을수록 부드럽고 느림)").onChange(hooks.onSmoothingChange);
    f3.add(cfg.smoothing, "headBeta", 0, 1, 0.005).name("고개 빠른 동작 반응 (클수록 빠름)").onChange(hooks.onSmoothingChange);
    f3.add(cfg.smoothing, "blendMinCutoff", 0.1, 5, 0.05).name("표정 부드러움").onChange(hooks.onSmoothingChange);
    f3.add(cfg.smoothing, "blendBeta", 0, 1, 0.005).name("표정 빠른 변화 반응").onChange(hooks.onSmoothingChange);
    f3.add(cfg.smoothing, "blinkMinCutoff", 0.5, 15, 0.5).name("눈 깜빡임 반응 (클수록 빠름)").onChange(hooks.onSmoothingChange);
    f3.close();

    const f4 = this.gui.addFolder("표정 판정 (로그·리액션용)");
    f4.add(cfg.expression, "smileThreshold", 0.1, 0.9, 0.01).name("웃음 판정 (0~1)");
    f4.add(cfg.expression, "surpriseJaw", 0.1, 0.9, 0.01).name("놀람: 입 벌림 ≥ (0~1)");
    f4.add(cfg.expression, "surpriseBrow", 0.1, 0.9, 0.01).name("놀람: 눈썹 ≥ (0~1)");
    f4.add(cfg.expression, "dwellMs", 0, 1000, 10).name("표정 유지 시간 (ms)");
    f4.close();

    const f6 = this.gui.addFolder("푸빌라 얼굴");
    f6.add(cfg.face, "mouthLineCm", 0.1, 1.2, 0.02).name("입선 굵기 (cm)");
    f6.add(cfg.face, "mouthHalfW", 1, 6, 0.1).name("입선 폭 (반폭 cm)");
    f6.add(cfg.face, "mouthRestCurve", -0.1, 0.2, 0.005).name("무표정 입선 휨 (+ 끝 올라감)");
    f6.add(cfg.face, "smileCurve", 0, 0.25, 0.005).name("웃을 때 휨 (‿)");
    f6.add(cfg.face, "frownWidth", 0.3, 1, 0.01).name("시무룩 입 폭 (무표정 대비 ×)");
    f6.add(cfg.face, "frownArcCm", 0, 2, 0.05).name("시무룩 입 둥글기 (︵ 높이, cm)");
    f6.add(cfg.face, "mouthOpenFrom", 0, 0.6, 0.01).name("이 이상 벌리면 'o' 입 (0~1)");
    f6.add(cfg.face, "mouthOHalfW", 0.3, 2.5, 0.05).name("'o' 입 반폭 (cm)");
    f6.add(cfg.face, "mouthOHalfH", 0.3, 3, 0.05).name("'o' 입 반높이 (cm)");
    f6.add(cfg.face, "closedEyeHalfW", 0.5, 4, 0.05).name("감은 눈 곡선 폭 (cm)");
    f6.add(cfg.face, "closedEyeCurve", -0.4, 0.4, 0.01).name("감은 눈 휨 (+ = ‿)");
    f6.add(cfg.face, "closedEyeDrop", -1.5, 1.5, 0.05).name("감은 눈 높이 (아래로 cm)");
    f6.add(cfg.face, "closedEyeLineCm", 0.1, 1.2, 0.02).name("감은 눈 굵기 (cm)");
    f6.add(cfg.face, "eyeScale", 0.3, 1.2, 0.01).name("눈알 크기 (×, 재시작)");
    f6.add(cfg.face, "eyePushCm", -1, 2, 0.05).name("눈 돌출 (cm, 재시작)");
    f6.add(cfg.face, "blushStrength", 0, 1, 0.05).name("볼터치 세기 (0 = 끔)");
    f6.add(cfg.face, "blushGrinFrom", 0, 1, 0.01).name("볼터치 시작 웃음 (0~1, 높을수록 활짝 웃어야)");
    f6.add(cfg.face, "blushGrinFull", 0, 1, 0.01).name("볼터치 최대 웃음 (0~1)");
    f6.add(cfg.face, "blushX", 5, 25, 0.1).name("볼터치 좌우 위치 (cm)").onChange(onC);
    f6.add(cfg.face, "blushY", 130, 155, 0.1).name("볼터치 높이 (cm)").onChange(onC);
    f6.add(cfg.face, "blushR", 1, 8, 0.1).name("볼터치 크기 (cm)").onChange(onC);
    f6.addColor(cfg.face, "blushColor").name("볼터치 색").onChange(onC);
    f6.add(cfg.face, "browEnabled").name("눈썹 획 (가이드 3D 엔 없음)");
    f6.add(cfg.face, "browOffsetY", 2, 10, 0.1).name("눈썹 높이 (눈 위 cm)").onChange(onC);
    f6.add(cfg.face, "lineCm", 0.2, 2, 0.05).name("눈썹 굵기 (cm)").onChange(onC);
    f6.add(cfg.face, "scarfStripes", 2, 60, 1).name("스카프 줄무늬 수").onChange(onC);
    f6.add(cfg.face, "scarfStripeAngle", -3.14, 3.14, 0.01).name("스카프 줄무늬 각도 (rad)").onChange(onC);
    f6.close();

    const f7 = this.gui.addFolder("푸빌라 털·화면 구도");
    f7.add(cfg.fur, "lengthCm", 0, 4, 0.05).name("털 길이 (cm)").onChange(onC);
    f7.add(cfg.fur, "freq", 1, 14, 0.1).name("털 가닥 촘촘함 (가닥/cm)").onChange(onC);
    f7.add(cfg.fur, "minDensity", 0, 0.9, 0.01).name("털 길이 들쭉날쭉 (0~0.9)").onChange(onC);
    f7.add(cfg.fur, "lean", 0, 1.5, 0.01).name("털 끝 눕기 (털 길이 대비)").onChange(onC);
    f7.add(cfg.fur, "thickness", 0.08, 0.6, 0.01).name("털 가닥 굵기 (가늘수록 결이 보임)").onChange(onC);
    f7.add(cfg.fur, "bumpCm", 0, 2, 0.01).name("털뭉치(몽글몽글) 입체감 (0 = 매끈)").onChange(onC);
    f7.add(cfg.fur, "tuftCm", 1, 10, 0.1).name("털뭉치 크기 (cm)").onChange(onC);
    f7.add(cfg.fur, "roughness", 0.3, 1, 0.01).name("털 광택 없음 정도 (1 = 무광)").onChange(onC);
    f7.add(cfg.fur, "rootShade", 0.3, 1, 0.01).name("털 뿌리 그늘 (작을수록 어둡게)").onChange(onC);
    f7.add(cfg.fur, "faceFurScale", 0, 1, 0.01).name("얼굴 털 길이 비율 (×)").onChange(onC);
    f7.add(cfg.fur, "shells", 0, 32, 1).name("털 층 수 (재시작, 성능 영향 큼)");
    f7.add(cfg.character, "modelScale", 0.01, 0.1, 0.001).name("캐릭터 크기").onChange(onC);
    f7.add(cfg.character, "focusYcm", 0, 170, 1).name("화면 중앙에 올 높이 (cm)").onChange(onC);
    f7.add(cfg.character, "bodyFollow", 0, 0.6, 0.01).name("몸 신호 없을 때 몸이 고개 따라감 (×)");
    f7.add(cfg.character, "enterDrop", 0, 15, 0.1).name("등장/퇴장 이동 거리");
    f7.add(cfg.character, "attractPeek", 0, 1, 0.01).name("유도 때 올라오는 정도 (0~1)");
    f7.add(cfg.character, "waveLiftRad", 0, 2, 0.01).name("손 흔들 때 팔 높이 (rad)");
    const onS = hooks.onSceneChange;
    const ff = this.gui.addFolder("그림 필터 (테스트)");
    ff.add(cfg.filter, "enabled").name("켜기 (왼쪽 아래 붓 버튼과 같음)").listen();
    ff.add(cfg.filter, "style", { "부드러운 털": "soft", "붓 터치": "brush" }).name("방식");
    ff.add(cfg.filter, "softColor", 0.03, 0.4, 0.01).name("부드러운 털: 섞는 색 차이 (작을수록 음영 보존)");
    ff.add(cfg.filter, "radiusPx", 1, 10, 0.5).name("필터 반경 (px, 클수록 몽글·무거움)");
    ff.add(cfg.filter, "hardness", 1, 30, 0.5).name("경계 보존 (클수록 윤곽 또렷)");
    ff.add(cfg.filter, "edgeSharpness", 1, 18, 0.5).name("덩어리 경계 날카로움");
    ff.add(cfg.filter, "edgeLo", 0, 0.6, 0.01).name("윤곽: 털 끝 지우는 투명도 (클수록 윤곽 짧고 또렷)");
    ff.add(cfg.filter, "edgeHi", 0.2, 1, 0.01).name("윤곽: 털로 채우는 투명도 (작을수록 또렷)");
    ff.add(cfg.filter, "sharpen", 0, 2, 0.05).name("마지막 선명화 (0 = 없음)");
    ff.add(cfg.filter, "posterLevels", 0, 12, 1).name("포스터 밝기 단계 (0 = 끔)");
    ff.open();
    const fv = this.gui.addFolder("화면 시점 — 직접 잡기");
    fv.add(cfg.scene, "layout", { 자동: "auto", 가로: "landscape", 세로: "portrait" }).name("화면 방향 (왼쪽 아래 버튼과 같음)").onChange(onS).listen();
    fv.add(cfg.scene, "viewCenterCm", 20, 220, 0.5).name("가로: 시점 높이 (cm)").onChange(onS).listen();
    fv.add(cfg.scene, "viewHeightCm", 25, 260, 0.5).name("가로: 줌 (보이는 높이 cm, 작을수록 확대)").onChange(onS).listen();
    fv.add(cfg.scene, "viewOffsetXcm", -80, 80, 0.5).name("가로: 좌우 이동 (cm)").onChange(onS).listen();
    fv.add(cfg.scene, "pViewCenterCm", 20, 220, 0.5).name("세로: 시점 높이 (cm)").onChange(onS).listen();
    fv.add(cfg.scene, "pViewHeightCm", 25, 260, 0.5).name("세로: 줌 (보이는 높이 cm)").onChange(onS).listen();
    fv.add(cfg.scene, "pViewOffsetXcm", -80, 80, 0.5).name("세로: 좌우 이동 (cm)").onChange(onS).listen();
    fv.add(cfg.scene, "cameraTiltDeg", -30, 30, 0.5).name("카메라 위아래 각 (°, −=내려다봄)").onChange(onS);
    fv.add(cfg.scene, "aspect", 1, 2.4, 0.01).name("화면 비율 (가로/세로, 16:9=1.78)").onChange(onS);
    fv.add({
      copy: () => {
        const r = (x: number) => Math.round(x * 10) / 10;
        const sc = cfg.scene;
        const v = { viewCenterCm: r(sc.viewCenterCm), viewHeightCm: r(sc.viewHeightCm), viewOffsetXcm: r(sc.viewOffsetXcm), pViewCenterCm: r(sc.pViewCenterCm), pViewHeightCm: r(sc.pViewHeightCm), pViewOffsetXcm: r(sc.pViewOffsetXcm), cameraTiltDeg: sc.cameraTiltDeg, aspect: +sc.aspect.toFixed(3) };
        const text = `푸빌라 시점 ${JSON.stringify(v)}`;
        navigator.clipboard?.writeText(text).then(
          () => this.toast("시점 값 복사됨 — 채팅에 붙여 넣으면 기본값으로 배포"),
          () => prompt("아래 값을 복사해 전달해 주세요", text),
        );
      },
    }, "copy").name("📋 시점 값 복사 (전달용)");
    fv.open();
    f7.add(cfg.scene, "exposure", 0.4, 1.6, 0.01).name("전체 밝기 (노출, ×)").onChange(onS);
    f7.add(cfg.scene, "keyLight", 0, 3, 0.01).name("조명: 주광 (오른쪽 위 앞)").onChange(onS);
    f7.add(cfg.scene, "fillLight", 0, 2, 0.01).name("조명: 보조광 (왼쪽 앞)").onChange(onS);
    f7.add(cfg.scene, "rimLight", 0, 2, 0.01).name("조명: 뒤 테두리").onChange(onS);
    f7.add(cfg.scene, "hemiLight", 0, 2, 0.01).name("조명: 주변광 (그림자 밝기)").onChange(onS);
    f7.add(cfg.scene, "envLight", 0, 1.5, 0.01).name("조명: 환경 반사").onChange(onS);
    f7.close();

    const f5 = this.gui.addFolder("카메라·트래커 (재시작 필요)");
    if (import.meta.env.DEV) f5.add(cfg.camera, "deviceLabelIncludes").name("카메라 이름 (빈칸=기본)");
    f5.add(cfg.camera, "mirror").name("거울 모드 (좌우 반전)");
    f5.add(cfg.tracker, "transposeMatrix").name("고개 축 뒤집힘 보정");
    f5.add(cfg.tracker, "delegate", ["GPU", "CPU"]).name("얼굴 추론 장치");
    f5.add(cfg.tracker, "inferenceEveryNFrames", 1, 4, 1).name("얼굴 추론 간격 (프레임)");
    f5.add(cfg.pose, "enabled").name("상반신 추적 사용");
    f5.add(cfg.pose, "everyNFrames", 1, 4, 1).name("상반신 추론 간격 (프레임)");
    f5.close();

    // 값을 바꾸면 자동 저장 (개발 서버: public/config.json 에 바로 기록 → 새로고침해도 유지)
    this.gui.onFinishChange(() => this.requestSave());
    this.gui.add({ save: () => this.save(true) }, "save").name("지금 저장 (config.json)");
    this.gui.add({ reload: () => location.reload() }, "reload").name("재시작");

    window.addEventListener("keydown", (e) => {
      if (e.key === "d" || e.key === "D") this.toggle();
    });
    // 기본은 숨김 — d 키 또는 오른쪽 위 ⚙ 버튼(폰·태블릿)으로 열기
    const btn = document.createElement("button");
    btn.id = "overlayToggle";
    btn.classList.add("view-control");
    btn.textContent = "⚙";
    btn.title = "튜닝 화면 열기/닫기 (d)";
    btn.style.cssText =
      "position:fixed;right:10px;top:10px;z-index:30;width:36px;height:36px;border-radius:18px;border:0;" +
      "background:rgba(0,0,0,.25);color:#fff;font:18px system-ui;cursor:pointer;opacity:.55";
    btn.onclick = () => this.toggle();
    document.body.appendChild(btn);
    this.visible = true;
    this.toggle();
  }

  private saveTimer = 0;
  private toastEl: HTMLDivElement | null = null;

  /** 연속 변경은 모아서 0.4초 뒤 한 번 저장 */
  requestSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.save(false), 400);
  }

  private async save(fallbackDownload: boolean): Promise<void> {
    const ok = await saveConfig(this.cfg);
    if (ok) this.toast("저장됨 — public/config.json (새로고침해도 유지)");
    else if (fallbackDownload) {
      downloadConfig(this.cfg);
      this.toast("서버 저장 불가 — config.json 을 다운로드했습니다. public/ 에 덮어쓰세요");
    } else this.toast("자동 저장 안 됨 (개발 서버가 아님) — '지금 저장'으로 다운로드");
  }

  private toast(msg: string): void {
    if (!this.toastEl) {
      this.toastEl = document.createElement("div");
      this.toastEl.style.cssText =
        "position:fixed;left:50%;top:14px;transform:translateX(-50%);background:rgba(0,0,0,.75);color:#fff;" +
        "font:13px system-ui;padding:8px 14px;border-radius:8px;z-index:20;transition:opacity .3s;pointer-events:none";
      document.body.appendChild(this.toastEl);
    }
    this.toastEl.textContent = msg;
    this.toastEl.style.opacity = "1";
    clearTimeout((this.toastEl as unknown as { _t: number })._t);
    (this.toastEl as unknown as { _t: number })._t = window.setTimeout(() => {
      if (this.toastEl) this.toastEl.style.opacity = "0";
    }, 1800);
  }

  toggle(): void {
    this.visible = !this.visible;
    document.body.classList.toggle("debug-hidden", !this.visible);
  }

  update(s: OverlayStats): void {
    if (!this.visible) return;
    const b = s.sig.blend;
    const top = Object.entries(b)
      .filter(([k]) => !k.startsWith("__"))
      .sort((a, c) => c[1] - a[1])
      .slice(0, 4)
      .map(([k, v]) => `${k}:${v.toFixed(2)}`)
      .join("  ");
    const body = s.body
      ? `팔 신뢰도 왼 ${s.body.armL.toFixed(2)} / 오 ${s.body.armR.toFixed(2)}   엉덩이 ${s.body.hips.toFixed(2)}`
      : "없음 (상반신 안 보임 또는 꺼짐)";
    this.statsEl.textContent =
      `상태      ${STATE_KO[s.snap.state] ?? s.snap.state}  ${(s.snap.elapsedMs / 1000).toFixed(1)}초째\n` +
      `속도      화면 ${s.renderFps.toFixed(0)}fps · 얼굴추론 ${s.inferFps.toFixed(0)}fps ${s.inferenceMs.toFixed(1)}ms · 상반신 ${s.poseMs.toFixed(1)}ms\n` +
      `얼굴      ${s.sig.faceCount}명  있음=${s.sig.present ? "O" : "X"}  가까움=${s.sig.near ? "O" : "X"}\n` +
      `          bboxH(얼굴 크기)=${s.sig.bboxH.toFixed(3)}  cx(가로 위치)=${s.sig.cx.toFixed(2)}\n` +
      `고개      좌우 ${s.sig.yaw.toFixed(1)}°  상하 ${s.sig.pitch.toFixed(1)}°  갸웃 ${s.sig.roll.toFixed(1)}°\n` +
      `기준      ${!this.cfg.mapping.autoNeutral ? "자동 보정 꺼짐" : b.__neutralReady ? "고개·뜬 눈 기준 완료" : "고개 추종 중 · 뜬 눈 기준 수집 중"}\n` +
      `상반신    ${body}\n` +
      // 입 판정 원값 — 다물었는데 'o' / 시무룩 안 됨 같은 문제는 이 줄로 확인
      `입        입술간격 ${(b.__dbgOpenRaw ?? 0).toFixed(3)} (무표정 ${(b.__dbgOpenBase ?? 0).toFixed(3)}, 'o' 기준 +${s.mouthOpenFrom.toFixed(2)})` +
      `  입꼬리 ${(b.__geoCorner ?? 0) >= 0 ? "+" : ""}${(b.__geoCorner ?? 0).toFixed(3)} (+웃음 / −시무룩)\n` +
      `표정      ${s.sig.expression}   ${top}\n` +
      `모델      ${s.modelSource}\n` +
      `[d] 오버레이 숨기기`;
  }
}
