/**
 * 푸빌라 셰이더 조각.
 * - 입은 메쉬에 조형된 홈을 쓴다 (mouthRig.ts: aCavity=홈 안쪽 → 어둡게, aLip=입술 근처 → 털 짧게).
 * - 볼터치·눈썹(가이드북 2.3 Expressions 의 강한 표정에서만)은 메쉬에 없어서 표면에 SDF 로 그린다.
 *   좌표는 OBJ 원본(cm, 정면 +z) 의 rest 위치를 xy 평면에 투영 → 스키닝을 따라 같이 움직인다.
 * - 털은 가이드북 2.4 (C4D Ornatrix, #F2F2F2, roughness 0.6) 를 셸 텍스처링으로 근사.
 */
import * as THREE from "three";

export const COMMON_GLSL = /* glsl */ `
varying vec3 vRest;
varying vec3 vRestN;
varying float vCavity;
varying vec3 vMouthIn;
`;

export const FACE_GLSL = /* glsl */ `
uniform vec4 uBlushA;   // x, y, radius, amount
uniform vec4 uBrowA;    // browUp(-1~1), alpha, offsetY, length
uniform vec4 uEyeA;     // eyeX, eyeY, lineCm, unused
uniform vec3 uInkColor;
uniform vec3 uBlushColor;
uniform vec4 uMouthL;   // 입선: y0, 휨 k, 반폭, 굵기(cm)
uniform vec4 uMouthO;   // 'o' 입: 중심 y, 반폭 x, 반높이 y, 알파
uniform float uMouthLineA; // 입선 알파 (입을 벌리면 사라짐)
uniform float uMouthProjYaw; // 'o' 입을 관객 쪽으로 돌려 그리는 각(rad) — 옆모습에서 찌그러지지 않게

float pvSdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

float pvLine(float d, float th) {
  float aa = max(fwidth(d), 1e-4);
  return 1.0 - smoothstep(th * 0.5 - aa, th * 0.5 + aa, d);
}

// 입 (가이드북 3D 렌더 44~52장): 매끈한 털 표면 위 가는 먹선뿐.
//   미소 '‿' / 시무룩 '︵' = 포물선 y = y0 + k·x² (끝으로 갈수록 가늘게)
//   노래·놀람 'o' = 작은 세로 타원
float pvMouthInk() {
  if (vRestN.z < 0.05 || vRest.z < 20.0) return 0.0;
  vec2 q = vRest.xy - vec2(0.0, uMouthL.x);
  float ink = 0.0;
  if (uMouthLineA > 0.01) {
    float hw = uMouthL.z, k = uMouthL.y;
    float ax = abs(q.x);
    float t = clamp(ax / hw, 0.0, 1.0);
    // 가이드 3D: 굵기가 거의 일정하고 끝이 둥근 끈 같은 선
    float th = uMouthL.w * mix(1.0, 0.85, t * t);
    float d = ax > hw ? length(vec2(ax - hw, q.y - k * hw * hw))
                      : abs(q.y - k * q.x * q.x) / sqrt(1.0 + 4.0 * k * k * q.x * q.x);
    ink = uMouthLineA * pvLine(d, th);
  }
  if (uMouthO.w > 0.01) {
    vec3 r0 = vRest - vec3(0.0, uMouthO.x, 45.0);
    float ca = cos(uMouthProjYaw), sa = sin(uMouthProjYaw);
    vec2 qo = vec2(r0.x * ca - r0.z * sa, r0.y);
    vec2 e = qo / uMouthO.yz;
    float r = length(e);
    float aa = max(fwidth(r), 1e-3);
    ink = max(ink, uMouthO.w * (1.0 - smoothstep(1.0 - aa, 1.0 + aa, r)));
  }
  return ink;
}

// 감은 눈: 3D 가이드(지휘자 포즈)처럼 털 표면 위 가늘고 끝이 가늘어지는 '‿' 곡선
float pvClosedEye(vec3 c, vec3 axis, float amt) {
  if (amt < 0.01 || uClosedEye.w <= 0.0) return 0.0;
  vec3 d = vRest - c;
  if (dot(d, d) > 25.0) return 0.0;
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), axis));
  vec3 up = cross(axis, right);
  float u = dot(d, right), v = dot(d, up) + uClosedEye.z;
  float hw = uClosedEye.x, k = uClosedEye.y;
  float au = abs(u);
  float t = clamp(au / hw, 0.0, 1.0);
  float th = uClosedEye.w * mix(1.0, 0.9, t * t); // 끝이 둥근 짧은 끈 '‿' (가이드 45·46·50장)
  float dist = au > hw ? length(vec2(au - hw, v - k * hw * hw)) : abs(v - k * u * u) / sqrt(1.0 + 4.0 * k * k * u * u);
  float aa = max(fwidth(dist), 1e-3);
  return amt * (1.0 - smoothstep(th * 0.5 - aa, th * 0.5 + aa, dist));
}

// x: 잉크(검정) 알파, y: 볼터치 알파
vec2 pvFaceInk() {
  if (vRestN.z < 0.05 || vRest.z < 8.0 || vRest.y < 120.0) return vec2(0.0);
  vec2 p = vRest.xy;
  float ink = max(pvClosedEye(uEyeLPos, uEyeAxisL, smoothstep(0.5, 0.85, uEyeClose.x)),
                  pvClosedEye(uEyeRPos, uEyeAxisR, smoothstep(0.5, 0.85, uEyeClose.y)));
  ink = max(ink, pvMouthInk());

  // ── 눈썹: 평소엔 없음. 강할 때만 짧은 획 (가이드 '찡그림/당황' 시트) ──
  if (uBrowA.y > 0.0) {
    for (int i = 0; i < 2; i++) {
      float s = i == 0 ? 1.0 : -1.0;
      vec2 c = vec2(s * uEyeA.x, uEyeA.y + uBrowA.z + uBrowA.x * 0.9);
      float tilt = uBrowA.x * 0.8;
      vec2 inner = c + vec2(-s * uBrowA.w * 0.5, tilt);
      vec2 outer = c + vec2(s * uBrowA.w * 0.5, -tilt);
      ink = max(ink, uBrowA.y * pvLine(pvSdSegment(p, inner, outer), uEyeA.z));
    }
  }

  // ── 볼터치 ──
  float blush = 0.0;
  for (int i = 0; i < 2; i++) {
    float s = i == 0 ? 1.0 : -1.0;
    float r = length(p - vec2(s * uBlushA.x, uBlushA.y));
    blush = max(blush, uBlushA.w * (1.0 - smoothstep(uBlushA.z * 0.3, uBlushA.z, r)));
  }
  return vec2(ink, blush);
}
`;

