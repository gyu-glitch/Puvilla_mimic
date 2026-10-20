import "./embedded"; // 단일 HTML 빌드면 내장 파일로 fetch 를 대신함 (가장 먼저)
import { loadConfig, saveConfig } from "./config";
import { describeCameraError, openCamera } from "./camera";
import { CameraInput } from "./cameraInput";
import { FaceTracker } from "./tracker";
import { SignalProcessor, emptySignal } from "./signals";
import { MimicStateMachine } from "./state";
import { mapSignal, NEUTRAL_PARAMS } from "./character/mapping";
import { ProxyCharacter, type CharacterRig } from "./character/proxy";
import { PuuvillaCharacter } from "./character/puuvilla";
import { SimInput } from "./sim";
import { PoseTracker } from "./poseTracker";
import { BodyProcessor, type BodyPose } from "./body";
import { BodyTargetLock } from "./bodyTarget";
import { LockZoneEditor } from "./lockZone";
import { ExpressionTest } from "./expressionTest";
import { lightMobile, qualityParam } from "./mobile";
import { QualityGovernor } from "./quality";
import { setupViewControls } from "./viewControls";
import { Backdrop } from "./backdrop";
import { Scene } from "./scene";
import { Overlay } from "./overlay";
import { isKiosk, scheduleFatalReload, setupKiosk, startHealthBeat } from "./kiosk";
import { log } from "./logger";

/**
 * 파이프라인: 웹캠 → FaceTracker(MediaPipe) → SignalProcessor(스무딩/타깃/접근) →
 *             StateMachine → mapSignal → CharacterRig.apply → Scene.render
 *         웹캠 → PoseTracker(MediaPipe Pose) → BodyProcessor(미러·스무딩) ──────────┘ (상반신)
 * `?sim=1` 이면 웹캠·트래커 대신 SimInput(마우스/키보드)이 FaceSignal 을 만든다.
 * `?char=proxy` 면 도형 프록시 캐릭터.
 */
/** 의상 선택(오른쪽 아래 아이콘)은 공용 설정과 따로 그 기기에만 */
const OUTFIT_KEY = "pubilla-mimic-outfit";

