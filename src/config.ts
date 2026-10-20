import { isEmbedded } from "./embedded";
/**
 * 런타임 설정. public/config.json 을 로드해 기본값과 병합한다.
 * 임계값·게인·타임아웃은 전부 여기서 — 코드에 숫자를 박지 않는다.
 */
export interface Config {
  /** 배포 버전(npm run deploy 시각) — 튜닝 화면 제목에 표시해서 기기에 어느 버전이 떴는지 확인 */
  build: string;
  camera: {
    deviceLabelIncludes: string;
    width: number;
    height: number;
    frameRate: number;
    mirror: boolean;
    /** 아래 노출·밝기 값을 카메라에 적용할지 (false = 카메라 기본값 그대로) */
    applyImageSettings: boolean;
    /** true = 자동 노출(보정값만 조정) / false = 수동 노출 시간 */
    autoExposure: boolean;
    /** 수동 노출 시간 (카메라 단위, 보통 100µs — 클수록 밝지만 움직이면 번짐) */
    exposureTime: number;
    /** 자동 노출 보정 (−/+) */
    exposureCompensation: number;
    brightness: number;
    contrast: number;
    /** 카메라 화면 아래 노출 슬라이더 접힘 */
    controlsHidden: boolean;
  };
  tracker: {
    modelPath: string;
    modelUrlFallback: string;
    wasmPath: string;
    delegate: "GPU" | "CPU";
    numFaces: number;
    minFaceDetectionConfidence: number;
    minFacePresenceConfidence: number;
    minTrackingConfidence: number;
    inferenceEveryNFrames: number;
    transposeMatrix: boolean;
    /** 얼굴 인식을 별도 스레드(Web Worker)에서 — 렌더가 추론을 기다리지 않음. 안 되면 자동으로 메인 스레드 */
    useWorker: boolean;
  };
  smoothing: {
    headMinCutoff: number;
    headBeta: number;
    blendMinCutoff: number;
    blendBeta: number;
    /** 눈 깜빡임 전용 (짧은 깜빡임이 깎이지 않게 빠르게) */
    blinkMinCutoff: number;
    dCutoff: number;
  };
  presence: {
    enterBboxHeight: number;
    exitBboxHeight: number;
    centerToleranceX: number;
    faceLostHoldMs: number;
    exitHoldMs: number;
    attractAfterMs: number;
    /** 락온 영역 (화면에 보이는 좌표 0~1, 미러 반영). 이 안의 사람만 잡고, 잡은 사람은 이 안에 있는 동안 유지 */
    lockZone: { x: number; y: number; w: number; h: number };
    /** 새로 잡을 때 '영역 중심에 가까움' 가중 (0 = 크기(가까움)만, 1 = 중심 강하게) */
    lockCenterWeight: number;
  };
  mapping: {
    yawGain: number;
    pitchGain: number;
    rollGain: number;
    yawClampDeg: number;
    pitchClampDeg: number;
    rollClampDeg: number;
    headDeadzoneDeg: number;
    /** 눈 감음 판정(뜬 눈 기준선 대비 0~1): 이 값을 넘으면 감음, blinkOpenBelow 아래로 내려가야 다시 뜸 */
    blinkThreshold: number;
    blinkOpenBelow: number;
    smileGain: number;
    /** 입꼬리 높이(입 폭 대비) → 웃음/시무룩 배율 */
    cornerSmileGain: number;
    cornerFrownGain: number;
    /** 입술 간격(입 폭 대비)이 기준선보다 이만큼 넘어야 벌림 시작 / 이 폭에서 최대 */
    mouthOpenGeoFrom: number;
    mouthOpenGeoRange: number;
    /** 무표정 입꼬리 높이(입 폭 대비) 시작값 — 실측 평균 −0.042. 이후 사람마다 천천히 맞춰감 */
    cornerNeutral: number;
    /** 입 다문 채 입술을 오므리거나 내밀면(뾰로통) → 시무룩 '︵' 배율. */
    poutFrownGain: number;
    /** 시무룩(입꼬리 내림) 배율 — MediaPipe frown 값이 작아서 크게 */
    frownGain: number;
    /** 오므림 무시 범위 (평소에도 0.2~0.4 가 나옴) */
    puckerDeadzone: number;
    /** 입 무표정 기준선 학습 시간(초) */
    mouthBaselineSec: number;
    jawGain: number;
    browGain: number;
    blendDeadzone: number;
  };
  expression: {
    smileThreshold: number;
    surpriseJaw: number;
    surpriseBrow: number;
    dwellMs: number;
  };
  character: {
    /** "puuvilla" = 실제 3D(pu_stand.obj), "proxy" = 도형 프록시. URL ?char=proxy 로도 전환 */
    model: "puuvilla" | "proxy";
    modelPath: string;
    /** Catmull-Clark 단계. 원본은 C4D 서브디비전 케이지 → 2 가 C4D 렌더와 동일 */
    subdivLevels: number;
    /** cm → 씬 단위 */
    modelScale: number;
    /** 크리스마스 의상(산타 모자 아이콘)일 때 쓰는 앉은 푸빌라 (asset/Puuvilla_V02/A.fbx → scripts/build-sit.mjs) */
    sitModelPath: string;
    /** Seat_A: 머리 회전 중 목이 나눠 갖는 비율 */
    seatNeckShare: number;
    /** Seat_A 손 흔들기: 위팔을 앞으로 드는 각 · 옆으로 드는 각 (rad, 작게) */
    seatWaveRaise: number;
    seatWaveFwd: number;
    /** 아래팔 기울기(바깥쪽, 0 = 수직) · 까딱 폭(rad) */
    seatWaveForeOut: number;
    seatWaveSwing: number;
    /** 팔이 떨어진 몸(seat 파일 header.armsFree — 생성 A포즈 몸, scripts/seat/gen_to_seat.py):
     *  쉬는 자세 = 바인드(A포즈)에서 아래로 내린 팔. theta = 아래(-y)에서 벌어진 각(rad), phi = 바깥에서 앞으로 돈 각, elbow = 팔꿈치 앞으로 굽힘 */
    freeArmIdleTheta: number;
    freeArmIdlePhi: number;
    freeArmIdleElbow: number;
    /** 손 흔들기: 위팔 방향(theta/phi) · 아래팔 굽힘(rad) ± 까딱 폭 · 초당 횟수 · 팔 축 비틀기(rad, 손바닥이 앞을 보게) */
    freeArmWaveTwist: number;
    freeArmWaveTheta: number;
    freeArmWavePhi: number;
    freeArmWaveElbow: number;
    freeArmWaveSwing: number;
    freeArmWaveHz: number;
    /** 상반신 미믹 때 팔 드는 최대 각 (rad, 아래=0) — 팔이 자유라 body.armRaiseMaxRad 보다 크게 */
    freeArmRaiseMaxRad: number;
    /** 팔을 다 들었을 때 팔 굵기 배율 (떼어 낸 팔 부품만, 축 기준 반지름) — 원본 붙은 팔이 늘어나며 가늘어지던 모양을 따라감 */
    freeArmSlim: number;
    sitMufflerPath: string;
    /** 크리스마스 의상 몸: asset/Puuvilla_V03/Puuvilla_Seat_A (팔 떼어 내고 뼈대·가중치 다시 잡은 것 — dev/armsplit.html 이 만듦) */
    seatModelPath: string;
    /** Seat_A 용 목도리 (V03 OBJ 목도리를 Seat 몸에 옮긴 것 — 몸통·머리 따로 정합해 섞음) */
    seatMufflerPath: string;
    /** true = 등장/퇴장/유도 연출 없이 항상 화면에 떠 있음 (사람 없으면 무표정으로 숨만 쉼) */
    alwaysVisible: boolean;
    /** 화면 중앙(원점)에 올 모델 높이(cm) */
    focusYcm: number;
    /** ENTER/EXIT/ATTRACT 때 아래로 내려가는 거리(씬 단위) */
    enterDrop: number;
    /** ATTRACT 빼꼼 높이 비율 (0~1, 1이면 완전히 올라옴) */
    attractPeek: number;
    /** 고개 회전 중 몸통이 따라가는 비율 */
    bodyFollow: number;
    /** 손 흔들 때 팔 드는 각도(rad) */
    waveLiftRad: number;
    idleBreathAmp: number;
    idleBreathHz: number;
    autoBlinkMinSec: number;
    autoBlinkMaxSec: number;
    enterDurationMs: number;
    exitDurationMs: number;
  };
  /** 가이드북 2.4 Texture-3D (Ornatrix #F2F2F2) 를 셸 털로 근사 */
  fur: {
    color: string;
    /** 셸 개수. 0 이면 털 끔(저사양). 성능 부족 시 먼저 줄인다 */
    shells: number;
    lengthCm: number;
    /** 털 가닥 촘촘함 (cm 당 가닥 수) */
    freq: number;
    /** 덩어리마다 털 길이가 들쭉날쭉한 정도 (0~0.9) */
    minDensity: number;
    /** 털 끝이 아래로 눕는 정도 (털 길이 대비, 0~1) */
    lean: number;
    /** 털 가닥 뿌리 굵기 (가닥 간격 대비 반지름, 0.1~0.5) — 가늘수록 가닥 사이 틈으로 결이 보임 */
    thickness: number;
    /** 털뭉치 입체 음영 세기 (0 = 매끈, 1 = 강함) */
    bumpCm: number;
    /** 털뭉치(솜뭉치 돔) 크기 (cm) */
    tuftCm: number;
    /** 털 재질 거칠기 (1 = 광택 없음. 낮추면 가죽처럼 번들거림) */
    roughness: number;
    rootShade: number;
    faceFurScale: number;
  };
  /** 얼굴 그래픽 (가이드북 2.1 Proportion / 2.3 Expressions). 단위 cm, OBJ 좌표 */
  face: {
    inkColor: string;
    blushColor: string;
    scarfColor: string;
    scarfStripes: number;
    scarfStripeAngle: number;
    /** 눈·코 색 (가이드 3D: 반광택 짙은 차콜) */
    eyeColor: string;
    noseColor: string;
    /** 눈알 크기 배율 (가이드 3D 렌더의 눈은 작은 점 — 원본 메쉬 눈알은 커서 줄인다) */
    eyeScale: number;
    /** 눈 메쉬를 머리 바깥으로 빼는 거리(cm). 0 = 원본 위치 */
    eyePushCm: number;
    /** 눈 주변 머리 표면을 살짝 파서 눈알이 털에 묻히지 않게 */
    eyeSocketCarve: boolean;
    /** 감은 눈 곡선 반폭(cm) / 휨(+ = ‿) / 눈 중심에서 아래로(cm) / 굵기(cm) */
    closedEyeHalfW: number;
    closedEyeCurve: number;
    closedEyeDrop: number;
    closedEyeLineCm: number;
    /** 눈썹 선 굵기(cm) */
    lineCm: number;
    /** 입선 굵기(cm) — 가이드 3D 렌더처럼 가늘게 */
    mouthLineCm: number;
    /** 입선 반폭(cm) */
    mouthHalfW: number;
    /** 무표정 입선 휨 보정 (+ = 끝이 올라감) */
    mouthRestCurve: number;
    /** 웃을 때 입선이 더 휘는 정도 ('‿') */
    smileCurve: number;
    /** 시무룩 '︵': 무표정 입 폭 대비 폭 비율 / 가운데가 올라오는 높이(cm) */
    frownWidth: number;
    frownArcCm: number;
    /** 입 벌림(jawOpen)이 이 값을 넘으면 'o' 입으로 바뀜 (말할 때 자잘한 움직임 무시) */
    mouthOpenFrom: number;
    /** 'o' 입 최대 반폭·반높이(cm) */
    mouthOHalfW: number;
    mouthOHalfH: number;
    /** 볼터치 세기 (0 = 끔) */
    blushStrength: number;
    /** 볼터치: 양쪽 입꼬리(mouthSmile)가 둘 다 이 값을 넘으면 나타나기 시작 / 이 값에서 최대 */
    blushGrinFrom: number;
    blushGrinFull: number;
    blushX: number;
    blushY: number;
    blushR: number;
    /** 눈썹 획 (가이드 3D 엔 없음 → false) */
    browEnabled: boolean;
    browOffsetY: number;
    browLen: number;
  };
  /** 상반신 미믹 (MediaPipe Pose) */
  pose: {
    enabled: boolean;
    modelPath: string;
    modelUrlFallback: string;
    delegate: "GPU" | "CPU";
    /** N 프레임마다 1번 추론 (부하 분산) */
    everyNFrames: number;
    /** 동시에 추적할 사람 수 — 얼굴 대상과 같은 사람의 몸을 고르기 위해 여러 명 */
    numPoses: number;
    minDetectionConfidence: number;
    minPresenceConfidence: number;
    minTrackingConfidence: number;
  };
  body: {
    /** false 면 팔·몸통은 기본 자세(고개만 미믹) */
    enabled: boolean;
    /** 이 값보다 신뢰도가 낮은 관절은 무시 */
    minVisibility: number;
    /** 상반신이 안 보여도 이 시간(ms)은 마지막 자세 유지 */
    lostHoldMs: number;
    minCutoff: number;
    beta: number;
    torsoYawGain: number;
    torsoPitchGain: number;
    torsoRollGain: number;
    torsoYawClampDeg: number;
    torsoPitchClampDeg: number;
    torsoRollClampDeg: number;
    elbowGain: number;
    /** 곰 팔을 드는 최대 각(아래에서부터, rad). 너무 크면 어깨 메쉬가 찢어져 보임 */
    armRaiseMaxRad: number;
    /** Standing model: topology-derived continuous skin, or legacy spatial weights for comparison. */
    armRig: "legacy" | "connected";
    armRigPath: string;
    armDeform?: 'surface' | 'cage';
    armCageRounded?: boolean;
    armHeadClearance?: boolean;
    armHeadContact?: boolean;
    armPawHold?: boolean;
    armContinuousAzimuth?: boolean;
  };
  scene: {
    /** 배경 그라디언트 위/아래 (가이드 KEY COLOR #F55433) */
    bgTop: string;
    bgBottom: string;
    exposure: number;
    /** 카메라 위아래 각(°): − = 위에서 살짝 내려다봄 (가이드 3D 렌더 구도 — 코가 눈에서 떨어져 보임) */
    cameraTiltDeg: number;
    /** 조명 세기: 키(오른쪽 위 앞)·필(왼쪽 앞)·림(뒤)·하늘/바닥 반구·환경 반사. 털이 255 로 날아가지 않게 (가이드 2.4 밝기 분포 기준) */
    keyLight: number;
    fillLight: number;
    rimLight: number;
    hemiLight: number;
    envLight: number;
    /** 화면 방향: auto = 기기 방향 따라(세로로 든 폰 = 세로 구도), 가로 / 세로 고정. 왼쪽 아래 버튼으로 전환하면 그 기기에선 고정 */
    layout: "auto" | "landscape" | "portrait";
    /** 가로 화면 비율(가로/세로) */
    aspect: number;
    /** 가로 시점(캐릭터 cm 기준): 화면 가운데 높이 · 화면에 보이는 높이(작을수록 확대) · 좌우 이동 */
    viewCenterCm: number;
    viewHeightCm: number;
    viewOffsetXcm: number;
    /** 세로 시점 (같은 의미) */
    pViewCenterCm: number;
    pViewHeightCm: number;
    /** Keep the character centered when fitting a narrower screen to arm width. */
    centerLongScreens: boolean;
    pViewOffsetXcm: number;
  };
  /** 의상: classic = 기존 줄무늬 스카프 / christmas = 뜨개 목도리(새 FBX). 오른쪽 아래 아이콘으로 전환 */
  outfit: {
    style: "classic" | "christmas";
    /** true = 크리스마스 의상에서 새 앉은 푸빌라(A.fbx) 몸째로 / false = 기존 서 있는 몸에 목도리만 맞춰 붙임 */
    sitBody: boolean;
    /** true = 크리스마스 의상 몸으로 Seat_A(리깅본) — sitBody 보다 우선 */
    seatBody: boolean;
    muffler: {
      /** 미리 맞춰 구운 목도리 (개발 서버에서 __mimic.bakeMuffler() 로 생성) */
      fittedPath: string;
      path: string;
      /** FBX 에 내장돼 있던 색 텍스처 (줄무늬) — 정점 색으로 구워 씀 */
      colorMap: string;
      /** 색에 곱하는 색 (#ffffff = 그대로) */
      tint: string;
      /** 줄무늬 두 색 (시안 PDF 261014 기준 빨강·크림) */
      red: string;
      cream: string;
      /** 이 높이(cm) 위는 머리 — 밀어내기에서 제외 */
      headFromY: number;
      /** 앉은 메쉬: 고개 돌릴 때 목도리 고리가 머리를 따라가는 비율 (0 = 몸에 고정, 1 = 머리와 같이) */
      headFollow: number;
      /** 크기 배율 (기존 스카프 고리 폭 기준) */
      scale: number;
      offsetX: number;
      offsetY: number;
      offsetZ: number;
      /** 몸 표면에서 띄우는 거리 (cm) */
      gapCm: number;
      /** 맞춘 뒤 변형을 공간적으로 흐리는 반경 σ (cm) — 클수록 매끈(안 터짐), 작을수록 목에 딱 맞음. 0 = 끔 */
      smoothCm: number;
      /** 고리를 목에 붙게 안쪽으로 당기는 최대 거리 (cm) */
      hugMaxCm: number;
      /** 마지막 조이기에서 안쪽 면을 몸 속으로 묻는 깊이 (cm) */
      hugInsetCm: number;
      /** 고리를 턱·머리 밑까지 올리는 최대 거리 (cm, 0 = 안 함) */
      liftMaxCm: number;
      /** 목도리 윗단 최고 높이 (cm, 곰 좌표): 정면·옆 / 뒤 — 넘는 만큼 그 각도 띠를 내림 (0 = 끔) */
      topCapCm: number;
      topCapBackCm: number;
      /** FBX 좌표에서: 이 높이 위 = 고리, 끝자락이 시작되는 경첩 높이 */
      srcRingFromY: number;
      srcHingeY: number;
    };
  };
  /** 그림 필터 (테스트): 쿠와하라 붓 터치 + 선명화 (+ 선택 포스터). 왼쪽 아래 버튼으로 켜고 끔 */
  filter: {
    enabled: boolean;
    /** soft = 부드러운 털(경계 보존 블러) / brush = 붓 터치(쿠와하라) */
    style: "soft" | "brush";
    /** 부드러운 털: 이 색 차이보다 크면 섞지 않음 (0.05~0.3, 작을수록 경계·음영 보존) */
    softColor: number;
    /** 붓 터치 크기 (화면 px) — 클수록 덩어리가 큼, 무거움 */
    radiusPx: number;
    /** 경계 보존 강도 (클수록 윤곽이 덜 뭉개짐) */
    hardness: number;
    edgeSharpness: number;
    /** 털 끝 투명도 곡선: 알파 edgeLo 이하 = 배경, edgeHi 이상 = 털 (간격이 좁을수록 윤곽 또렷) */
    edgeLo: number;
    edgeHi: number;
    /** 마지막 선명화 (0 = 없음) */
    sharpen: number;
    /** 캐릭터 밝기 단계 수 (0 = 끔, 4~8 이면 포스터 느낌) */
    posterLevels: number;
    /** 유화 획 필터 (재료 필터 갤러리 '유화 · 획 (세부 보존)') — 켜면 위 필터 대신 이것 */
    oil: {
      enabled: boolean;
      /** 강도 (물감 두께 조명) */
      strength: number;
      /** 붓 크기 배율 */
      size: number;
      /** 획 다시 그리기 (0 = 붓 위치 고정, 1 = 그림마다 전부 새로) */
      boil: number;
      /** 초당 새로 칠하는 그림 수 */
      fps: number;
      /** 처리 해상도 짧은 변 px (기준) */
      shortSide: number;
      /** 처리 해상도 배율 (½ · ¾ · 1) — shortSide 에 곱함 */
      res: number;
      /** 색 보정 (갤러리 FS_GRADE 섞는 양) */
      grade: number;
      /** 비교 위치: 화면 왼쪽부터 이 비율까지는 원본 (0 = 끔) */
      split: number;
    };
  };
  /** 성능 자동 조절 (폰·태블릿은 가벼운 단계로 시작) */
  quality: {
    /** 시작 단계: 0(최고)~5(최저). 기본 0 — 느릴 때만 자동으로 내려감 */
    startLevel: number;
    /** 실행 중 렌더가 minFps 미만으로 3초 넘게 떨어지면 한 단계씩 내림 */
    auto: boolean;
    minFps: number;
    /** 얼굴 추론이 이 fps 미만으로 3초 넘게 떨어져도 한 단계 내림 (GPU 를 인식에 양보) */
    minInferFps: number;
    /** 모바일 카메라 해상도 (추론 부하) */
    mobileCameraWidth: number;
    mobileCameraHeight: number;
  };
  kiosk: {
    hideCursor: boolean;
    wakeLock: boolean;
    reloadOnFatalMs: number;
    healthPostUrl: string;
    healthIntervalMs: number;
  };
}

