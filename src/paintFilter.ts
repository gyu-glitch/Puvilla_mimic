import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import type { Config } from "./config";
import { lightMobile } from "./mobile";

/**
 * 그림 필터 (테스트): 렌더된 화면을 '몽글몽글한 붓 터치' 처럼 바꾼다 — 털 메쉬를 직접 고치는 대신 화면 단계에서 질감 변경.
 *  1) 일반화 쿠와하라 (Kyprianidis 2010, 8 부채꼴·다항식 가중치): 각 픽셀 주변을 8 방향 부채꼴로 나눠 가장 고른 영역의
 *     평균색을 고름 → 면은 덩어리로 뭉치고 윤곽은 날카롭게 유지 (그냥 흐리기와 달리 뿌옇지 않음)
 *  2) 포스터(선택): 캐릭터에만 밝기 단계 줄이기 (배경 그라디언트에 띠가 생기지 않게)
 *  3) 언샤프 선명화: 덩어리 경계를 또렷하게
 * 캔버스는 원래 투명(뒤에 페이지 그라디언트)이라, 필터 단계에서 같은 그라디언트를 깔고 불투명으로 출력한다.
 */
const KUWAHARA = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform int uRadius;
uniform float uHardness;
uniform float uSharpQ;
uniform float uPoster;
uniform vec3 uBgTop;
uniform vec3 uBgBottom;
uniform sampler2D uBgTex;  // 그림 배경(겨울 마을) — 3D 캔버스 뒤에 깐 것과 같은 그림
uniform float uUseBgTex;
uniform float uExposure;
uniform int uGrid;
uniform float uEdgeLo;    // 털 끝 투명도 곡선 (이 알파 이하는 배경)
uniform float uEdgeHi;    // (이 알파 이상은 털)
uniform float uTipPx;     // 털 끝 풀어 주는 반경 (기기 px)       // 부드러운 털 샘플 격자 반폭 (6 = 약 110회, 폰 3 = 약 28회)
uniform int uStyle;      // 0 = 부드러운 털(bilateral), 1 = 붓 터치(쿠와하라)
uniform float uSoftColor; // 부드러운 털: 이 색 차이(0~1)보다 크면 안 섞음 (작을수록 경계 보존)
varying vec2 vUv;

// three 의 NeutralToneMapping 과 같은 식 (Khronos PBR Neutral)
vec3 pvNeutral(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  color *= uExposure;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}
vec3 pvToSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec4 pvSample(vec2 uv) {
  // 장면은 선형·알파 곱해진 상태 → 알파를 풀어 톤매핑·sRGB 한 뒤 페이지와 같은 그라디언트 위에 합성
  // (톤매핑 후 합성하면 털 끝 반투명 부분이 밝게 떠서 윤곽에 테두리가 생김)
  vec4 c = texture2D(tDiffuse, uv);
  vec3 bg = uUseBgTex > 0.5 ? texture2D(uBgTex, clamp(uv, 0.0, 1.0)).rgb : mix(uBgBottom, uBgTop, clamp(uv.y, 0.0, 1.0));
  if (c.a < 1e-4) return vec4(bg, 0.0);
  vec3 col = pvToSRGB(pvNeutral(c.rgb / c.a));
  // 털 끝 투명도 곡선을 세움: 반쯤 투명한 안개 띠(뿌옇게 번져 보임) 대신 가닥 실루엣이 또렷하게
  float ae = smoothstep(uEdgeLo, uEdgeHi, c.a);
  return vec4(mix(bg, col, ae), c.a);
}

