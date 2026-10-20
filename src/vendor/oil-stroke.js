/* 유화 · 획 (세부 보존) — 단독 WebGL2 필터 모듈. 의존성 없음.
   재료 필터 갤러리(Recrude/nau-filter-gallery)의 메인 필터를 다른 웹에 붙이려고 떼어 낸 것이다. 쓰는 법은 oil-stroke-guide.md.

     import {OilStroke} from './oil-stroke.js';
     const fx = new OilStroke(canvas);          // 기본값: 강도 0.1 · 붓·코 크기 1.25 · 획 다시 그리기 0.1 · 초당 24장
     (function loop() { fx.frame(video, video.currentTime); requestAnimationFrame(loop); })();

   셰이더는 갤러리 public/index.html의 원문 그대로이고(아래 '셰이더' 구역), 그리는 순서도 갤러리 oil2f 경로와 같다.
   갤러리와 다른 점은 둘이다.
   - 입력은 뒤집지 않고 올리고 첫 단계에서 뒤집어 읽는다(ImageBitmap·VideoFrame은 UNPACK_FLIP_Y가 안 먹어서). 읽는 자리는 같다.
   - 크기: 갤러리 수치는 짧은 변 1080px 기준이다. 픽셀로 잰 값에는 sc = 짧은 변 / 1080을 곱하고 밉 단계에는 log2(sc)를 더해,
     결과 크기가 달라도 같은 그림이 되게 한다(Effect Lab v2.1의 룩 엔진과 같은 방식). 1080이면 갤러리와 픽셀 단위로 같다. */

