import * as THREE from "three";
import type { PuuvillaCharacter } from "./character/puuvilla";
import type { Scene } from "./scene";
import type { SimInput } from "./sim";

/**
 * 개발 전용(?sim=1): 가이드북 비교용 고정 구도 촬영 → .trace/trace.jsonl 에 'IMG <name> <dataURL>' 로 보냄.
 * 탭이 숨겨져 rAF 가 멈춰도 step() 으로 프레임을 진행해서 찍는다.
 */
export interface ShotOpts {
  rootY?: number; // 몸 전체 회전(rad)
  mx?: number; // sim 고개 좌우(-1~1)
  my?: number; // sim 고개 상하(-1~1)
  fov?: number;
  ox?: number; // 두 눈 중간 기준 시선 이동(월드)
  oy?: number;
  w?: number;
  h?: number;
  levels?: Record<string, number>; // sim 표정 키
}

export function installDevShot(scene: Scene, character: PuuvillaCharacter, sim: SimInput, step: (sec: number) => void): void {
  const shot = async (name: string, o: ShotOpts = {}) => {
    const { rootY = -0.8, mx = -0.35, my = -0.15, fov = 12, ox = 0.1, oy = -0.22, w = 1040, h = 1000, levels = {} } = o;
    const s = sim as unknown as { level: Record<string, number>; mx: number; my: number };
    s.level = { ...levels };
    s.mx = mx;
    s.my = my;
    character.root.rotation.y = rootY;
    step(2);
    const eL = new THREE.Vector3(), eR = new THREE.Vector3();
    (character as unknown as { eyeL: THREE.Object3D }).eyeL.getWorldPosition(eL);
    (character as unknown as { eyeR: THREE.Object3D }).eyeR.getWorldPosition(eR);
    const c = eL.add(eR).multiplyScalar(0.5);
    const R = scene.renderer, cam = scene.camera;
    // 패널이 숨겨져 창 크기가 0 이면 카메라 위치가 없음 → 눈 앞 정면 거리로 직접 둠
    if (!Number.isFinite(cam.position.z) || cam.position.lengthSq() < 1) cam.position.set(c.x, c.y, c.z + 12);
    R.setPixelRatio(1);
    R.setSize(w, h, false);
    R.domElement.style.width = `${w}px`;
    R.domElement.style.height = `${h}px`;
    cam.aspect = w / h;
    cam.fov = fov;
    cam.updateProjectionMatrix();
    cam.lookAt(c.x + ox, c.y + oy, c.z);
    scene.render();
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const g2 = out.getContext("2d")!;
    // 캔버스는 투명 배경 — 페이지와 같은 그라디언트를 깔고 합성
    const sc = (scene as unknown as { cfg: { bgTop: string; bgBottom: string } }).cfg;
    const grd = g2.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, sc.bgTop);
    grd.addColorStop(1, sc.bgBottom);
    g2.fillStyle = grd;
    g2.fillRect(0, 0, w, h);
    g2.drawImage(R.domElement, 0, 0, w, h);
    R.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    character.root.rotation.y = 0;
    s.level = {};
    s.mx = s.my = 0;
    cam.fov = 18;
    scene.resize();
    await fetch("/__mimic/trace", { method: "POST", body: `IMG ${name} ${out.toDataURL("image/png")}` });
    return "ok";
  };
  (window as unknown as { __mimic: Record<string, unknown> }).__mimic.shot = shot;
}