vec3 pvKuwahara(vec3 orig) {
  float R = float(uRadius);
  vec4 m[8];
  vec3 s[8];
  for (int k = 0; k < 8; k++) { m[k] = vec4(0.0); s[k] = vec3(0.0); }
  float zeta = 2.0 / R;
  float zc = 0.58;
  float sz = sin(zc);
  float eta = (zeta + cos(zc)) / (sz * sz);
  for (int y = -12; y <= 12; y++) {
    if (abs(y) > uRadius) continue;
    for (int x = -12; x <= 12; x++) {
      if (abs(x) > uRadius) continue;
      vec2 v = vec2(float(x), float(y)) / R;
      float d2 = dot(v, v);
      if (d2 > 1.0) continue;
      vec3 c = pvSample(vUv + vec2(float(x), float(y)) * uTexel).rgb;
      float w[8];
      float sum = 0.0, z, vxx, vyy;
      vxx = zeta - eta * v.x * v.x;
      vyy = zeta - eta * v.y * v.y;
      z = max(0.0, v.y + vxx);  w[0] = z * z; sum += w[0];
      z = max(0.0, -v.x + vyy); w[2] = z * z; sum += w[2];
      z = max(0.0, -v.y + vxx); w[4] = z * z; sum += w[4];
      z = max(0.0, v.x + vyy);  w[6] = z * z; sum += w[6];
      vec2 r = 0.70710678 * vec2(v.x - v.y, v.x + v.y);
      vxx = zeta - eta * r.x * r.x;
      vyy = zeta - eta * r.y * r.y;
      z = max(0.0, r.y + vxx);  w[1] = z * z; sum += w[1];
      z = max(0.0, -r.x + vyy); w[3] = z * z; sum += w[3];
      z = max(0.0, -r.y + vxx); w[5] = z * z; sum += w[5];
      z = max(0.0, r.x + vyy);  w[7] = z * z; sum += w[7];
      float g = exp(-3.125 * d2) / max(sum, 1e-5);
      for (int k = 0; k < 8; k++) {
        float wk = w[k] * g;
        m[k] += vec4(c * wk, wk);
        s[k] += c * c * wk;
      }
    }
  }
  vec4 acc = vec4(0.0);
  for (int k = 0; k < 8; k++) {
    if (m[k].w <= 0.0) continue;
    vec3 mean = m[k].rgb / m[k].w;
    vec3 var = abs(s[k] / m[k].w - mean * mean);
    float sigma2 = var.r + var.g + var.b;
    float wk = 1.0 / (1.0 + pow(uHardness * 1000.0 * sigma2, 0.5 * uSharpQ));
    acc += vec4(mean * wk, wk);
  }
  return acc.w > 0.0 ? acc.rgb / acc.w : orig;
}

// 부드러운 털: 경계 보존 블러 (bilateral). 비슷한 색끼리만 섞어 털 결 노이즈는 녹이고 윤곽·눈·코 경계는 유지.
// 각진 조각이 생기지 않음 (쿠와하라는 영역마다 색을 하나로 고정해 바위처럼 보임). 샘플 간격을 넓혀 반경이 커도 약 160회.
vec3 pvBilateral(vec3 orig) {
  float R = float(uRadius);
  float G = float(uGrid);
  float stepPx = max(1.0, R / G);
  float sc2 = uSoftColor * uSoftColor;
  vec4 acc = vec4(orig, 1.0);
  for (int y = -6; y <= 6; y++) {
    if (abs(y) > uGrid) continue;
    for (int x = -6; x <= 6; x++) {
      if (abs(x) > uGrid) continue;
      if (x == 0 && y == 0) continue;
      vec2 o = vec2(float(x), float(y)) * stepPx;
      float d2 = dot(o, o) / (R * R);
      if (d2 > 1.0) continue;
      vec4 c = pvSample(vUv + o * uTexel);
      vec3 dc = c.rgb - orig;
      // 공간 가우시안 × 색 차이 가우시안 × 불투명도 (배경·털 끝이 몸 안쪽으로 번지지 않게)
      float w = exp(-2.0 * d2) * exp(-dot(dc, dc) / sc2) * c.a;
      acc += vec4(c.rgb * w, w);
    }
  }
  return acc.rgb / acc.w;
}