export const FUR_GLSL = /* glsl */ `
uniform float uShellH;       // 0(뿌리)~1(끝)
uniform float uShellOffset;  // cm
uniform float uFurFreq;
uniform float uFurMin;   // 덩어리별 털 길이 들쭉날쭉 정도
uniform float uFurLean;  // 털 끝이 아래로 눕는 정도 (털 길이 대비)
uniform float uFurThick; // 털 가닥 뿌리 굵기 (가닥 간격 대비 반지름)
uniform float uFurBump;  // 털뭉치 음영 세기 (뭉치 높이 cm)
uniform float uFurTuftFreq; // 털뭉치 크기의 역수 (1/cm)
uniform float uRootShade;
uniform float uFaceFurScale;
uniform float uOldScarf;  // 1 = 서 있는 기존 메쉬(스카프 자리 털 없음), 0 = 앉은 새 메쉬
uniform vec3 uEyeLPos;
uniform vec3 uEyeRPos;
uniform vec3 uEyeAxisL;   // 눈이 바라보는 방향 (감은 눈 곡선을 이 방향 기준 평면에 그림)
uniform vec3 uEyeAxisR;
uniform vec2 uEyeClose;   // 0~1 감김 (L, R) — 감을수록 털이 눈 자리를 덮음
uniform vec4 uClosedEye;  // 반폭(cm), 휨, 아래로 오프셋(cm), 굵기(cm)
uniform vec3 uNosePos;
uniform vec3 uNoseHalf;   // 코 반폭·반높이·반두께 (cm) — 코 둘레 털 짧게
uniform vec2 uEyeClear;   // 눈 둘레 털 걷는 반경 (안, 바깥 cm)

float pvHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float pvNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(pvHash(i), pvHash(i + vec3(1, 0, 0)), f.x), mix(pvHash(i + vec3(0, 1, 0)), pvHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(pvHash(i + vec3(0, 0, 1)), pvHash(i + vec3(1, 0, 1)), f.x), mix(pvHash(i + vec3(0, 1, 1)), pvHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
// 털뭉치: 공간에 흩은 점마다 둥근 돔(부드러운 셀룰러 노이즈) — 솜뭉치·구름처럼 가운데 밝고 덩어리 사이 골은 살짝 어둡게.
// (값 노이즈 + 단순 해시는 큰 좌표에서 지문 같은 동심원 줄무늬가 생겼음)
vec3 pvHash3B(vec3 p) {
  return fract(sin(vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
}
// 반환: 0(덩어리 사이 골) ~ 1(덩어리 가운데)
float pvTuft(vec3 p) {
  vec3 q = p * uFurTuftFreq;
  vec3 b = floor(q - 0.5);
  float acc = 0.0;
  for (int k = 0; k < 8; k++) {
    vec3 c = b + vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
    vec3 r = pvHash3B(c);
    acc += exp(-5.0 * length(q - (c + 0.2 + 0.6 * r)));
  }
  float f1 = -log(max(acc, 1e-6)) / 5.0; // 가장 가까운 점까지 거리(부드럽게)
  // 원뿔(1-d)이 아니라 둥근 돔(1-d²) — 덩어리 가장자리가 부드럽게 말려 들어가게
  float d = f1 * 1.25;
  return clamp(1.0 - d * d, 0.0, 1.0);
}
// 털뭉치 음영 밝기 배율 (uFurBump = 세기)
float pvTuftShade(vec3 p, vec3 n) {
  float h = pvTuft(p);
  // 입체 음영: 높이장 기울기(표면 방향 성분)와 주광 방향 → 덩어리 윗면 밝게·아랫면 어둡게 (점무늬가 아니라 볼록한 덩어리로)
  float e = 0.18 / uFurTuftFreq;
  vec3 g = vec3(pvTuft(p + vec3(e, 0.0, 0.0)), pvTuft(p + vec3(0.0, e, 0.0)), pvTuft(p + vec3(0.0, 0.0, e))) - h;
  g -= n * dot(g, n);
  // 볼록면의 기울어진 법선 = -기울기 → 빛 쪽을 향한 면이 밝게 (부호를 반대로 하면 움푹 팬 자국처럼 보임)
  float lit = -dot(g, normalize(vec3(2.0, 3.0, 4.0))) / 0.18;
  float hs = h * h * (3.0 - 2.0 * h);
  // 어둡게는 거의 안 함 — 골을 어둡게 하면 회색 얼룩처럼 번져 피부병처럼 보임. 볼록한 쪽을 살짝 밝게만.
  return clamp(1.0 + uFurBump * (0.06 * (hs - 0.4) + 0.08 * lit), 0.98, 1.08);
}
vec3 pvHash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
// 가는 털 가닥: 셀(1/uFurFreq cm)마다 털 1가닥 — 위치·길이·굵기 무작위, 끝으로 갈수록 가늘어짐.
// h = 0(뿌리)~1(끝), clump = 이 자리 털 길이 배율, aa = 화면 1픽셀 폭(셀 단위). 반환 = 이 높이에서 털이 덮는 정도(0~1)
// 반환 x = 덮는 정도, y = 그 가닥의 밝기 편차(0~1)
vec2 pvStrands(vec3 p, float h, float clump, float aa, vec3 n, vec3 g, float lean) {
  vec3 base = floor(p - 0.5);
  float cov = 0.0, shade = 0.5;
  for (int k = 0; k < 8; k++) {
    vec3 c = base + vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
    vec3 r = pvHash3(c);
    float len = mix(0.3, 1.0, fract(r.x * 7.13 + r.z * 3.71)) * clump;
    if (h > len) continue;
    float t = h / len;
    float rad = mix(uFurThick, uFurThick * 0.2, t) * mix(0.7, 1.25, r.y);
    // 가닥마다 눕는 방향이 제각각 (아래쪽 경향만 약하게) — 빗질한 줄무늬가 아니라 보송한 플리스 느낌
    vec3 rd = pvHash3(c + 17.0) - 0.5;
    rd -= n * dot(rd, n);
    vec3 dir = normalize(rd + g * 0.35 + n * 1e-4);
    vec3 pt = c + 0.15 + 0.7 * r + dir * (t * t) * lean * len;
    float d = length(p - pt);
    float cv = 1.0 - smoothstep(rad - aa, rad + aa, d);
    if (cv > cov) {
      cov = cv;
      shade = r.z;
    }
  }
  return vec2(cov, shade);
}
`;

