import * as THREE from "three";
import { OilStroke, fitSize } from "./vendor/oil-stroke.js";

/**
 * 유화 획 필터 (세부 보존) — 제작자가 준 단독 모듈 `vendor/oil-stroke.js`(재료 필터 갤러리와 픽셀 단위로 같음)를 씀.
 * 사용법은 docs/oil-stroke-guide.md '2. 이미 WebGL·three.js로 그리는 장면에 입히기' 그대로:
 *  1) 우리 캔버스(three)에 '필터 입력 화면'을 그림 = 장면(선형·알파 곱 HalfFloat) → 톤매핑·sRGB → 배경(주황 / 겨울 그림) 위 합성
 *     → 앞 장식(가지)까지 합성 — 배경·가지까지 전부 함께 칠해지게
 *  2) 그린 바로 다음 줄에서 fx.frame(우리 캔버스) — 모듈은 자기 캔버스(우리 캔버스 위에 겹친 것)에 그림
 *     (모듈이 그림 번호가 바뀔 때만, 초당 fps 장 새로 칠함)
 * 갤러리 '조정' 중 비교 위치·처리 해상도는 모듈에 없어서 여기서: 비교 위치 = 필터 캔버스 왼쪽을 잘라 아래 원본이 보이게,
 * 처리 해상도 = 필터 캔버스 짧은 변(1080 × ½·¾·1, 화면보다 크게는 안 함).
 */
export interface OilCfg {
  strength: number;
  size: number;
  boil: number;
  fps: number;
  grade: number;
  /** 처리 해상도 기준 짧은 변 px (모듈 수치 기준 1080) */
  shortSide: number;
  /** 처리 해상도 배율 (½ · ¾ · 1) */
  res: number;
  /** 비교 위치 0~1 (왼쪽은 원본) */
  split: number;
}

const VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));
out vec2 vUV;
void main(){ vec2 p = P[gl_VertexID]; vUV = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`;

// 필터 입력 화면: 장면(선형·알파 곱) → Neutral 톤매핑·sRGB → 배경 위 합성 → 앞 장식 (paintFilter 와 같은 식)
const FS_SOURCE = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 o;
uniform sampler2D uScene, uBgTex, uFront;
uniform float uUseBgTex, uUseFront, uExposure, uEdgeLo, uEdgeHi;
uniform vec3 uBgTop, uBgBottom;
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
void main(){
  vec4 c = texture(uScene, vUV);
  vec3 bg = uUseBgTex > .5 ? texture(uBgTex, vUV).rgb : mix(uBgBottom, uBgTop, vUV.y);
  vec3 col = c.a > 1e-4 ? pvToSRGB(pvNeutral(c.rgb / c.a)) : bg;
  vec3 r = mix(bg, col, smoothstep(uEdgeLo, uEdgeHi, c.a));
  if (uUseFront > .5) { vec4 f = texture(uFront, vUV); r = mix(r, f.rgb, f.a); }
  o = vec4(r, 1.);
}`;

export class OilStrokeFilter {
  private gl: WebGL2RenderingContext;
  private rt: THREE.WebGLRenderTarget;
  private prog: WebGLProgram;
  private u = new Map<string, WebGLUniformLocation | null>();
  private vao: WebGLVertexArrayObject;
  private out = document.createElement("canvas");
  private line = document.createElement("div");
  private fx: OilStroke;
  private applied = "";

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    private cfg: OilCfg,
    private bg: { top: string; bottom: string },
    private bgImage: () => THREE.Texture | null,
    private edge: { lo: number; hi: number },
    private frontImage: () => THREE.Texture | null = () => null,
  ) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    const gl = this.gl;
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    const p = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS_SOURCE]] as const) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("oil source shader: " + gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    this.prog = p;
    this.vao = gl.createVertexArray()!;
    renderer.resetState();
    // 필터 결과 캔버스: 우리 캔버스 위에 같은 크기로, 터치는 아래로 통과
    this.out.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;display:block";
    this.line.style.cssText = "position:fixed;top:0;bottom:0;width:2px;margin-left:-1px;background:#fff;pointer-events:none;z-index:2;display:none";
    document.getElementById("app")!.after(this.out, this.line);
    this.fx = new OilStroke(this.out);
  }

  private U(name: string): WebGLUniformLocation | null {
    if (!this.u.has(name)) this.u.set(name, this.gl.getUniformLocation(this.prog, name));
    return this.u.get(name)!;
  }

  private glTex(t: THREE.Texture): WebGLTexture | null {
    return (this.renderer.properties.get(t) as { __webglTexture?: WebGLTexture }).__webglTexture ?? null;
  }

  /** 유화가 꺼지면 결과 캔버스를 숨김 */
  hide(): void {
    this.out.style.display = "none";
    this.line.style.display = "none";
  }

  render(): void {
    const r = this.renderer, gl = this.gl;
    const cw = gl.drawingBufferWidth, ch = gl.drawingBufferHeight;
    // 1) 장면 → HalfFloat
    if (this.rt.width !== cw || this.rt.height !== ch) this.rt.setSize(cw, ch);
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.scene, this.camera);
    r.setRenderTarget(null);
    const bgT = this.bgImage(), frT = this.frontImage();
    if (bgT) r.initTexture(bgT);
    if (frT) r.initTexture(frT);
    const units: [string, WebGLTexture | null][] = [
      ["uScene", this.glTex(this.rt.texture)],
      ["uBgTex", bgT ? this.glTex(bgT) : null],
      ["uFront", frT ? this.glTex(frT) : null],
    ];
    // 2) 필터 입력 화면을 우리 캔버스에
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.CULL_FACE);
    gl.colorMask(true, true, true, true);
    gl.useProgram(this.prog);
    units.forEach(([name, t], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(this.U(name), i);
    });
    const hx = (h: string): [number, number, number] => {
      const n = parseInt(h.replace("#", ""), 16);
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    };
    gl.uniform3f(this.U("uBgTop"), ...hx(this.bg.top));
    gl.uniform3f(this.U("uBgBottom"), ...hx(this.bg.bottom));
    gl.uniform1f(this.U("uUseBgTex"), units[1][1] ? 1 : 0);
    gl.uniform1f(this.U("uUseFront"), units[2][1] ? 1 : 0);
    gl.uniform1f(this.U("uExposure"), r.toneMappingExposure);
    gl.uniform1f(this.U("uEdgeLo"), this.edge.lo);
    gl.uniform1f(this.U("uEdgeHi"), this.edge.hi);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    r.resetState();
    // 3) 모듈: 결과 크기(처리 해상도) · 값 · 비교 위치
    const c = this.cfg;
    const short = Math.min(Math.round(c.shortSide * (c.res || 1)), Math.min(cw, ch));
    const { w, h } = fitSize(cw, ch, short);
    const key = `${w}x${h}|${c.strength}|${c.size}|${c.boil}|${c.fps}|${c.grade}`;
    if (key !== this.applied) {
      if (this.out.width !== w || this.out.height !== h) {
        this.out.width = w;
        this.out.height = h;
      }
      this.fx.set({ strength: c.strength, size: c.size, boil: c.boil, fps: c.fps, grade: c.grade });
      this.applied = key;
    }
    this.out.style.display = "block";
    const sp = Math.min(1, Math.max(0, c.split || 0));
    this.out.style.clipPath = sp > 0 ? `inset(0 0 0 ${sp * 100}%)` : "";
    this.line.style.display = sp > 0 && sp < 1 ? "block" : "none";
    this.line.style.left = `${sp * 100}%`;
    // 같은 틀 안에서 바로 (브라우저가 화면에 내보낸 WebGL 캔버스는 비워짐 — 가이드 2번)
    this.fx.frame(r.domElement, performance.now() / 1000);
  }

  /** 마지막 그림 CPU 시간 (ms) */
  get lastMs(): number {
    return this.fx.ms;
  }

  dispose(): void {
    this.fx.dispose();
    this.rt.dispose();
    this.out.remove();
    this.line.remove();
  }
}