export const DEFAULT_CONFIG: Config = {
  build: "dev",
  camera: {
    deviceLabelIncludes: "", width: 1280, height: 720, frameRate: 30, mirror: true,
    applyImageSettings: false, autoExposure: true, exposureTime: 300, exposureCompensation: 0, brightness: 128, contrast: 128, controlsHidden: false,
  },
  tracker: {
    modelPath: "./models/face_landmarker.task",
    modelUrlFallback:
      "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    wasmPath: "./mediapipe/wasm",
    delegate: "GPU",
    numFaces: 3,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    inferenceEveryNFrames: 1,
    transposeMatrix: false,
    useWorker: true,
  },
  smoothing: { headMinCutoff: 1.0, headBeta: 0.05, blendMinCutoff: 1.5, blendBeta: 0.1, blinkMinCutoff: 6, dCutoff: 1.0 },
  presence: {
    enterBboxHeight: 0.22,
    exitBboxHeight: 0.15,
    centerToleranceX: 0.35,
    faceLostHoldMs: 600,
    exitHoldMs: 1500,
    attractAfterMs: 8000,
    lockZone: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 },
    lockCenterWeight: 0.6,
  },
  mapping: {
    yawGain: 1.2,
    pitchGain: 1.0,
    rollGain: 0.8,
    yawClampDeg: 40,
    pitchClampDeg: 25,
    rollClampDeg: 20,
    headDeadzoneDeg: 1.5,
    blinkThreshold: 0.8,
    blinkOpenBelow: 0.55,
    smileGain: 1.3,
    frownGain: 5,
    cornerSmileGain: 9,
    cornerFrownGain: 25,
    mouthOpenGeoFrom: 0.12,
    mouthOpenGeoRange: 0.35,
    cornerNeutral: -0.042,
    poutFrownGain: 1.6,
    puckerDeadzone: 0.45,
    mouthBaselineSec: 8,
    jawGain: 1.2,
    browGain: 1.0,
    blendDeadzone: 0.06,
  },
  expression: { smileThreshold: 0.45, surpriseJaw: 0.35, surpriseBrow: 0.35, dwellMs: 250 },
  character: {
    model: "puuvilla",
    modelPath: "./models/pu_stand.obj",
    subdivLevels: 2,
    modelScale: 0.04,
    sitModelPath: "./models/pu_sit.obj",
    seatNeckShare: 0.35,
    seatWaveRaise: 0.35,
    seatWaveFwd: 0.25,
    seatWaveForeOut: 0.25,
    seatWaveSwing: 0.3,
    freeArmIdleTheta: 0.2,
    freeArmIdlePhi: 0.55,
    freeArmIdleElbow: 0.5,
    // 공개 버전(붙은 팔)은 polarDir(2.1, 0.35)·팔꿈치 0.5±0.35 였지만 붙은 메쉬가 당겨서 실제론 더 세워져 보였음 → 떼어 낸 팔은 2.4 로 같은 그림
    freeArmWaveTwist: 1.4,
    freeArmWaveTheta: 2.35,
    freeArmWavePhi: 0.3,
    freeArmWaveElbow: 0.15,
    freeArmWaveSwing: 0.25,
    freeArmWaveHz: 1.43,
    freeArmRaiseMaxRad: 2.8,
    freeArmSlim: 0.82,
    sitMufflerPath: "./models/muffler_sit.bin",
    seatModelPath: "./models/seat_t2.bin", // 작업 중(팔 교체 Seat_A). 공개 링크는 seatBody=false(서 있는 몸)
    seatMufflerPath: "./models/muffler_seat.bin",
    alwaysVisible: true,
    focusYcm: 128,
    enterDrop: 7,
    attractPeek: 0.8,
    bodyFollow: 0.18,
    waveLiftRad: 1.1,
    idleBreathAmp: 0.015,
    idleBreathHz: 0.25,
    autoBlinkMinSec: 2.5,
    autoBlinkMaxSec: 6,
    enterDurationMs: 600,
    exitDurationMs: 800,
  },
  fur: { color: "#F2F2F2", shells: 14, lengthCm: 1.8, freq: 3, minDensity: 0.45, lean: 1.0, thickness: 0.35, bumpCm: 0.8, tuftCm: 4.5, roughness: 1, rootShade: 0.72, faceFurScale: 1 },
  face: {
    inkColor: "#1A1A1F",
    blushColor: "#F7A1A1",
    scarfColor: "#EF2E2E",
    scarfStripes: 18,
    scarfStripeAngle: 0,
    eyeColor: "#1A1A1F",
    noseColor: "#1E1E23",
    eyeScale: 0.72,
    eyePushCm: 1.0,
    eyeSocketCarve: false,
    closedEyeHalfW: 1.5,
    closedEyeCurve: 0.4,
    closedEyeDrop: 0.5,
    closedEyeLineCm: 0.5,
    lineCm: 0.5,
    mouthLineCm: 0.5,
    mouthHalfW: 3.6,
    mouthRestCurve: 0.05,
    smileCurve: 0.05,
    frownWidth: 0.55,
    frownArcCm: 0.7,
    mouthOpenFrom: 0.25,
    mouthOHalfW: 1.25,
    mouthOHalfH: 1.9,
    blushStrength: 1,
    blushGrinFrom: 0.3,
    blushGrinFull: 0.5,
    blushX: 17,
    blushY: 143,
    blushR: 3.6,
    browEnabled: false,
    browOffsetY: 5.5,
    browLen: 3.4,
  },
  pose: {
    enabled: false, // 상반신 미믹 기본 끔 (켜면 Pose 모델 9MB 추가 로드)
    modelPath: "./models/pose_landmarker_full.task",
    modelUrlFallback:
      "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
    delegate: "GPU",
    everyNFrames: 1,
    numPoses: 3,
    minDetectionConfidence: 0.5,
    minPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  },
  body: {
    enabled: false,
    minVisibility: 0.5,
    lostHoldMs: 500,
    minCutoff: 1.2,
    beta: 0.3,
    torsoYawGain: 0.8,
    torsoPitchGain: 0.5,
    torsoRollGain: 1.0,
    torsoYawClampDeg: 35,
    torsoPitchClampDeg: 20,
    torsoRollClampDeg: 25,
    elbowGain: 1.0,
    armRaiseMaxRad: 3.0,
    armRig: "connected",
    armRigPath: "./models/stand_connected_cage_rig.json",
    armDeform: 'cage',
    armHeadClearance: true,
    armPawHold: true,
    armContinuousAzimuth: true,
  },
  scene: {
    bgTop: "#F76A4B", bgBottom: "#E2462A", exposure: 0.95, cameraTiltDeg: -6,
    keyLight: 0.75, fillLight: 0.7, rimLight: 0.7, hemiLight: 1.5, envLight: 0.45,
    layout: "auto", aspect: 16 / 9, viewCenterCm: 133, viewHeightCm: 90, viewOffsetXcm: 0,
    pViewCenterCm: 153.5, pViewHeightCm: 123, pViewOffsetXcm: 0, centerLongScreens: false,
  },
  outfit: {
    style: "christmas", // 기본 = 뜨개 목도리 (곰 아이콘으로 기존 스카프)
    sitBody: false,
    seatBody: false, // 공개 = 서 있는 몸 + 뜨개 목도리 (10/15 구성). 앉은 몸(Seat_A) 작업은 ?seat=1 또는 DEPLOY_CONFIG 로
    muffler: {
      fittedPath: "./models/muffler_fit.bin", path: "./models/muffler.bin", colorMap: "./models/muffler_color.jpg", tint: "#ffffff",
      red: "#B3210F", cream: "#E9DDC9", headFromY: 128, headFollow: 0.3, scale: 1.0, offsetX: 0, offsetY: 0, offsetZ: 0, gapCm: 0.8, smoothCm: 3, hugMaxCm: 10, hugInsetCm: 3, liftMaxCm: 4, topCapCm: 0, topCapBackCm: 140,
      srcRingFromY: 1.75, srcHingeY: 1.5,
    },
  },
  filter: { enabled: false, style: "soft", softColor: 0.06, edgeLo: 0.12, edgeHi: 0.6, radiusPx: 5, hardness: 8, edgeSharpness: 8, sharpen: 0.6, posterLevels: 0,
    oil: { enabled: true, strength: 0.3, size: 1.4, boil: 0.05, fps: 12, shortSide: 1080, res: 1, grade: 1, split: 0 } },
  quality: { startLevel: 0, auto: true, minFps: 45, minInferFps: 12, mobileCameraWidth: 640, mobileCameraHeight: 480 },
  kiosk: { hideCursor: true, wakeLock: true, reloadOnFatalMs: 5000, healthPostUrl: "", healthIntervalMs: 10000 },
};

