import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Config } from "./config";
import { log } from "./logger";
import { lightMobile } from "./mobile";
import { PaintFilter } from "./paintFilter";
import { OilStrokeFilter } from "./oilFilter";

/** 시야각 18° (망원 — 원근 왜곡 적게, 가이드 3D 렌더 느낌) */
const CAM_FOV = 18;

/** 렌더러·카메라·조명. 세로 디스플레이(거울 프레임) 기준 레이아웃. */
export class Scene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private onLost: (() => void) | null = null;
  private lights!: { key: THREE.DirectionalLight; fill: THREE.DirectionalLight; rim: THREE.DirectionalLight; hemi: THREE.HemisphereLight };

  /** 오버레이에서 조명 값을 바꿨을 때 */
  applyLighting(): void {
    this.lights.key.intensity = this.cfg.keyLight;
    this.lights.fill.intensity = this.cfg.fillLight;
    this.lights.rim.intensity = this.cfg.rimLight;
    this.lights.hemi.intensity = this.cfg.hemiLight;
    this.scene.environmentIntensity = this.cfg.envLight;
    this.renderer.toneMappingExposure = this.cfg.exposure;
    this.resize();
  }

  private paint: PaintFilter | null = null;
  private oil: OilStrokeFilter | null = null;
  /** 그림 배경 (겨울 마을) — 그림 필터가 그 위에 캐릭터를 합성 */
  backdrop: { texture: THREE.Texture | null; frontTexture(): THREE.Texture | null; setFrontBaked(on: boolean): void } | null = null;

  constructor(container: HTMLElement, private cfg: Config["scene"], private ch: Config["character"], private filterCfg?: Config["filter"]) {
    // 폰·태블릿은 MSAA 끔 (픽셀 밀도가 높아 계단이 덜 보이고 부하는 큼)
    this.renderer = new THREE.WebGLRenderer({ antialias: !lightMobile(), alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // 흰 털이 회색으로 죽지 않도록 Neutral 톤매핑 (가이드 BODY COLOR #FFFFFF / 털 #F2F2F2)
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = cfg.exposure;
    container.appendChild(this.renderer.domElement);

    // 가이드북 3D 렌더처럼 망원 느낌(원근 왜곡 적게) — 광각이면 앞으로 튀어나온 코가 커 보이고 눈이 옆으로 밀려 보인다
    this.camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.5, 200);

    // 배경: 가이드 KEY COLOR(#F55433) 계열 세로 그라디언트 — 그래픽 팀 프레임 이미지로 교체 대상
    // 배경은 페이지 전체 그라디언트 하나로 (캔버스는 투명) — 세로 화면에서 위아래 여백과 캔버스 경계가 끊겨 보이지 않게
    this.renderer.setClearColor(0x000000, 0);
    document.body.style.background = `linear-gradient(${cfg.bgTop}, ${cfg.bgBottom}) fixed`;

    // 부드러운 스튜디오 반사 + 키/필/림
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = cfg.envLight;
    const key = new THREE.DirectionalLight(0xffffff, cfg.keyLight);
    key.position.set(2, 3, 4);
    const fill = new THREE.DirectionalLight(0xffffff, cfg.fillLight);
    fill.position.set(-3, 0, 3);
    const rim = new THREE.DirectionalLight(0xffffff, cfg.rimLight);
    rim.position.set(0, 2, -4);
    // 가이드 2.4 그림자는 중립 회색 (살구빛 바닥 반사를 넣으면 털이 분홍빛으로 물듦)
    const hemi = new THREE.HemisphereLight(0xffffff, 0xd8d8d8, cfg.hemiLight);
    this.scene.add(key, fill, rim, hemi);
    this.lights = { key, fill, rim, hemi };

    this.resize();
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("orientationchange", () => setTimeout(() => this.resize(), 200));

    const el = this.renderer.domElement;
    el.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      log.error("scene", "WebGL context lost");
      this.onLost?.();
    });
    el.addEventListener("webglcontextrestored", () => log.warn("scene", "WebGL context restored"));
  }

  /** 성능 단계에서 렌더 해상도 변경 */
  setPixelRatio(r: number): void {
    if (this.renderer.getPixelRatio() === r) return;
    // three 의 setPixelRatio 는 내부에서 setSize 를 불러 캔버스를 비움 → 바로 다시 그림
    this.renderer.setPixelRatio(r);
    this.resize();
    if (this.ready) this.render();
  }

  onContextLost(fn: () => void): void {
    this.onLost = fn;
  }

  /** 지금 화면 방향의 시점 값 (터치 확대·이동이 이 값을 바꿈) */
  /** 지금 적용 중인 방향: layout 이 auto 면 화면 방향(세로로 긴 화면 = 세로) */
  get portrait(): boolean {
    const l = this.cfg.layout;
    return l === "auto" ? window.innerHeight > window.innerWidth : l === "portrait";
  }

  view(): { center: number; height: number; offsetX: number } {
    const c = this.cfg;
    return this.portrait
      ? { center: c.pViewCenterCm, height: c.pViewHeightCm, offsetX: c.pViewOffsetXcm }
      : { center: c.viewCenterCm, height: c.viewHeightCm, offsetX: c.viewOffsetXcm };
  }

  setView(v: { center: number; height: number; offsetX: number }): void {
    const c = this.cfg;
    const height = Math.min(260, Math.max(25, v.height));
    const center = Math.min(220, Math.max(20, v.center));
    const offsetX = Math.min(80, Math.max(-80, v.offsetX));
    if (this.portrait) Object.assign(c, { pViewCenterCm: center, pViewHeightCm: height, pViewOffsetXcm: offsetX });
    else Object.assign(c, { viewCenterCm: center, viewHeightCm: height, viewOffsetXcm: offsetX });
    this.resize();
  }

  /** 화면 1px 이 캐릭터 몇 cm 인지 — 터치·드래그 이동량 변환용 */
  get cmPerPx(): number {
    const r = window.innerWidth / Math.max(1, window.innerHeight);
    const A = this.portrait ? 9 / 16 : this.cfg.aspect;
    const v = this.view();
    const visH = r >= A ? v.height : (v.height * A) / r;
    return visH / window.innerHeight;
  }

  resize(): void {
    // 캔버스는 항상 화면 전체 (자르거나 여백을 두지 않음).
    // 시점 = 기준 비율(가로 aspect / 세로 9:16)의 사각형(보이는 높이 = view.height). 화면이 그보다 길쭉하면 폭에 맞추고
    // 남는 높이는 위쪽(하늘)으로, 더 넓으면 높이에 맞추고 양옆이 더 보임. 아래 끝은 항상 시점의 아래 끝에 붙음.
    const W = window.innerWidth, H = window.innerHeight;
    if (!W || !H) return; // 탭이 숨겨진 순간 등 크기 0 → 계산하면 카메라가 NaN 이 됨
    const el = this.renderer.domElement;
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.margin = "0";
    // 캔버스 크기는 '실제로 바뀔 때만' 설정 — 같은 값이라도 다시 넣으면 브라우저가 캔버스를 비워서,
    // 다음 프레임 전까지 캐릭터가 사라지고 배경만 깜빡 보임 (폰 주소창 숨김·터치 확대·품질 단계 변경 때마다)
    const pr = this.renderer.getPixelRatio();
    const bw = Math.floor(W * pr), bh = Math.floor(H * pr);
    const resized = el.width !== bw || el.height !== bh;
    if (resized) this.renderer.setSize(W, H, false);
    const r = W / H;
    this.camera.aspect = r;
    this.camera.fov = CAM_FOV;
    const A = this.portrait ? 9 / 16 : this.cfg.aspect;
    const s = this.ch.modelScale, v = this.view();
    const visH = r >= A ? v.height : (v.height * A) / r;
    const bottom = v.center - v.height / 2;
    const t = Math.tan(((CAM_FOV / 2) * Math.PI) / 180);
    const dist = ((visH / 2) * s) / t;
    const cx = v.offsetX * s;
    const cy = ((this.cfg.centerLongScreens ? v.center : bottom + visH / 2) - this.ch.focusYcm) * s;
    // 음수 각이면 위에서 살짝 내려다봄 → 앞으로 나온 코가 화면에서 내려가 눈과 떨어져 보인다 (가이드 렌더 구도)
    const tilt = (this.cfg.cameraTiltDeg * Math.PI) / 180;
    this.camera.position.set(cx, cy - dist * Math.sin(tilt), dist * Math.cos(tilt));
    this.camera.lookAt(cx, cy, 0);
    this.camera.updateProjectionMatrix();
    // 크기가 바뀌어 캔버스가 비었으면 다음 프레임을 기다리지 않고 바로 다시 그림
    if (resized && this.ready) this.render();
  }

  /** 첫 프레임 전엔 resize 에서 바로 그리지 않음 (캐릭터 로드 전) */
  ready = false;

  render(): void {
    if (this.filterCfg?.oil?.enabled) {
      this.oil ??= new OilStrokeFilter(
        this.renderer, this.scene, this.camera, this.filterCfg.oil, { top: this.cfg.bgTop, bottom: this.cfg.bgBottom },
        () => this.backdrop?.texture ?? null,
        { lo: this.filterCfg.edgeLo, hi: this.filterCfg.edgeHi },
        () => this.backdrop?.frontTexture() ?? null,
      );
      this.oil.render();
      return;
    }
    this.oil?.hide();
    this.backdrop?.setFrontBaked(false);
    if (this.filterCfg?.enabled) {
      this.paint ??= new PaintFilter(this.renderer, this.scene, this.camera, this.filterCfg, { top: this.cfg.bgTop, bottom: this.cfg.bgBottom }, () =>
        this.backdrop?.texture ?? null,
      );
      this.paint.render();
      return;
    }
    this.renderer.render(this.scene, this.camera);
  }
}