export const FUR_MASK_GLSL = /* glsl */ `
// 털 길이 마스크: 눈·코·입술 주변은 짧게, 얼굴 앞면은 uFaceFurScale, 스카프 안쪽은 0
float pvFurMask(vec3 p, vec3 n, float cavity, float lip, float cover) {
  float m = 1.0;
  // 눈 주변은 털을 걷어 눈알이 보이게 — 눈을 감으면 짧은 털이 눈 자리를 덮는다
  // (길게 덮으면 위에서·옆에서 볼 때 이마 털이 감은 눈 '‿' 선을 가려 들쭉날쭉해짐)
  float pvEyeL = smoothstep(uEyeClear.x, uEyeClear.y, distance(p, uEyeLPos)), pvEyeR = smoothstep(uEyeClear.x, uEyeClear.y, distance(p, uEyeRPos));
  float pvShortL = mix(uFaceFurScale, 1.0, smoothstep(3.0, 7.0, distance(p, uEyeLPos)));
  float pvShortR = mix(uFaceFurScale, 1.0, smoothstep(3.0, 7.0, distance(p, uEyeRPos)));
  m = min(m, mix(pvEyeL, pvShortL, uEyeClose.x));
  m = min(m, mix(pvEyeR, pvShortR, uEyeClose.y));
  // cover: 뜨개 목도리 밑(털 없음 — 안 그러면 목도리 사이로 흰 털이 삐져나옴)
  m *= (1.0 - cavity) * (1.0 - 0.7 * lip) * (1.0 - cover);
  // 코 가장자리까지 털이 살짝 덮이게 (가이드 렌더)
  // 코 둘레: 코 크기(반폭 5.6 · 반높이 3.6 · 반두께 1.7cm) 타원 기준 — 원형(3~6cm)이면 코 가장자리를 털이 덮었음
  // 넓게 걷으면(×1.7) 털이 짧아지는 경계가 코 아래 U자 그늘(수염처럼)로 보였음 → 코 테두리에서 바로 털이 차오르게
  float pvNose = length((p - uNosePos) / uNoseHalf);
  m = min(m, mix(0.15, 1.0, smoothstep(0.95, 1.2, pvNose)));
  float face = smoothstep(0.2, 0.6, n.z) * smoothstep(126.0, 132.0, p.y) * smoothstep(10.0, 22.0, p.z);
  // 주둥이(입 주변)는 털을 짧게 — 옆에서 볼 때 볼 털이 입 먹선을 가리지 않게
  float muzzle = (1.0 - smoothstep(7.0, 13.0, abs(p.x))) * (1.0 - smoothstep(5.0, 10.0, abs(p.y - 131.0))) * smoothstep(25.0, 35.0, p.z);
  face = max(face, muzzle);
  m *= mix(1.0, uFaceFurScale, face);
  float scarf = smoothstep(111.0, 115.0, p.y) * (1.0 - smoothstep(129.0, 133.0, p.y));
  m *= 1.0 - scarf * uOldScarf;
  float ribbon = step(-9.0, p.x) * step(p.x, 12.0) * smoothstep(98.0, 102.0, p.y) * step(p.y, 121.0) * step(18.0, p.z);
  m *= 1.0 - 0.85 * ribbon * uOldScarf;
  return m;
}
`;