function deepMerge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (k.startsWith("$")) continue;
    const cur = out[k];
    out[k] = cur && typeof cur === "object" && !Array.isArray(cur) ? deepMerge(cur, v) : v;
  }
  return out as T;
}

/** 개발 서버가 아닐 때(호스팅·단일 HTML) 튜닝값을 보는 사람 브라우저에 보관하는 키 — 공용 설정 파일은 개발 서버에서만 바뀜 */
// v2: 보는 사람이 바꾼 값만(배포 설정과 다른 것만) 저장. v1 은 설정 전체를 통째로 저장해서
// 이후 배포한 변경(털·구도 등)을 옛 값이 계속 덮어썼음 → 버림
const LOCAL_KEY = "pubilla-mimic-config-v2";
const OLD_LOCAL_KEYS = ["pubilla-mimic-config"];
const localMode = isEmbedded || !import.meta.env.DEV;
/** 배포된 설정(서버 config.json) — 저장 시 이것과 다른 값만 남김 */
let deployed: Config | null = null;
/** 화면 시점(가로·세로 확대·이동·방향)은 보는 사람 손에 따라 바뀌는 값 — 개발 서버에서 휠·끌기로 바꿔도 공용 config.json 엔 안 씀
 *  (예전에 확인하느라 축소한 세로 시점이 저장·배포돼 폰에서 곰이 작게 공중에 떠 보였음). 기본 시점은 config.json 을 직접 고쳐서 바꿈. */
