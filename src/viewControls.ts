import type { Config } from "./config";
import type { Scene } from "./scene";
import type { Backdrop } from "./backdrop";
import { quarterTurn } from "./cameraInput";

/**
 * 보는 사람용 시점 조작 (키오스크 제외):
 * - 왼쪽 아래 반투명 아이콘 버튼: 가로 ↔ 세로 화면 전환 (방향마다 시점을 따로 기억)
 * - 두 손가락 벌리기/오므리기 = 확대/축소, 한 손가락 끌기 = 이동 (PC: 휠 = 확대/축소, 드래그 = 이동)
 * 바뀐 값은 onChange 로 저장 (배포본은 그 브라우저에만)
 */
const ICON_TO_PORTRAIT =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/></svg>';
const ICON_FULL =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const ICON_EXIT_FULL =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';
// 그림 필터 (붓 모양)
const ICON_PAINT =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4.5l5 5L10 19H5v-5z"/><path d="M12.5 6.5l5 5"/></svg>';
// 의상 전환: 곰(기존 스카프) / 산타 모자(크리스마스 목도리) — 단색 실루엣
const ICON_BEAR =
  '<svg viewBox="0 0 24 24" width="21" height="21" fill="#fff"><circle cx="6.2" cy="6.6" r="3.1"/><circle cx="17.8" cy="6.6" r="3.1"/><ellipse cx="12" cy="13.6" rx="8.2" ry="7.4"/></svg>';
const ICON_SANTA =
  '<svg viewBox="0 0 24 24" width="21" height="21" fill="#fff"><path d="M4.2 16.2C5.3 10 8.6 5.4 13.2 4.6c3.3-.6 5.7 1.4 6.4 4.8l-1.9.5c-.6-2-1.8-3.1-3.6-2.9-2.6.4-4.5 4-5 9.2z"/><circle cx="19.2" cy="11.6" r="2.3"/><rect x="2.6" y="15.6" width="16.2" height="4.6" rx="2.3"/></svg>';
// 배경 바꾸기 (산·달 풍경)
const ICON_BG =
  '<svg viewBox="0 0 24 24" width="21" height="21" fill="#fff"><circle cx="16.8" cy="7" r="2.4"/><path d="M2.5 19.5l6.2-9.3 4.1 6 2.4-3.2 6.3 6.5z"/></svg>';
// 유화 획 필터 (팔레트)
const ICON_OIL =
  '<svg viewBox="0 0 24 24" width="21" height="21" fill="#fff"><path d="M12 3C6.5 3 2.5 6.9 2.5 11.6c0 4.2 3.3 7.4 7.3 7.4 1.4 0 1.9-.8 1.9-1.6 0-1.2-1-1.6-1-2.6 0-.9.7-1.5 1.7-1.5h2.3c3.4 0 6.8-1.7 6.8-5.4C21.5 4.8 17.2 3 12 3z" opacity=".95"/><circle cx="7.2" cy="10.6" r="1.5" fill="#000" opacity=".35"/><circle cx="10.6" cy="7.1" r="1.5" fill="#000" opacity=".35"/><circle cx="15.2" cy="7.4" r="1.5" fill="#000" opacity=".35"/></svg>';
const ICON_TO_LANDSCAPE =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="7" width="19" height="10" rx="2"/><path d="M18.5 11v2"/></svg>';
const ICON_MIRROR =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/></svg>';