void main() {
  vec3 orig = pvSample(vUv).rgb;
  vec3 col = uStyle == 1 ? pvKuwahara(orig) : pvBilateral(orig);
  // 가는 먹선 보호: 필터가 원본보다 확 밝게 만든 곳(= 입선·감은 눈 같은 가늘고 어두운 선을 지운 곳)은 원본으로
  vec3 Y = vec3(0.2126, 0.7152, 0.0722);
  col = mix(col, orig, smoothstep(0.06, 0.2, dot(col, Y) - dot(orig, Y)));
  // 포스터: 캐릭터(불투명한 곳)만 밝기 단계화, 색조 유지
  float a = texture2D(tDiffuse, vUv).a;
  if (uPoster > 1.5 && a > 0.5) {
    float L = max(dot(col, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
    float Lq = floor(L * uPoster + 0.5) / uPoster;
    col *= mix(1.0, Lq / L, smoothstep(0.5, 1.0, a));
  }
  // 털 끝 반투명 솜털 띠: 필터로 평평하게 뭉개면 불투명한 층, 원본 그대로 두면 픽셀보다 가는 가닥이 흰 점으로 흩어짐
  // → 아주 작은 반경으로 살짝 풀어 보송한 테두리로
  vec3 tip = orig * 0.25;
  float tw = 0.25;
  for (int k = 0; k < 8; k++) {
    float ang = float(k) * 0.785398;
    vec2 o = vec2(cos(ang), sin(ang)) * uTipPx;
    tip += pvSample(vUv + o * uTexel).rgb * 0.09375;
    tw += 0.09375;
  }
  tip /= tw;
  float inner = smoothstep(0.75, 0.98, a);
  col = mix(tip, col, inner);
  // 알파 = 몸 안쪽 정도 → 다음 선명화 단계가 안쪽에만 적용 (윤곽 털 끝을 선명화하면 점처럼 튐)
  gl_FragColor = vec4(col, inner);
}
`;

const SHARPEN = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform float uAmount;
varying vec2 vUv;
void main() {
  vec4 c4 = texture2D(tDiffuse, vUv);
  vec3 c = c4.rgb;
  vec3 n = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb
         + texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb;
  gl_FragColor = vec4(clamp(c + uAmount * c4.a * (c - n * 0.25), 0.0, 1.0), 1.0);
}
`;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

export class PaintFilter {
  private composer: EffectComposer;
  private kuwa: ShaderPass;
  private sharp: ShaderPass;
  private size = new THREE.Vector2(-1, -1);
  private pr = -1;

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    private cfg: Config["filter"],
    private bg: { top: string; bottom: string },
    private bgImage?: () => THREE.Texture | null,
  ) {
    // MSAA 있는 HalfFloat 타깃 (필터 전 원본 품질 유지)
    // 폰은 MSAA 없이 (화면 밀도가 높아 계단이 덜 보이고 부하는 큼 — 렌더러 기본 설정과 같게)
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: lightMobile() ? 0 : 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.kuwa = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uRadius: { value: 4 },
        uHardness: { value: 8 },
        uSharpQ: { value: 8 },
        uPoster: { value: 0 },
        uBgTop: { value: new THREE.Color() },
        uBgBottom: { value: new THREE.Color() },
        uBgTex: { value: null },
        uUseBgTex: { value: 0 },
        uExposure: { value: 1 },
        uStyle: { value: 0 },
        uGrid: { value: 6 },
        uEdgeLo: { value: 0.12 },
        uEdgeHi: { value: 0.6 },
        uTipPx: { value: 2 },
        uSoftColor: { value: 0.12 },
      },
      vertexShader: VERT,
      fragmentShader: KUWAHARA,
    });
    this.sharp = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() }, uAmount: { value: 0.5 } },
      vertexShader: VERT,
      fragmentShader: SHARPEN,
    });
    this.composer.addPass(this.kuwa);
    this.composer.addPass(this.sharp);
  }

  render(): void {
    // 렌더러 크기·픽셀 배율이 바뀌었으면 (화면 회전·품질 단계·개발 촬영) 따라감
    const s = this.renderer.getSize(new THREE.Vector2());
    const pr = this.renderer.getPixelRatio();
    if (!s.equals(this.size) || pr !== this.pr) {
      this.size.copy(s);
      this.pr = pr;
      this.composer.setPixelRatio(pr);
      this.composer.setSize(s.x, s.y);
    }
    const W = Math.max(1, Math.round(s.x * pr)), H = Math.max(1, Math.round(s.y * pr));
    const u = this.kuwa.uniforms;
    u.uTexel.value.set(1 / W, 1 / H);
    // 반경은 화면(CSS) px 기준 → 고해상도 기기에서도 같은 크기의 붓 터치 (최대 12)
    u.uRadius.value = Math.max(1, Math.min(12, Math.round(this.cfg.radiusPx * pr)));
    u.uHardness.value = this.cfg.hardness;
    u.uSharpQ.value = this.cfg.edgeSharpness;
    u.uPoster.value = this.cfg.posterLevels;
    u.uExposure.value = this.renderer.toneMappingExposure;
    u.uStyle.value = this.cfg.style === "brush" ? 1 : 0;
    u.uGrid.value = lightMobile() ? 3 : 6;
    u.uTipPx.value = 0.5 * pr; // 털 끝 흰 점만 정리할 정도로 아주 작게 (크면 윤곽이 뿌옇게 번짐)
    u.uEdgeLo.value = this.cfg.edgeLo;
    u.uEdgeHi.value = this.cfg.edgeHi;
    u.uSoftColor.value = this.cfg.softColor;
    // 배경색은 CSS 그라디언트와 같은 sRGB 값 그대로 (색공간 변환 없이)
    u.uBgTop.value.setRGB(...hexToRgb(this.bg.top), THREE.LinearSRGBColorSpace);
    u.uBgBottom.value.setRGB(...hexToRgb(this.bg.bottom), THREE.LinearSRGBColorSpace);
    const bt = this.bgImage?.() ?? null;
    u.uBgTex.value = bt;
    u.uUseBgTex.value = bt ? 1 : 0;
    this.sharp.uniforms.uTexel.value.set(1 / W, 1 / H);
    this.sharp.uniforms.uAmount.value = this.cfg.sharpen;
    this.composer.render();
  }
}

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