// ---------- 셰이더 (갤러리 원문 그대로 — 고치지 말 것. 갤러리를 고쳤으면 다시 옮긴다) ----------
const VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));
out vec2 vUV;
void main(){ vec2 p = P[gl_VertexID]; vUV = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`;
const COMMON = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 o;
uniform vec2 uRes; uniform vec2 uTexel; uniform float uSeed; uniform float uBoil;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3 += dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+17.1; a*=.5; } return s; }
float lum(vec3 c){ return dot(c, vec3(.299,.587,.114)); }
// 떨림 비율만큼 '이 그림만의' 잡음을 섞는다 (평균 0)
vec2 boilOff(float salt){ return hash22(vec2(uSeed*1.37+salt, salt*7.1))*997.; }
float bn(vec2 p, float salt){
  float a = vnoise(p + vec2(salt*31.7, salt*17.3)) - .5;
  float b = vnoise(p + boilOff(salt)) - .5;
  return sqrt(1.-uBoil)*a + sqrt(uBoil)*b;
}
float bfbm(vec2 p, float salt){
  float a = fbm(p + vec2(salt*13.1, salt*5.7));
  float b = fbm(p + boilOff(salt));
  return mix(a, b, uBoil);
}
`;
const FS_GRADE = COMMON + `
uniform sampler2D uSrc; uniform float uAmt;
void main(){
  vec3 c = texture(uSrc, vUV).rgb;
  vec3 g = c*vec3(1.035,1.0,0.94);
  float l = lum(g); g = mix(vec3(l), g, 1.0);
  float k = 0.08; g = g*(1.+k)/(1.+k*g);
  g = mix(g, vec3(.15,.10,.07), .03);
  o = vec4(mix(c, g, uAmt), 1.);
}`;
const FS_SST = COMMON + `
uniform sampler2D uTex;
float L(vec2 d){ return lum(texture(uTex, vUV + d*uTexel).rgb); }
void main(){
  float tl=L(vec2(-1,1)), t=L(vec2(0,1)), tr=L(vec2(1,1));
  float l=L(vec2(-1,0)), r=L(vec2(1,0));
  float bl=L(vec2(-1,-1)), b=L(vec2(0,-1)), br=L(vec2(1,-1));
  float gx = (tr + 2.*r + br - tl - 2.*l - bl)*.25;
  float gy = (tl + 2.*t + tr - bl - 2.*b - br)*.25;
  o = vec4(gx*gx, gy*gy, gx*gy, 1.);
}`;
const FS_BLUR = COMMON + `
uniform sampler2D uTex; uniform vec2 uDir; uniform float uSigma;
void main(){
  vec4 s = vec4(0.); float ws = 0.; float R = ceil(2.*uSigma);
  for (int i=-12;i<=12;i++){ float fi=float(i); if (abs(fi)>R) continue;
    float w = exp(-fi*fi/(2.*uSigma*uSigma)); s += w*texture(uTex, vUV + fi*uDir); ws += w; }
  o = s/ws;
}`;
const FS_TFM = COMMON + `
uniform sampler2D uTex;
void main(){
  vec3 g = texture(uTex, vUV).xyz; float E=g.x, G=g.y, F=g.z;
  float disc = sqrt((E-G)*(E-G) + 4.*F*F);
  float l1 = .5*(E+G+disc), l2 = .5*(E+G-disc);
  vec2 t = vec2(l1 - E, -F);
  t = length(t) > 1e-9 ? normalize(t) : vec2(0.,1.);
  float A = (l1+l2) > 1e-9 ? (l1-l2)/(l1+l2) : 0.;
  float str = (E+G)/(E+G+4e-5);
  float w = clamp(A*str*1.3, 0., 1.);
  vec2 d = vec2(cos(1.0472), sin(1.0472));              // 평평한 곳의 기본 붓 방향 60도
  vec2 t2 = vec2(t.x*t.x - t.y*t.y, 2.*t.x*t.y), d2 = vec2(d.x*d.x - d.y*d.y, 2.*d.x*d.y);
  vec2 m2 = mix(d2, t2, w);
  float ang = .5*atan(m2.y, m2.x);
  o = vec4(cos(ang), sin(ang), ang, A*str);
}`;
const SBR_HEAD = `#version 300 es
precision highp float; precision highp int;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+17.1; a*=.5; } return s; }
float lum(vec3 c){ return dot(c, vec3(.299,.587,.114)); }
`;
const VS_STROKE = SBR_HEAD + `
layout(location=0) in vec4 aS;                 // 중심 x,y (0~1), 난수 2개
uniform sampler2D uGrade, uTFM, uCanvas;
uniform vec2 uRes;
uniform float uLen, uWid, uLod, uDetMin, uAng, uHiCut, uJit, uErrT, uCell;
uniform int uMedium;                            // 1 유화, 2 수채, 3 빗금, 4 윤곽
out vec2 vSt; out vec3 vCol; out float vR;
const int NSEG = 6;
void main(){
  int sec = gl_VertexID / 2; float side = (gl_VertexID % 2 == 0) ? -1. : 1.;
  vec2 c = aS.xy;
  bool keep = true;
  if (uErrT > 0.) {                                              // 보완 층 (Hertzmann 1998): 칸의 평균 오차가 문턱을 넘을 때만, 최대 오차 지점에 칠한다
    float sum = 0., best = -1.; vec2 bc = c;
    for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++){
      vec2 q = c + vec2(float(i), float(j))*uCell*.4/uRes;
      float e = length(textureLod(uGrade, q, uLod).rgb - texture(uCanvas, q).rgb);
      sum += e; if (e > best) { best = e; bc = q; }
    }
    if (sum/9. < uErrT) keep = false;
    c = bc;
  }
  vec3 col = textureLod(uGrade, c, uLod).rgb;
  float det = abs(lum(textureLod(uGrade, c, uLod).rgb) - lum(textureLod(uGrade, c, uLod + 2.5).rgb));
  if (uDetMin > 0. && det < uDetMin) keep = false;              // 세밀한 곳에만 가는 붓
  vec2 dir0 = texture(uTFM, c).xy;
  if (uMedium == 2 && lum(col) > uHiCut) keep = false;          // 수채: 가장 밝은 곳은 종이를 남긴다
  if (uMedium == 3) {                                            // 빗금: 어두운 곳일수록 많이
    float a = uAng + (aS.z - .5)*.22; dir0 = vec2(cos(a), sin(a));
    float dark = 1. - lum(col);
    float need = (uAng < 0. ? .42 : .08) + aS.w*.32;
    if (dark < need) keep = false;
    col = clamp(pow(col, vec3(1.25))*.95, 0., 1.);
  }
  if (uMedium == 5) {                                            // 색연필: 형태를 따라가는 가는 획, 어두울수록 촘촘
    float dark = 1. - lum(col);
    if (aS.w > .35 + dark*1.1) keep = false;
    col = clamp(pow(col, vec3(1.12)), 0., 1.);
  }
  if (uMedium == 4) {                                            // 윤곽: 형태 경계를 따라 짧은 선
    float e = texture(uTFM, c).w;
    if (e < .45 + aS.w*.35) keep = false;
    col = mix(vec3(.14,.12,.11), col*.35, .35);
  }
  if (!keep) { gl_Position = vec4(2., 2., 2., 1.); return; }
  float t = float(sec)/float(NSEG) - .5;
  float L = uLen*(.75 + .5*aS.z), W = uWid*(.8 + .4*aS.w);
  vec2 p = c*uRes;
  float target = t*L, dist = abs(target), sgn = target < 0. ? -1. : 1.;
  vec2 dcur = dir0*sgn; float trav = 0.; float stepL = L/float(NSEG);
  for (int k=0; k<NSEG; k++){
    if (trav >= dist - 1e-3) break;
    float s = min(stepL, dist - trav);
    vec2 nd = (uMedium == 3) ? dir0*sgn : texture(uTFM, p/uRes).xy;
    if (uMedium == 5) nd = normalize(nd + vec2(.35, .35)*sign(dot(nd, vec2(.7,.7)) + 1e-4));   // 손 방향 쪽으로 살짝 기운다
    if (dot(nd, dcur) < 0.) nd = -nd;
    dcur = normalize(mix(dcur, nd, .7));
    p += dcur*s; trav += s;
  }
  vec2 tang = dist < 1e-3 ? dir0 : dcur*sgn;
  vec2 nrm = vec2(-tang.y, tang.x);
  float taper = mix(.55, 1., 1. - pow(abs(t)*2., 2.));
  p += nrm*side*W*.5*taper;
  gl_Position = vec4(p/uRes*2. - 1., 0., 1.);
  vSt = vec2(t + .5, side);
  vCol = clamp(col*(1. + (aS.z - .5)*uJit*2.)*vec3(1. + (aS.w - .5)*uJit, 1., 1. - (aS.w - .5)*uJit), 0., 1.);
  vR = aS.z*37.1 + aS.w*11.3;
}`;
const FS_STROKE = SBR_HEAD + `
in vec2 vSt; in vec3 vCol; in float vR;
uniform int uMedium; uniform float uOpacity, uLen, uWid, uSeedF;
layout(location=0) out vec4 oC; layout(location=1) out vec4 oH;
void main(){
  float u = vSt.x, av = abs(vSt.y);
  float endFade = smoothstep(0., .12, u)*smoothstep(1., .88, u);
  float a; vec3 col = vCol; float h = .5;
  if (uMedium == 1) {                                            // 유화: 붓털 홈이 길이 방향으로
    float bris = vnoise(vec2(u*uLen/2.2, vSt.y*uWid*.45 + vR*13.));
    float edge = 1. - smoothstep(.72, 1., av + (bris - .5)*.4);
    a = edge*smoothstep(0., .06, u)*smoothstep(1., .9, u);
    a *= mix(1., step(.38, bris), smoothstep(.7, 1., u));       // 붓 끝에서 물감이 갈라진다
    col *= .92 + .16*bris;
    h = .3 + .6*bris*edge;
  } else if (uMedium == 2) {                                     // 수채: 반투명 칠, 가장자리에 물감이 고인다
    float wob = vnoise(vec2(u*uLen/16., vR)) - .5;
    float e = av + wob*.4;
    float body = 1. - smoothstep(.78, 1., e);
    float rim = smoothstep(.5, .9, e)*body;
    a = uOpacity*body*(1. + 1.3*rim)*endFade;
    col *= 1. - .2*rim;
  } else {                                                       // 연필: 가는 선 + 종이 결
    float core = 1. - smoothstep(.2, 1., av);
    float pressure = mix(.45, 1., sin(3.1416*u));
    float tooth = smoothstep(.22, .7, vnoise(gl_FragCoord.xy/1.15 + uSeedF*17.));
    a = uOpacity*core*pressure*tooth;
  }
  a = clamp(a, 0., 1.);
  oC = vec4(col, a); oH = vec4(vec3(h), a);
}`;
const FS_UNDER = SBR_HEAD + `
in vec2 vUV;
uniform sampler2D uGrade; uniform int uMedium;
layout(location=0) out vec4 oC; layout(location=1) out vec4 oH;
void main(){
  vec3 b = textureLod(uGrade, vUV, 4.5).rgb;
  vec3 paper = (uMedium == 3 || uMedium == 5) ? vec3(.955,.93,.865) : vec3(.975,.965,.94);
  vec3 c = uMedium == 1 ? b : mix(paper, b, uMedium == 2 ? .16 : (uMedium == 5 ? .3 : .1));
  oC = vec4(c, 1.); oH = vec4(.5, .5, .5, 1.);
}`;
const FS_COMPOSE = SBR_HEAD + `
in vec2 vUV; out vec4 o;
uniform sampler2D uPaint, uHgt, uGrade, uSrc;
uniform vec2 uRes, uTexel; uniform int uMedium; uniform float uStr, uSplit, uFlick, uSeedF;
vec2 px(){ return vUV*uRes; }
float xdog(vec2 uv, float lo, float hi){
  float g1 = lum(textureLod(uGrade, uv, lo).rgb), g2 = lum(textureLod(uGrade, uv, hi).rgb);
  return 1. - smoothstep(-.035, 0., g1 - .985*g2);
}
void main(){
  vec2 uv = vUV;
  vec3 c = texture(uPaint, uv).rgb;
  if (uMedium == 1) {
    float h0 = texture(uHgt, uv).r, hx = texture(uHgt, uv + vec2(uTexel.x, 0.)).r, hy = texture(uHgt, uv + vec2(0., uTexel.y)).r;
    vec3 n = normalize(vec3((h0 - hx)*6.*uStr, (h0 - hy)*6.*uStr, 1.));
    vec3 Ld = normalize(vec3(-.5, .65, .8));
    float diff = dot(n, Ld), spec = pow(max(dot(reflect(-Ld, n), vec3(0.,0.,1.)), 0.), 22.)*.1*uStr;
    c = c*(.84 + .26*diff) + spec;
    vec2 q = px()/4.6;
    c *= 1. + .02*uStr*sin(q.x*6.2832)*sin(q.y*6.2832);
  } else if (uMedium == 2) {
    vec3 paper = vec3(.975,.965,.94);
    float dens = clamp(1. - lum(c)/lum(paper), 0., 1.);
    float valley = 1. - fbm(px()/5.5);                            // 종이 골
    float gran = vnoise(px()/2.8 + uSeedF*31.);
    c *= 1. - dens*uStr*(.22*valley + .12*(gran - .5));            // 안료가 종이 골에 가라앉는다
    float l0 = lum(c), l1 = lum(textureLod(uPaint, uv, 2.).rgb);
    c *= 1. - clamp((l1 - l0)*2.2, 0., .22)*uStr;                  // 칠 경계를 한 번 더 진하게
    float line = xdog(uv, .4, 2.);
    c = mix(c, c*.8, line*.28*uStr);                               // 연필 밑그림
    c *= 1. - .045*uStr*valley;
  } else {
    float tooth = vnoise(px()/1.3);
    c *= .975 + .04*tooth;
    if (uMedium == 5) {
      float line = xdog(uv, .3, 1.7);
      c = mix(c, c*.45, line*.55*uStr);                             // 흑연 윤곽선
    }
  }
  vec2 d = vUV - .5; c *= (1. - .12*dot(d,d)*2.)*uFlick;
  if (vUV.x < uSplit) c = texture(uSrc, vUV).rgb;
  if (abs(vUV.x - uSplit) < uTexel.x*1.5 && uSplit > 0.) c = vec3(1.);
  o = vec4(clamp(c, 0., 1.), 1.);
}`;

// 입력을 뒤집어 읽는 색 보정 (갤러리 FS_GRADE에서 읽는 자리만 뒤집음)
const FS_GRADE_IN = FS_GRADE.replace('texture(uSrc, vUV)', 'texture(uSrc, vec2(vUV.x, 1. - vUV.y))');
if (FS_GRADE_IN === FS_GRADE) throw Error('oil-stroke: FS_GRADE가 바뀌어 입력 뒤집기를 넣지 못했습니다.');

// ---------- 필터 정의 (갤러리 프리셋 oil2f) ----------
// 층: [굵기px, 간격px, 길이px, 색 밉 단계, 세부 문턱, 불투명도] — 굵은 붓에서 가는 붓 순서. 짧은 변 1080px 기준.
const LAYERS = [[36, 15, 84, 3.8, 0, 1], [18, 8, 44, 2.6, .02, 1], [8, 4, 20, 1.4, .06, 1]];
// 보완 층 (Hertzmann 1998): 칠한 결과가 원본과 많이 다른 칸(눈 하이라이트·입선 등)에만 가는 붓. [굵기, 칸 간격, 길이, 기준 밉 단계, 오차 문턱]
const REFINE = [3.5, 3, 10, 0.6, 0.22];
const BASE = 1080;

/** 기본값 = 10/15 사용자가 고른 세팅 */
export const DEFAULTS = Object.freeze({
  strength: 0.1,   // 강도: 물감 두께(붓 자국 요철·광택·캔버스 결)와 획 색 흔들림. 0이면 평평, 1이면 갤러리 처음 값
  size: 1.25,      // 붓·코 크기: 붓 굵기·간격·길이 배율
  boil: 0.1,       // 획 다시 그리기: 그림이 바뀔 때 새 자리에 놓는 획의 비율 (0 = 고정, 1 = 전부 새로)
  fps: 24,         // 초당 그림: 1초에 그림을 몇 장 새로 그릴지 (frame()에서만 씀)
  grade: 1,        // 색 보정: 따뜻한 쪽으로 살짝 당기는 정도 (0 = 원본 색)
});

function ihash(a, b, c) {                     // 정수 → 0~1, 같은 입력이면 항상 같은 값
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// 획 목록: 칸마다 획 하나(칸 안에서 위치를 흔들고, 그리는 순서는 섞는다). boil 비율만큼은 그림마다 새 위치를 쓴다.
// 그림과 상관없는 '고정 획'은 한 번만 만들어 정렬해 두고, 그림마다 바뀌는 획만 새로 만들어 정렬한 뒤 합친다
// (전부 다시 만들면 1080p에서 25만 개라 85ms가 넘는다). 결과는 전부 다시 만든 것과 같다 — 갤러리 makeStrokes와 같은 계산.
function makeStrokes(cache, li, spacing, W, H, seed, boil) {
  const gw = Math.ceil(W / spacing), gh = Math.ceil(H / spacing), n = gw * gh, base = 1000 + li * 97;
  const put = (i, sd, d, o) => {
    d[o] = (i % gw + ihash(i, sd, 2)) * spacing / W; d[o + 1] = (Math.floor(i / gw) + ihash(i, sd, 3)) * spacing / H;
    d[o + 2] = ihash(i, sd, 4); d[o + 3] = ihash(i, sd, 5);
    return Math.fround(ihash(i, sd, 6));
  };
  const ck = `${li}|${spacing}|${W}|${H}|${boil}`;
  let C = cache.get(ck);
  if (!C) {
    const fixed = [], vary = [];
    for (let i = 0; i < n; i++) (ihash(i, base, 1) >= boil ? fixed : vary).push(i);
    const m = fixed.length, d = new Float32Array(m * 4), k = new Float32Array(m), ord = new Uint32Array(m);
    for (let j = 0; j < m; j++) { k[j] = put(fixed[j], base, d, j * 4); ord[j] = j; }
    ord.sort((a, b) => k[a] - k[b] || a - b);
    const F = {data: new Float32Array(m * 4), key: new Float32Array(m), id: new Uint32Array(m)};
    for (let j = 0; j < m; j++) {
      const s = ord[j]; F.key[j] = k[s]; F.id[j] = fixed[s];
      for (let c = 0; c < 4; c++) F.data[j * 4 + c] = d[s * 4 + c];
    }
    C = {F, vary: Uint32Array.from(vary), out: new Float32Array(n * 4)};
    cache.set(ck, C);
    if (cache.size > 16) cache.delete(cache.keys().next().value);
  }
  const {F, vary, out} = C, m = vary.length;
  if (!m) return {data: F.data, n};
  const sd = base + (seed + 1) * 7919, vd = new Float32Array(m * 4), vk = new Float32Array(m), vo = new Uint32Array(m);
  for (let j = 0; j < m; j++) { vk[j] = put(vary[j], sd, vd, j * 4); vo[j] = j; }
  vo.sort((a, b) => vk[a] - vk[b] || a - b);
  for (let a = 0, b = 0, o = 0; o < n; o++) {
    const useF = b >= m || (a < F.key.length && (F.key[a] < vk[vo[b]] || (F.key[a] === vk[vo[b]] && F.id[a] < vary[vo[b]])));
    if (useF) { for (let c = 0; c < 4; c++) out[o * 4 + c] = F.data[a * 4 + c]; a++; }
    else { const s = vo[b]; for (let c = 0; c < 4; c++) out[o * 4 + c] = vd[s * 4 + c]; b++; }
  }
  return {data: out, n};
}

export class OilStroke {
  /** canvas: 결과를 그릴 캔버스(이 캔버스의 width·height가 결과 크기). params: DEFAULTS 중 바꿀 것 */
  constructor(canvas, params = {}) {
    const gl = canvas.getContext('webgl2', {preserveDrawingBuffer: true, antialias: false});
    if (!gl) throw Error('WebGL2를 쓸 수 없는 브라우저입니다.');
    this.canvas = canvas; this.gl = gl;
    this.params = {...DEFAULTS, ...params};
    this.floatOk = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    this.vao = gl.createVertexArray();
    const c = (fs, vs = VS) => this._compile(fs, vs);
    this.PR = {grade: c(FS_GRADE_IN), sst: c(FS_SST), blur: c(FS_BLUR), tfm: c(FS_TFM),
      under: c(FS_UNDER), stroke: c(FS_STROKE, VS_STROKE), compose: c(FS_COMPOSE)};
    this.strokeVAO = gl.createVertexArray(); this.strokeBuf = gl.createBuffer();
    gl.bindVertexArray(this.strokeVAO); gl.bindBuffer(gl.ARRAY_BUFFER, this.strokeBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(0, 1);
    gl.bindVertexArray(null);
    this.src = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.src);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    this.T = null; this.cache = new Map();
    this.tick = null; this.dirty = true; this.seed = 0; this.ms = 0;
  }

  /** 값 바꾸기 — 다음 frame()에서 다시 그린다 */
  set(params) { Object.assign(this.params, params); this.dirty = true; }

  /** 시각 t(초)에 맞춰 필요할 때만 그린다: 그림 번호 = floor(t × 초당 그림)이 바뀌었거나 값이 바뀌었을 때.
      영상이면 t = video.currentTime, 실시간 장면이면 t = performance.now() / 1000. 그렸으면 true. */
  frame(source, t) {
    const tick = Math.floor(t * this.params.fps + 1e-6);
    if (tick === this.tick && !this.dirty) return false;
    this.tick = tick; this.dirty = false;
    this.render(source, tick % 997);
    return true;
  }

  /** 지금 바로 한 장 그린다. source: 영상·이미지·캔버스·ImageBitmap·VideoFrame. seed: 그림 번호(같으면 같은 그림) */
  render(source, seed = 0) {
    const gl = this.gl, PR = this.PR, P = this.params, W = this.canvas.width, H = this.canvas.height, t0 = performance.now();
    const T = this._alloc(W, H), sc = Math.min(W, H) / BASE, sz = P.size * sc, lodShift = Math.log2(sc);
    this.seed = seed;
    gl.bindTexture(gl.TEXTURE_2D, this.src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    // 1) 색 보정 → 2) 형태 방향(구조 텐서 → 흐림 → 방향장) → 3) 획 칠 → 4) 물감 두께·광택 합성
    this._pass(PR.grade, T.grade, {uSrc: this.src}, {uAmt: P.grade});
    const sg = Math.max(1, 2.5 * sc);
    this._pass(PR.sst, T.sst, {uTex: T.grade});
    this._pass(PR.blur, T.sst2, {uTex: T.sst}, {uDir: [1 / T.sst.w, 0], uSigma: sg});
    this._pass(PR.blur, T.sst, {uTex: T.sst2}, {uDir: [0, 1 / T.sst.h], uSigma: sg});
    this._pass(PR.tfm, T.tfm, {uTex: T.sst});
    this._paint(T, sz, lodShift);
    this._pass(PR.compose, null, {uPaint: T.paint, uHgt: T.hgt, uGrade: T.grade, uSrc: this.src},
      {uMedium: 1, uStr: P.strength, uSplit: 0, uFlick: 1, uSeedF: seed % 97});
    this.ms = performance.now() - t0;                 // CPU에서 명령을 넘기는 데 든 시간 (GPU 시간은 아님)
  }

  /** 다 쓴 뒤 GPU 자원 돌려주기 */
  dispose() {
    const gl = this.gl;
    this._free();
    for (const p of Object.values(this.PR)) gl.deleteProgram(p.p);
    gl.deleteBuffer(this.strokeBuf); gl.deleteVertexArray(this.strokeVAO); gl.deleteVertexArray(this.vao); gl.deleteTexture(this.src);
    this.cache.clear();
  }

  // ---------- 안쪽 ----------
  _paint(T, sz, lodShift) {
    const gl = this.gl, PR = this.PR, P = this.params, W = T.W, H = T.H, U = (p, n) => this._U(p, n), med = 1;
    const lod = l => Math.max(0, l + lodShift);
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.mrt); gl.viewport(0, 0, W, H);
    gl.useProgram(PR.under.p);                        // 밑칠: 크게 흐린 색
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.grade.t); gl.uniform1i(U(PR.under, 'uGrade'), 0);
    gl.uniform1i(U(PR.under, 'uMedium'), med);
    gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const pr = PR.stroke; gl.useProgram(pr.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.grade.t); gl.uniform1i(U(pr, 'uGrade'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, T.tfm.t); gl.uniform1i(U(pr, 'uTFM'), 1);
    gl.uniform2f(U(pr, 'uRes'), W, H); gl.uniform1f(U(pr, 'uSeedF'), this.seed % 97);
    gl.uniform1f(U(pr, 'uHiCut'), 0.86); gl.uniform1f(U(pr, 'uJit'), 0.05 * P.strength);
    gl.bindVertexArray(this.strokeVAO);
    LAYERS.forEach(([wid, sp, len, l, det, opa], li) => {   // 굵은 붓 → 가는 붓
      const {data, n} = makeStrokes(this.cache, li, sp * sz, W, H, this.seed, P.boil);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.strokeBuf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.uniform1i(U(pr, 'uMedium'), med);
      gl.uniform1f(U(pr, 'uLen'), len * sz); gl.uniform1f(U(pr, 'uWid'), wid * sz);
      gl.uniform1f(U(pr, 'uLod'), lod(l)); gl.uniform1f(U(pr, 'uDetMin'), det);
      gl.uniform1f(U(pr, 'uOpacity'), opa); gl.uniform1f(U(pr, 'uAng'), 0); gl.uniform1f(U(pr, 'uErrT'), 0);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 14, n);
    });
    {                                                 // 보완 층: 지금까지의 칠을 사본으로 떠서 원본과 비교한다
      const [wid, sp, len, l, errT] = REFINE;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, T.paint.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, T.paintC.fb);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.mrt); gl.viewport(0, 0, W, H);
      gl.useProgram(pr.p);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, T.paintC.t); gl.uniform1i(U(pr, 'uCanvas'), 2);
      const {data, n} = makeStrokes(this.cache, LAYERS.length, sp * sz, W, H, this.seed, P.boil);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.strokeBuf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.uniform1i(U(pr, 'uMedium'), med);
      gl.uniform1f(U(pr, 'uLen'), len * sz); gl.uniform1f(U(pr, 'uWid'), wid * sz);
      gl.uniform1f(U(pr, 'uLod'), lod(l)); gl.uniform1f(U(pr, 'uDetMin'), 0); gl.uniform1f(U(pr, 'uOpacity'), 1);
      gl.uniform1f(U(pr, 'uErrT'), errT); gl.uniform1f(U(pr, 'uCell'), sp * sz);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 14, n);
    }
    gl.disable(gl.BLEND);
    gl.bindTexture(gl.TEXTURE_2D, T.paint.t); gl.generateMipmap(gl.TEXTURE_2D);
  }

  _compile(fs, vs) {
    const gl = this.gl, p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error('oil-stroke 셰이더: ' + gl.getShaderInfoLog(s));
      gl.attachShader(p, s); gl.deleteShader(s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error('oil-stroke 셰이더: ' + gl.getProgramInfoLog(p));
    return {p, u: {}};
  }
  _U(prog, name) { if (!(name in prog.u)) prog.u[name] = this.gl.getUniformLocation(prog.p, name); return prog.u[name]; }

  _tex(w, h, {float = false, mip = false} = {}) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    const levels = mip ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, float && this.floatOk ? gl.RGBA16F : gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return {t, fb, w, h, mip};
  }
  /** 갤러리 allocate()의 oil2f에 필요한 작업 텍스처만. 크기가 바뀔 때만 다시 만든다. */
  _alloc(W, H) {
    if (this.T && this.T.W === W && this.T.H === H) return this.T;
    this._free();
    const gl = this.gl, fw = Math.round(W / 2), fh = Math.round(H / 2);
    const T = {W, H, grade: this._tex(W, H, {mip: true}),
      sst: this._tex(fw, fh, {float: true}), sst2: this._tex(fw, fh, {float: true}), tfm: this._tex(fw, fh, {float: true}),
      paint: this._tex(W, H, {mip: true}), hgt: this._tex(W, H), paintC: this._tex(W, H)};
    T.mrt = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, T.mrt);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, T.paint.t, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, T.hgt.t, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.dirty = true;
    return (this.T = T);
  }
  _free() {
    const gl = this.gl, T = this.T;
    if (!T) return;
    for (const v of Object.values(T)) if (v && v.t) { gl.deleteTexture(v.t); gl.deleteFramebuffer(v.fb); }
    gl.deleteFramebuffer(T.mrt);
    this.T = null;
  }
  _pass(prog, target, texs, uni) {
    const gl = this.gl;
    gl.useProgram(prog.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    const w = target ? target.w : this.canvas.width, h = target ? target.h : this.canvas.height;
    gl.viewport(0, 0, w, h);
    let unit = 0;
    for (const [name, t] of Object.entries(texs)) {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t.t || t); gl.uniform1i(this._U(prog, name), unit); unit++;
    }
    gl.uniform2f(this._U(prog, 'uRes'), w, h); gl.uniform2f(this._U(prog, 'uTexel'), 1 / w, 1 / h);
    gl.uniform1f(this._U(prog, 'uSeed'), this.seed); gl.uniform1f(this._U(prog, 'uBoil'), this.params.boil);
    for (const [name, v] of Object.entries(uni || {})) {
      const loc = this._U(prog, name);
      if (Array.isArray(v)) (v.length === 2 ? gl.uniform2fv : gl.uniform3fv).call(gl, loc, v);
      else if (name === 'uMedium') gl.uniform1i(loc, v);
      else gl.uniform1f(loc, v);
    }
    gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (target && target.mip) { gl.bindTexture(gl.TEXTURE_2D, target.t); gl.generateMipmap(gl.TEXTURE_2D); }
  }
}

/** 소스 크기에 맞춘 결과 크기 — 짧은 변을 short px로 (짝수). 예: fitSize(1080, 1918, 720) → {w: 720, h: 1278} */
export function fitSize(srcW, srcH, short = 1080) {
  const sc = short / Math.min(srcW, srcH);
  return {w: Math.round(srcW * sc / 2) * 2, h: Math.round(srcH * sc / 2) * 2};
}