export function setupViewControls(
  full: Config,
  scene: Scene,
  onChange: () => void,
  backdrop: Backdrop | null,
  onOutfit?: (style: "classic" | "christmas") => void,
): void {
  const cfg = full.scene;
  const btn = document.createElement("button");
  btn.id = "layoutToggle";
  btn.classList.add("view-control");
  btn.setAttribute("aria-label", "가로/세로 화면 전환");
  btn.style.cssText =
    "position:fixed;left:12px;bottom:12px;z-index:30;width:40px;height:40px;border-radius:20px;border:0;padding:0;" +
    "display:grid;place-items:center;background:rgba(0,0,0,.22);opacity:.6;cursor:pointer;-webkit-tap-highlight-color:transparent";
  const paint = () => (btn.innerHTML = scene.portrait ? ICON_TO_LANDSCAPE : ICON_TO_PORTRAIT);
  // auto 일 땐 폰을 돌리면 아이콘도 바뀜
  addEventListener("resize", paint);
  paint();
  btn.addEventListener("pointerdown", (e) => e.stopPropagation());
  btn.onclick = (e) => {
    e.stopPropagation();
    // 지금 보이는 방향의 반대로 고정 (이 기기에 저장)
    cfg.layout = scene.portrait ? "landscape" : "portrait";
    paint();
    scene.resize();
    onChange();
  };
  document.body.appendChild(btn);

  const mirrorBtn = btn.cloneNode() as HTMLButtonElement;
  mirrorBtn.id = "outputMirrorToggle";
  mirrorBtn.setAttribute("aria-label", "미믹 출력 좌우반전");
  mirrorBtn.title = "미믹 출력 좌우반전";
  mirrorBtn.innerHTML = ICON_MIRROR;
  const paintMirror = () => {
    mirrorBtn.setAttribute("aria-pressed", String(!!cfg.outputMirror));
    mirrorBtn.style.opacity = cfg.outputMirror ? ".95" : ".6";
    mirrorBtn.style.background = cfg.outputMirror ? "rgba(0,0,0,.5)" : "rgba(0,0,0,.22)";
  };
  paintMirror();
  mirrorBtn.addEventListener("pointerdown", e => e.stopPropagation());
  mirrorBtn.onclick = e => {
    e.stopPropagation();
    cfg.outputMirror = !cfg.outputMirror;
    paintMirror();
    if (scene.ready) scene.render();
    onChange();
  };
  document.body.appendChild(mirrorBtn);

  const rotationBtn = btn.cloneNode() as HTMLButtonElement;
  rotationBtn.id = "inputRotationToggle";
  rotationBtn.setAttribute("aria-label", "카메라 입력 반시계 90도 회전");
  const paintRotation = () => {
    const angle = quarterTurn(full.camera.inputRotation);
    rotationBtn.title = `카메라 입력 ${angle}° — 누르면 반시계 90° 회전`;
    rotationBtn.innerHTML = `<span style="font-size:23px;line-height:21px;color:white">↶<small style="display:block;font-size:9px;line-height:10px">${angle}°</small></span>`;
    rotationBtn.style.opacity = angle ? ".95" : ".6";
  };
  paintRotation();
  rotationBtn.addEventListener("pointerdown", e => e.stopPropagation());
  rotationBtn.onclick = e => {
    e.stopPropagation();
    full.camera.inputRotation = quarterTurn(full.camera.inputRotation + 90);
    paintRotation();
    onChange();
  };
  document.body.appendChild(rotationBtn);

  // 전체화면 버튼 (Fullscreen API 지원하는 브라우저만 — 아이폰 Safari 는 없음 → 홈 화면에 추가로 전체화면)
  const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
  const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  const canFull = !!(root.requestFullscreen || root.webkitRequestFullscreen) && !matchMedia("(display-mode: fullscreen)").matches;
  const fsBtn = btn.cloneNode() as HTMLButtonElement;
  fsBtn.id = "fullscreenToggle";
  fsBtn.setAttribute("aria-label", "전체화면");
  const isFull = () => !!(document.fullscreenElement || doc.webkitFullscreenElement);
  const paintFs = () => (fsBtn.innerHTML = isFull() ? ICON_EXIT_FULL : ICON_FULL);
  paintFs();
  fsBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  fsBtn.onclick = async (e) => {
    e.stopPropagation();
    try {
      if (isFull()) await (document.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
      else await (root.requestFullscreen?.({ navigationUI: "hide" }) ?? root.webkitRequestFullscreen?.());
    } catch {
      /* 거부됨 */
    }
  };
  document.addEventListener("fullscreenchange", () => {
    paintFs();
    setTimeout(() => scene.resize(), 100);
  });
  if (canFull) document.body.appendChild(fsBtn);

  // 그림 필터 켜기/끄기 (테스트) — 켜져 있으면 버튼이 진하게
  const fBtn = btn.cloneNode() as HTMLButtonElement;
  fBtn.id = "filterToggle";
  fBtn.setAttribute("aria-label", "그림 필터 켜기/끄기");
  fBtn.innerHTML = ICON_PAINT;
  const paintF = () => {
    fBtn.style.opacity = full.filter.enabled ? "0.95" : "0.45";
    fBtn.style.background = full.filter.enabled ? "rgba(0,0,0,.45)" : "rgba(0,0,0,.22)";
  };
  paintF();
  fBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  fBtn.onclick = (e) => {
    e.stopPropagation();
    full.filter.enabled = !full.filter.enabled;
    paintF();
    onChange();
  };
  // (기존 그림 필터 버튼은 뺌 — 필터는 유화 획 하나로)

  // 유화 획 필터 켜기/끄기 (켜면 위 그림 필터 대신)
  const oBtn = btn.cloneNode() as HTMLButtonElement;
  oBtn.id = "oilToggle";
  oBtn.setAttribute("aria-label", "유화 획 필터 켜기/끄기");
  oBtn.innerHTML = ICON_OIL;
  const paintOil = () => {
    const on = full.filter.oil.enabled;
    oBtn.style.opacity = on ? "0.95" : "0.45";
    oBtn.style.background = on ? "rgba(0,0,0,.45)" : "rgba(0,0,0,.22)";
  };
  paintOil();
  oBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  // 유화 조정 패널 (유화가 켜져 있을 때 버튼 위에) — 재료 필터 갤러리의 '조정'과 같은 항목·범위
  const oilPanel = document.createElement("div");
  oilPanel.id = "oilPanel";
  oilPanel.style.cssText =
    "position:fixed;z-index:30;padding:10px 12px;border-radius:12px;background:rgba(0,0,0,.5);color:#fff;" +
    "font:12px/1.3 system-ui,sans-serif;display:none;flex-direction:column;gap:7px;width:250px;max-width:calc(100vw - 24px)";
  const oil = full.filter.oil;
  let saveT = 0;
  const saveOil = () => {
    clearTimeout(saveT);
    saveT = window.setTimeout(onChange, 400);
  };
  const row = (label: string) => {
    const r = document.createElement("div");
    r.style.cssText = "display:grid;grid-template-columns:72px 1fr 32px;align-items:center;gap:8px";
    const n = document.createElement("span");
    n.textContent = label;
    r.appendChild(n);
    oilPanel.appendChild(r);
    return r;
  };
  type OilNum = "strength" | "size" | "boil" | "grade" | "split";
  const addSlider = (label: string, key: OilNum, min: number, max: number, step: number) => {
    const r = row(label);
    const inp = document.createElement("input");
    inp.type = "range";
    inp.min = String(min);
    inp.max = String(max);
    inp.step = String(step);
    inp.value = String(oil[key]);
    inp.style.cssText = "width:100%;accent-color:#fff;margin:0";
    const v = document.createElement("span");
    v.style.textAlign = "right";
    v.textContent = oil[key].toFixed(2);
    inp.oninput = () => {
      oil[key] = parseFloat(inp.value);
      v.textContent = oil[key].toFixed(2);
      saveOil();
    };
    r.append(inp, v);
  };
  const addSeg = (label: string, key: "fps" | "res", opts: [string, number][]) => {
    const r = row(label);
    r.style.gridTemplateColumns = "72px 1fr";
    const box = document.createElement("div");
    box.style.cssText = "display:grid;grid-template-columns:repeat(3,1fr);gap:4px";
    const bs: [HTMLButtonElement, number][] = [];
    const paintSeg = () =>
      bs.forEach(([b, v]) => {
        const on = oil[key] === v;
        b.style.background = on ? "#fff" : "transparent";
        b.style.color = on ? "#111" : "#fff";
      });
    for (const [t, v] of opts) {
      const b = document.createElement("button");
      b.textContent = t;
      b.style.cssText = "border:1px solid rgba(255,255,255,.7);border-radius:6px;padding:3px 0;font:inherit;cursor:pointer";
      b.onclick = (e) => {
        e.stopPropagation();
        oil[key] = v;
        paintSeg();
        saveOil();
      };
      bs.push([b, v]);
      box.appendChild(b);
    }
    paintSeg();
    r.appendChild(box);
  };
  addSlider("강도", "strength", 0, 1.6, 0.05);
  addSlider("붓·코 크기", "size", 0.6, 1.8, 0.05);
  addSlider("획 다시 그리기", "boil", 0, 1, 0.05);
  addSeg("초당 그림", "fps", [["24", 24], ["12", 12], ["8", 8]]);
  addSlider("색 보정", "grade", 0, 1, 0.05);
  addSlider("비교 위치", "split", 0, 1, 0.01);
  addSeg("처리 해상도", "res", [["½", 0.5], ["¾", 0.75], ["1", 1]]);
  for (const ev of ["pointerdown", "pointermove", "wheel"]) oilPanel.addEventListener(ev, (e) => e.stopPropagation());
  document.body.appendChild(oilPanel);
  // 패널: 유화를 켜면 열림, 빈 화면(배경)을 누르면 접힘. 켜진 채 접혀 있을 때 버튼 = 다시 열기, 열려 있을 때 버튼 = 유화 끄기
  let panelOpen = false;
  const showOilPanel = () => (oilPanel.style.display = full.filter.oil.enabled && panelOpen ? "flex" : "none");
  showOilPanel();
  oBtn.onclick = (e) => {
    e.stopPropagation();
    if (full.filter.oil.enabled && !panelOpen) {
      panelOpen = true;
    } else {
      full.filter.oil.enabled = !full.filter.oil.enabled;
      panelOpen = full.filter.oil.enabled;
      paintOil();
      onChange();
    }
    showOilPanel();
  };
  document.addEventListener("pointerdown", (e) => {
    if (!panelOpen || oilPanel.contains(e.target as Node) || oBtn.contains(e.target as Node)) return;
    panelOpen = false;
    showOilPanel();
  });
  document.body.appendChild(oBtn);

  // F toggles presentation controls independently of D's debug panel.
  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() !== "f" || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target;
    if (target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea, select"))) return;
    e.preventDefault();
    const hidden = document.body.classList.toggle("controls-hidden");
    if (hidden) {
      panelOpen = false;
      showOilPanel();
      if (document.activeElement instanceof HTMLElement &&
          document.activeElement.closest(".view-control")) document.activeElement.blur();
    }
  });

  // 오른쪽 아래: 의상 전환 (곰 = 기존 스카프, 산타 모자 = 크리스마스 목도리). 지금 입은 쪽이 진하게
  const outfitBtns: [HTMLButtonElement, "classic" | "christmas"][] = [];
  for (const [icon, style, label] of [[ICON_BEAR, "classic", "기본 스카프"], [ICON_SANTA, "christmas", "크리스마스 목도리"]] as const) {
    const b = btn.cloneNode() as HTMLButtonElement;
    b.id = `outfit-${style}`;
    b.setAttribute("aria-label", label);
    b.innerHTML = icon;
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.onclick = (e) => {
      e.stopPropagation();
      if (full.outfit.style === style) return;
      full.outfit.style = style;
      paintO();
      onOutfit?.(style);
    };
    document.body.appendChild(b);
    outfitBtns.push([b, style]);
  }
  const paintO = () =>
    outfitBtns.forEach(([b, st]) => {
      const on = full.outfit.style === st;
      b.style.opacity = on ? "0.95" : "0.45";
      b.style.background = on ? "rgba(0,0,0,.45)" : "rgba(0,0,0,.22)";
    });
  paintO();

  // 가운데 아래: 배경 바꾸기 (주황 ↔ 겨울 마을). 그림 배경일 때 진하게
  const bgBtn = btn.cloneNode() as HTMLButtonElement;
  bgBtn.id = "bgToggle";
  bgBtn.setAttribute("aria-label", "배경 바꾸기");
  bgBtn.innerHTML = ICON_BG;
  const paintBg = () => {
    const on = !!backdrop?.usesImage;
    bgBtn.style.opacity = on ? "0.95" : "0.6";
    bgBtn.style.background = on ? "rgba(0,0,0,.45)" : "rgba(0,0,0,.22)";
  };
  paintBg();
  bgBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  bgBtn.onclick = (e) => {
    e.stopPropagation();
    backdrop?.next();
    paintBg();
  };
  if (backdrop) document.body.appendChild(bgBtn);

  // 실제로 보이는 영역 기준 위치 — 삼성 인터넷 등은 페이지가 하단 툴바 밑까지 이어져서 bottom:12px 이면 툴바에 가려 안 눌림
  const place = () => {
    const vv = window.visualViewport;
    const hiddenBelow = vv ? Math.max(0, window.innerHeight - (vv.offsetTop + vv.height)) : 0;
    btn.style.bottom = `calc(${12 + hiddenBelow}px + env(safe-area-inset-bottom, 0px))`;
    btn.style.left = `calc(12px + env(safe-area-inset-left, 0px))`;
    fsBtn.style.bottom = btn.style.bottom;
    fsBtn.style.left = `calc(60px + env(safe-area-inset-left, 0px))`;
    mirrorBtn.style.left = `calc(${window.innerWidth < 560 ? 12 : canFull ? 156 : 108}px + env(safe-area-inset-left, 0px))`;
    mirrorBtn.style.bottom = window.innerWidth < 560
      ? `calc(${60 + hiddenBelow}px + env(safe-area-inset-bottom, 0px))` : btn.style.bottom;
    rotationBtn.style.left = `calc(${window.innerWidth < 560 ? 60 : canFull ? 204 : 156}px + env(safe-area-inset-left, 0px))`;
    rotationBtn.style.bottom = mirrorBtn.style.bottom;
    fBtn.style.bottom = btn.style.bottom;
    outfitBtns.forEach(([b], i) => {
      b.style.left = "auto";
      b.style.bottom = btn.style.bottom;
      b.style.right = `calc(${12 + (outfitBtns.length - 1 - i) * 48}px + env(safe-area-inset-right, 0px))`;
    });
    fBtn.style.left = `calc(${canFull ? 108 : 60}px + env(safe-area-inset-left, 0px))`;
    oBtn.style.bottom = btn.style.bottom;
    oBtn.style.left = `calc(${canFull ? 108 : 60}px + env(safe-area-inset-left, 0px))`;
    oilPanel.style.left = oBtn.style.left;
    oilPanel.style.bottom = `calc(${btn.style.bottom} + 50px)`;
    bgBtn.style.bottom = btn.style.bottom;
    bgBtn.style.left = "calc(50% - 20px)";
  };
  place();
  window.visualViewport?.addEventListener("resize", place);
  window.visualViewport?.addEventListener("scroll", place);
  addEventListener("resize", place);

  // ── 확대·축소·이동 ──
  const el = scene.renderer.domElement;
  el.style.touchAction = "none";
  const pts = new Map<number, { x: number; y: number }>();
  let saveTimer = 0;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(onChange, 400);
  };
  const pan = (dx: number, dy: number) => {
    const v = scene.view();
    const cmPerPx = scene.cmPerPx;
    scene.setView({ ...v, offsetX: v.offsetX - dx * cmPerPx, center: v.center + dy * cmPerPx });
  };
  const zoom = (factor: number) => {
    const v = scene.view();
    scene.setView({ ...v, height: v.height / factor });
  };

  el.addEventListener("pointerdown", (e) => {
    el.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  el.addEventListener("pointermove", (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    if (pts.size === 1) {
      pan(e.clientX - p.x, e.clientY - p.y);
    } else if (pts.size === 2) {
      const [a, b] = [...pts.entries()];
      const other = a[0] === e.pointerId ? b[1] : a[1];
      const before = Math.hypot(p.x - other.x, p.y - other.y);
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      if (before > 10) zoom(after / before);
      // 두 손가락 중심 이동은 절반만큼 이동으로
      pan((e.clientX - p.x) / 2, (e.clientY - p.y) / 2);
    }
    p.x = e.clientX;
    p.y = e.clientY;
    save();
  });
  const up = (e: PointerEvent) => pts.delete(e.pointerId);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoom(Math.exp(-e.deltaY * 0.0015));
      save();
    },
    { passive: false },
  );
}