export interface FaceUniforms {
  [k: string]: THREE.IUniform;
  uMouthL: THREE.IUniform<THREE.Vector4>;
  uMouthO: THREE.IUniform<THREE.Vector4>;
  uMouthLineA: THREE.IUniform<number>;
  uMouthProjYaw: THREE.IUniform<number>;
  uBlushA: THREE.IUniform<THREE.Vector4>;
  uBrowA: THREE.IUniform<THREE.Vector4>;
  uEyeA: THREE.IUniform<THREE.Vector4>;
  uInkColor: THREE.IUniform<THREE.Color>;
  uBlushColor: THREE.IUniform<THREE.Color>;
}

export interface FurUniforms {
  [k: string]: THREE.IUniform;
  uFurFreq: THREE.IUniform<number>;
  uFurLean: THREE.IUniform<number>;
  uFurThick: THREE.IUniform<number>;
  uFurBump: THREE.IUniform<number>;
  uFurTuftFreq: THREE.IUniform<number>;
  uFurMin: THREE.IUniform<number>;
  uRootShade: THREE.IUniform<number>;
  uFaceFurScale: THREE.IUniform<number>;
  uOldScarf: THREE.IUniform<number>;
  uEyeLPos: THREE.IUniform<THREE.Vector3>;
  uEyeRPos: THREE.IUniform<THREE.Vector3>;
  uEyeAxisL: THREE.IUniform<THREE.Vector3>;
  uEyeAxisR: THREE.IUniform<THREE.Vector3>;
  uEyeClose: THREE.IUniform<THREE.Vector2>;
  uClosedEye: THREE.IUniform<THREE.Vector4>;
  uNosePos: THREE.IUniform<THREE.Vector3>;
  uNoseHalf: THREE.IUniform<THREE.Vector3>;
  uEyeClear: THREE.IUniform<THREE.Vector2>;
}