const VIEW_KEYS = ["layout", "viewCenterCm", "viewHeightCm", "viewOffsetXcm", "pViewCenterCm", "pViewHeightCm", "pViewOffsetXcm"] as const;
let fileView: Record<string, unknown> | null = null;

function diff(cur: unknown, base: unknown): unknown {
  if (cur && base && typeof cur === "object" && typeof base === "object" && !Array.isArray(cur)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
      const d = diff(v, (base as Record<string, unknown>)[k]);
      if (d !== undefined) out[k] = d;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return JSON.stringify(cur) === JSON.stringify(base) ? undefined : cur;
}

export async function loadConfig(url = "./config.json"): Promise<Config> {
  try {
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let cfg = deepMerge(DEFAULT_CONFIG, await res.json());
    fileView = Object.fromEntries(VIEW_KEYS.map((k) => [k, cfg.scene[k]]));
    if (localMode) {
      deployed = structuredClone(cfg);
      try {
        for (const k of OLD_LOCAL_KEYS) localStorage.removeItem(k);
        const local = localStorage.getItem(LOCAL_KEY);
        if (local) cfg = deepMerge(cfg, JSON.parse(local));
      } catch {
        /* 저장소 막힘 → 배포 설정 그대로 */
      }
    }
    return cfg;
  } catch (e) {
    console.warn("[config] config.json 로드 실패, 기본값 사용:", e);
    return structuredClone(DEFAULT_CONFIG);
  }
}

const CONFIG_COMMENT =
  "런타임 튜닝값. 코드가 아니라 여기서 바꾼다. 개발 서버(npm run dev)에서는 오버레이(d 키)·락온 영역 편집이 이 파일에 자동 저장된다.";

/**
 * 튜닝값을 public/config.json 에 저장 (개발 서버의 /__mimic/save-config).
 * 서버 저장이 안 되는 환경(vite preview·키오스크)에서는 false — 호출 측이 다운로드로 대체.
 */
export async function saveConfig(cfg: Config): Promise<boolean> {
  if (localMode) {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(diff(cfg, deployed) ?? {}));
      return true;
    } catch {
      return false;
    }
  }
  try {
    const res = await fetch("./__mimic/save-config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ $comment: CONFIG_COMMENT, ...cfg, scene: { ...cfg.scene, ...(fileView ?? {}) } }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 오버레이에서 튜닝한 값을 config.json 형식으로 다운로드 */
export function downloadConfig(cfg: Config): void {
  const blob = new Blob([JSON.stringify({ $comment: CONFIG_COMMENT, ...cfg }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "config.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