async function main(): Promise<void> {
  const boot = document.getElementById("boot")!;
  const setBoot = (s: string) => (boot.textContent = s);

  const cfg = await loadConfig();
  try {
    const o = localStorage.getItem(OUTFIT_KEY);
    if (o === "classic" || o === "christmas") cfg.outfit.style = o;
  } catch {
    /* 저장소 막힘 */
  }
  // 개발: ?sitModel=pu_sit_12 → 앉은 메쉬 변형 비교
  const sitM = new URLSearchParams(location.search).get("sitModel");
  if (import.meta.env.DEV && sitM) {
    cfg.character.sitModelPath = `./models/${sitM}.obj`;
    cfg.character.sitMufflerPath = `./models/${sitM.replace("pu_sit", "muffler_sit")}.bin`;
    cfg.outfit.style = "christmas";
    cfg.outfit.sitBody = true;
  }
  const params = new URLSearchParams(location.search);
  const kiosk = isKiosk();
  const sim = params.get("sim") === "1" ? new SimInput(cfg) : null;
  if (sim && params.has("armdemo")) {
    cfg.body.enabled = true;
    // Review-only framing so the hands stay visible; no settings are saved here.
    Object.assign(cfg.scene, { viewCenterCm: 115, viewHeightCm: 210, pViewCenterCm: 115, pViewHeightCm: 250 });
    if(params.get('armdemo')==='wave')Object.assign(cfg.scene,{viewCenterCm:133,viewHeightCm:90,pViewCenterCm:133,pViewHeightCm:250,centerLongScreens:true});
  }
  if (kiosk) await setupKiosk(cfg.kiosk);

  const video = document.getElementById("cam") as HTMLVideoElement;
  video.classList.toggle("mirror", cfg.camera.mirror);

  let tracker: FaceTracker | null = null;
  let poseTracker: PoseTracker | null = null;
  if (sim) {
    video.style.display = "none";
    log.info("main", "sim 모드 — 웹캠/트래커 생략");
  } else {
    setBoot("카메라 여는 중…");
    try {
      // 폰·태블릿은 카메라 해상도를 낮춰 얼굴 추론 부하를 줄임
      if (lightMobile()) Object.assign(cfg.camera, { width: cfg.quality.mobileCameraWidth, height: cfg.quality.mobileCameraHeight });
      await openCamera(video, cfg.camera, (n, e) => setBoot(`카메라 다시 연결 중… (${n}번째)\n${describeCameraError(e)}`));
    } catch (e) {
      setBoot(`카메라 실패: ${describeCameraError(e)}\n(${String(e)})`);
      scheduleFatalReload(cfg.kiosk, `camera: ${String(e)}`);
      return;
    }

    setBoot("모델 로딩 중…\n(처음 접속은 1분 정도 걸릴 수 있어요 · 다음부터는 빠름)");
    tracker = new FaceTracker(cfg.tracker);
    try {
      await tracker.init();
    } catch (e) {
      const msg = String(e);
      const hint = /zip archive|404|Failed to fetch/i.test(msg)
        ? "\n모델 파일이 없거나 손상됨 → 터미널에서 `npm run fetch-models` 실행 후 새로고침"
        : "";
      setBoot(`트래커 실패: ${msg.split("\n")[0]}${hint}`);
      scheduleFatalReload(cfg.kiosk, `tracker: ${msg.split("\n")[0]}`);
      return;
    }

    // 상반신(Pose) 모델(9MB)은 기다리지 않고 뒤에서 받는다 — 원격 접속(Funnel)에서 첫 화면이 늦어지지 않게.
    // 준비되면 그때부터 상반신도 따라 함. 실패해도 얼굴 미믹은 계속 — 경고만
    if (cfg.pose.enabled && cfg.body.enabled) {
      const pt = new PoseTracker(cfg.pose, cfg.tracker.wasmPath);
      pt.init().then(
        () => (poseTracker = pt),
        (e) => log.error("pose", `포즈 트래커 실패 → 얼굴만 미믹: ${String(e).split("\n")[0]}`),
      );
    }
  }

  const cameraInput = sim ? null : new CameraInput(video, cfg.camera);
  let signals = new SignalProcessor(cfg);
  let bodyProc = new BodyProcessor(cfg);
  let bodyTarget = new BodyTargetLock(cfg);
  let fsm = new MimicStateMachine(cfg);
  const scene = new Scene(document.getElementById("app")!, cfg.scene, cfg.character, cfg.filter);
  // 배경 (가운데 아래 버튼으로 주황 ↔ 겨울 마을) — 키오스크는 공용 설정 그대로 주황
  const backdrop = kiosk ? null : new Backdrop({ top: cfg.scene.bgTop, bottom: cfg.scene.bgBottom });
  if (backdrop) {
    scene.backdrop = backdrop;
    backdrop.onChange = () => {
      if (scene.ready) scene.render();
    };
  }

  setBoot("캐릭터 로딩 중…");
  const charKind = params.get("char") ?? cfg.character.model;
  // ?seat=1 → 앉은 몸(Seat_A, 팔 교체 작업 중) · ?seat=0 → 서 있는 몸. 없으면 config 값
  if (params.has("seat")) cfg.outfit.seatBody = params.get("seat") !== "0";
  // ?sit=1 → 10/15 앉은 몸(V02 A.fbx: pu_sit.obj + muffler_sit.bin). seat 보다 우선순위 낮음(seat=0 과 같이)
  if (params.has("sit")) cfg.outfit.sitBody = params.get("sit") !== "0";
  // ?arm=1 → 팔을 떼어 낸 서 있는 케이지(pu_stand_arm.obj, scripts/stand_arm_split.py) — 작업 확인용
  if (params.get("arm") === "1") cfg.character.modelPath = "./models/pu_stand_arm.obj";
  // ?wave=1 → 손 흔들기 계속 (확인용, 캐릭터 생성 뒤 적용)
  const forceWave = params.has("wave") ? Number(params.get("wave") || 1) : 0;
  let character: CharacterRig;
  if (charKind === "proxy") {
    character = new ProxyCharacter(cfg.character);
  } else {
    try {
      character = await PuuvillaCharacter.load(cfg);
    } catch (e) {
      log.error("character", `푸빌라 로드 실패 → 프록시로 대체: ${String(e)}`);
      character = new ProxyCharacter(cfg.character);
    }
  }
  scene.characterOutput.add(character.root);
  if (forceWave > 0 && character instanceof PuuvillaCharacter) character.debugWave = Math.min(1, forceWave);
  // 주소 ?quality=max / ?quality=0~5 → 품질 단계 고정, 자동 하향 끔
  const qp = qualityParam();
  // (설정 객체는 건드리지 않음 — 건드리면 이 기기에 저장돼서 주소 없이 열어도 고정이 남음)
  const qcfg = qp.level !== null ? { ...cfg.quality, startLevel: qp.level, auto: false } : cfg.quality;
  const quality = new QualityGovernor(qcfg, (pr, shells) => {
    scene.setPixelRatio(pr);
    if (character instanceof PuuvillaCharacter) character.setShellCount(shells);
  });
  scene.onContextLost(() => scheduleFatalReload(cfg.kiosk, "webgl context lost"));

  // 터치 기기(폰·태블릿)는 설정 메뉴·통계·카메라 미리보기를 아예 뺌 — 시점은 터치로 확대·이동
  // ?debug=1 이면 터치 기기에서도 튜닝 화면·속도 표시 (폰에서 원인 확인용)
  const touch = matchMedia("(pointer: coarse)").matches && params.get("debug") !== "1";
  const overlay = kiosk || touch
    ? null
    : new Overlay(cfg, {
        onFaceNeutral: () => signals.recalibrateNeutral(),
        onSmoothingChange: () => {
          signals.applySmoothingParams();
          bodyProc.applySmoothingParams();
        },
        onCharacterChange: () => {
          if (character instanceof PuuvillaCharacter) character.refreshTuning();
        },
        onSceneChange: () => scene.applyLighting(),
      });

  const zoneEditor = kiosk || touch ? null : new LockZoneEditor(cfg, cameraInput?.canvas ?? video, !sim);
  if (touch) document.body.classList.add("debug-hidden");
  if (!kiosk)
    setupViewControls(cfg, scene, () => (overlay ? overlay.requestSave() : void saveConfig(cfg)), backdrop, (st) => {
      // 의상마다 몸 메쉬가 다름(서 있는 푸빌라+스카프 / 앉은 푸빌라+목도리) → 이 기기에 기억하고 다시 불러옴
      try {
        localStorage.setItem(OUTFIT_KEY, st);
      } catch {
        /* 저장 불가 */
      }
      location.reload();
    });
  if (zoneEditor && overlay) zoneEditor.onChange = () => overlay.requestSave();

  window.addEventListener("mimic:camera-lost", () => scheduleFatalReload(cfg.kiosk, "camera lost"));

  // 디버그 핸들
  let sig = emptySignal();
  let snap = fsm.update(sig, performance.now());
  let body: BodyPose | null = null;
  (window as unknown as { __mimic: unknown }).__mimic = {
    cfg, logs: () => log.entries(), signal: () => sig, state: () => snap, body: () => body, sim, scene, character, tracker,
  };
  startHealthBeat(cfg.kiosk, () => ({ state: snap.state, faces: sig.faceCount, logs: log.entries().slice(-5) }));

  boot.remove();
  log.info("main", `ready kiosk=${kiosk}`);

  // 개발 서버에서만: 표정 튜닝용 수치(영상 아님)를 0.1초마다 .trace/trace.jsonl 로 보낸다
  const tracer = import.meta.env.DEV && !sim && !kiosk ? makeTracer() : null;
  // 개발용 표정 테스트 (t 키): 안내에 따라 표정 → 정답 라벨이 기록에 붙음
  const exprTest = tracer ? new ExpressionTest() : null;

  // 루프
  let last = performance.now();
  let renderFrames = 0, inferFrames = 0, fpsT = last, renderFps = 0, inferFps = 0, lastInferMs = 0;

  const frame = (now: number) => {
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
    last = now;

    if (cameraInput?.update()) {
      tracker?.resetInput(); poseTracker?.resetInput();
      signals = new SignalProcessor(cfg); bodyProc = new BodyProcessor(cfg);
      bodyTarget = new BodyTargetLock(cfg); fsm = new MimicStateMachine(cfg);
    }
    const input = cameraInput?.canvas ?? video;
    let poseMs = 0;
    if (sim) body = sim.body(now / 1000);
    else if (poseTracker) {
      const pr = poseTracker.update(video, now, input);
      poseMs = pr.inferenceMs;
      const revision = bodyTarget.revision;
      const selected = bodyTarget.update(pr.poses, signals.target, pr.fresh, now);
      if (revision !== bodyTarget.revision) {
        signals = new SignalProcessor(cfg); bodyProc = new BodyProcessor(cfg); tracker?.resetInput();
      }
      body = bodyProc.update(selected, pr.fresh, now);
    } else body = null;
    const hint = bodyTarget.headHint(now);
    const track = tracker ? tracker.update(video, now, input, hint) : { faces: [], inferenceMs: 0 };
    if (track.observedAtMs !== undefined && track.observedAtMs !== lastInferMs) {
      inferFrames++;
      lastInferMs = track.observedAtMs;
    }
    sig = sim ? sim.update(dt) : signals.update(track, now, cameraInput!.canvas.width / cameraInput!.canvas.height, hint);
    snap = fsm.update(sig, now, hint!==null || body!==null);

    const params = snap.state === "MIMIC" || snap.state === "ENTER" ? mapSignal(sig, cfg.mapping) : NEUTRAL_PARAMS;
    character.setState(snap);
    character.apply(params, dt, now / 1000, body);
    scene.render();
    scene.ready = true;

    renderFrames++;
    if (now - fpsT >= 1000) {
      renderFps = (renderFrames * 1000) / (now - fpsT);
      inferFps = (inferFrames * 1000) / (now - fpsT);
      // 숨겨진 탭은 rAF 가 멈춰 fps 가 의미 없음. 추론 fps 는 사람이 있을 때만 봄
      if (!document.hidden) quality.update(renderFps, now, tracker && snap.state !== "IDLE" ? inferFps : Infinity);
      renderFrames = inferFrames = 0;
      fpsT = now;
    }
    exprTest?.update(now);
    if (tracer) tracer(now, sig, snap.state, params, character, signals.debugFaces, exprTest?.label ?? null);
    zoneEditor?.draw([...signals.debugFaces, ...(!signals.debugFaces.some(f=>f.locked) ? bodyTarget.debugTarget(now) : [])]);
    overlay?.update({
      renderFps, inferFps, inferenceMs: track.inferenceMs, poseMs, body, mouthOpenFrom: cfg.mapping.mouthOpenGeoFrom,
      modelSource: `${quality.info} · ${tracker ? `${tracker.mode} · ${tracker.modelSource}` : "sim"}`, sig, snap,
    });
  };
  const loop = (now: number) => {
    frame(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  // 디버그: 탭이 숨겨져 rAF 가 멈춰도 프레임을 직접 진행 (__mimic.step(초))
  let simNow = performance.now();
  (window as unknown as { __mimic: Record<string, unknown> }).__mimic.step = (sec = 1, fps = 60) => {
    simNow = Math.max(simNow, performance.now());
    for (let i = 0; i < sec * fps; i++) frame((simNow += 1000 / fps));
  };
  // 개발: 목도리를 원본에서 다시 맞춰 public/models/muffler_fit.bin 으로 저장 (config.outfit.muffler 를 바꾼 뒤)
  if (import.meta.env.DEV && character instanceof PuuvillaCharacter) {
    const pc = character;
    (window as unknown as { __mimic: Record<string, unknown> }).__mimic.bakeMuffler = async () => {
      const { loadMuffler, serializeFitted } = await import("./character/outfit");
      const g = await pc.attachMuffler(await loadMuffler(cfg.outfit.muffler.path));
      if (!g) return "no base";
      const r = await fetch("/__mimic/save-model?name=muffler_fit.bin", { method: "POST", body: serializeFitted(g) });
      return r.ok ? "saved" : "fail";
    };
  }
  if (import.meta.env.DEV && sim && character instanceof PuuvillaCharacter) {
    const stepFn = (window as unknown as { __mimic: { step: (s: number) => void } }).__mimic.step;
    void import("./devShot").then((d) => d.installDevShot(scene, character as PuuvillaCharacter, sim, stepFn));
  }
}

const TRACE_KEYS = [
  "eyeBlinkLeft", "eyeBlinkRight", "eyeSquintLeft", "eyeSquintRight", "mouthSmileLeft", "mouthSmileRight",
  "mouthFrownLeft", "mouthFrownRight", "cheekPuff", "cheekSquintLeft", "cheekSquintRight", "jawOpen",
  "mouthPucker", "mouthFunnel", "__earLeft", "__earRight", "__blinkRelLeft", "__blinkRelRight", "__puckerRel", "__geoCorner", "__geoOpen", "__smileRel", "__geoCornerRaw", "__geoOpenRaw",
];
function makeTracer() {
  let buf: string[] = [];
  let lastT = 0, lastFlush = performance.now();
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return (now: number, sig: ReturnType<typeof emptySignal>, state: string, p: ReturnType<typeof mapSignal>, ch: CharacterRig, faces: SignalProcessor["debugFaces"], label: string | null) => {
    if (now - lastT < 100) return;
    lastT = now;
    const b: Record<string, number> = {};
    for (const k of TRACE_KEYS) if (sig.blend[k] !== undefined) b[k] = r(sig.blend[k]);
    const u = ch as unknown as { face?: Record<string, { value: { x: number; y: number; z: number; w: number } | number }>; fur?: Record<string, { value: { x: number; y: number } }> };
    const blush = u.face?.uBlushA?.value as { w: number } | undefined;
    const ec = u.fur?.uEyeClose?.value;
    buf.push(JSON.stringify({
      t: Math.round(now), lb: label, n: sig.faceCount, st: state, fb: faces.map((f) => [r(f.x), r(f.y), r(f.w), r(f.h), f.locked ? 1 : 0, f.inZone ? 1 : 0]), yaw: r(sig.yaw), pitch: r(sig.pitch), b,
      p: { bl: r(p.blinkL), br: r(p.blinkR), jaw: r(p.jawOpen), sm: r(p.smile), pk: r(p.pucker), ck: r(p.cheek) },
      out: { blush: blush ? r(blush.w) : null, eyeClose: ec ? [r(ec.x), r(ec.y)] : null },
    }));
    if (now - lastFlush > 1000) {
      lastFlush = now;
      const body = buf.join("\n");
      buf = [];
      fetch("/__mimic/trace", { method: "POST", body }).catch(() => {});
    }
  };
}

main().catch((e) => {
  console.error(e);
  const boot = document.getElementById("boot");
  if (boot) boot.textContent = `오류: ${String(e)}`;
});