/**
 * 몸통 머티리얼(베이스 or 털 셸). 공유 uniform 객체를 그대로 참조하므로 한 번 바꾸면 전부 반영된다.
 * shell=null 이면 베이스(피부+얼굴 잉크), 아니면 털 셸.
 */
export function makeBodyMaterial(
  color: THREE.Color,
  face: FaceUniforms,
  fur: FurUniforms,
  shell: { h: number; offset: THREE.IUniform<number> } | null,
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: shell ? 0.7 : 0.8, metalness: 0 }); // 가이드 2.4: roughness 0.6 (셸 근사라 조금 더 거칠게)
  if (shell) {
    mat.transparent = true;
    mat.depthWrite = true;
  }
  const shellH = { value: shell?.h ?? 0 };
  mat.defines = shell ? { PV_SHELL: "" } : {};

  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, face, fur, { uShellH: shellH, uShellOffset: shell?.offset ?? { value: 0 } });

    sh.vertexShader = "attribute float aCavity;\nattribute float aLip;\nattribute float aCover;\nattribute vec3 aMouthIn;\n" + COMMON_GLSL + FUR_GLSL + FUR_MASK_GLSL + sh.vertexShader
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vRest = position;
        vRestN = normal;
        vCavity = aCavity;
        vMouthIn = aMouthIn;`,
      )
      .replace(
        "#include <skinning_vertex>",
        `#include <skinning_vertex>
        #ifdef PV_SHELL
          transformed += normalize(objectNormal) * uShellOffset * pvFurMask(position, normal, aCavity, aLip, aCover);
        #endif`,
      );

    sh.fragmentShader = COMMON_GLSL + FUR_GLSL + FACE_GLSL + sh.fragmentShader
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec2 pvInk = pvFaceInk();  // 입·감은 눈·눈썹 먹선 + 볼터치
        #ifdef PV_SHELL
          // 가닥 털 (가이드 2.4 Ornatrix 느낌: 가늘고 촘촘, 아래로 살짝 눕고, 덩어리마다 길이가 조금씩 다름)
          float h = uShellH;
          float furLen = uShellOffset / max(h, 1e-3);
          vec3 n0 = normalize(vRestN);
          vec3 gdir = vec3(0.0, -1.0, 0.0) + n0 * n0.y;
          float gl = length(gdir);
          gdir = gl > 1e-3 ? gdir / gl : vec3(0.0);
          // 털 길이는 털뭉치마다 다름 → 윤곽이 뭉치 모양으로 울퉁불퉁한 솜털 가장자리
          float clump = mix(1.0 - uFurMin, 1.0, pvTuft(vRest));
          vec3 sp = vRest * uFurFreq;
          vec2 pvS = pvStrands(sp, h, clump, length(fwidth(sp)) * 0.7 + 1e-4, n0, gdir, furLen * uFurLean * uFurFreq);
          float cov = max(pvS.x, 1.0 - smoothstep(0.02, 0.07, h)); // 맨 아래 솜털층만 빽빽하게
          if (cov < 0.03) discard;
          // 반투명은 가닥 가장자리 안티앨리어싱 용도만 (윤곽을 일부러 흐리면 털이 아니라 빛 번짐처럼 보임)
          diffuseColor.a = cov;
          diffuseColor.rgb *= mix(uRootShade, 1.0, uShellH) * (0.93 + 0.07 * pvS.y) * pvTuftShade(vRest, n0);
        #else
          diffuseColor.rgb *= uRootShade * pvTuftShade(vRest, normalize(vRestN));
        #endif
        // 먹선은 털 위 레이어(makeInkMaterial)가 그린다 — 여기서 그리면 털 사이로 얼룩처럼 비침
        diffuseColor.rgb = mix(diffuseColor.rgb, uBlushColor, pvInk.y);`,
      );
  };
  mat.customProgramCacheKey = () => (shell ? "pv-shell" : "pv-base");
  return mat;
}

/**
 * 먹선 레이어: 입·감은 눈·눈썹을 털 '위'에 얹어 그린다 (털을 걷으면 경계가 털 덩어리 모양으로 들쭉날쭉해짐).
 * 몸통과 같은 지오메트리를 그 자리 털 높이만큼 바깥으로 띄우고, 먹선이 있는 곳만 그린다.
 */
export function makeInkMaterial(face: FaceUniforms, fur: FurUniforms, offset: THREE.IUniform<number>): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, depthWrite: false });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, face, fur, { uShellH: { value: 1 }, uShellOffset: offset, uInkDepthBias: { value: 1.7 } });
    sh.vertexShader = "attribute float aCavity;\nattribute float aLip;\nattribute float aCover;\nuniform float uInkDepthBias;\n" + COMMON_GLSL + FUR_GLSL + FUR_MASK_GLSL + sh.vertexShader
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vRest = position;
        vRestN = normal;
        vCavity = 0.0;
        // 먹선은 표면에 붙여 그리고(띄우면 고개를 돌릴 때 시차로 눈 자리에서 밀려나 찌그러짐),
        // 털에 안 가려지게 '깊이'만 카메라 쪽으로 그 자리 털 높이보다 조금 더 당긴다 (아래 skinning 뒤)
        float pvFurH = uShellOffset * max(pvFurMask(position, normal, aCavity, aLip, aCover), 0.0);
        transformed += normal * pvFurH * 0.08;`,
      )
      .replace(
        "#include <skinning_vertex>",
        `#include <skinning_vertex>
        // 시선 방향으로 움직이면 화면 위치는 그대로라 모양은 안 변하고, 털 같은 얇은 것엔 안 가려지되
        // 코처럼 털 높이보다 확실히 앞에 있는 것엔 그대로 가려진다
        vec3 pvCam = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
        transformed += normalize(pvCam - transformed) * (pvFurH * uInkDepthBias + 0.3);`,
      );
    sh.fragmentShader = COMMON_GLSL + FUR_GLSL + FACE_GLSL + sh.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      vec2 pvInk = pvFaceInk();
      if (pvInk.x < 0.01) discard;
      diffuseColor = vec4(uInkColor, pvInk.x);`,
    );
  };
  mat.customProgramCacheKey = () => "pv-ink";
  return mat;
}

/** 스카프: 빨강/흰 줄무늬 (가이드 2.6 SCARF COLOR #EF2E2E). UV u 방향 스트라이프. */
export function makeScarfMaterial(red: THREE.Color, stripes: THREE.IUniform<number>, angle: THREE.IUniform<number>): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uScarfRed = { value: red };
    sh.uniforms.uStripes = stripes;
    sh.uniforms.uStripeAngle = angle;
    sh.vertexShader = "varying vec2 vPvUv;\n" + sh.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\n vPvUv = uv;",
    );
    sh.fragmentShader =
      "varying vec2 vPvUv;\nuniform vec3 uScarfRed;\nuniform float uStripes;\nuniform float uStripeAngle;\n" +
      sh.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float sc = vPvUv.x * cos(uStripeAngle) + vPvUv.y * sin(uStripeAngle);
        float sv = fract(sc * uStripes);
        float aa = fwidth(sc * uStripes) * 1.2;
        float red = smoothstep(0.5 - aa, 0.5 + aa, sv) * (1.0 - smoothstep(1.0 - aa, 1.0, sv)) + (1.0 - smoothstep(0.0, aa, sv));
        diffuseColor.rgb = mix(vec3(0.97), uScarfRed, clamp(red, 0.0, 1.0));`,
      );
  };
  mat.customProgramCacheKey = () => "pv-scarf";
  return mat;
}
