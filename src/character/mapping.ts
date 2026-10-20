import type { Config } from "../config";
import type { FaceSignal } from "../signals";

/**
 * 캐릭터가 받는 파라미터. 리그 방식(2D 파츠/3D blendshape)이 바뀌어도 이 인터페이스는 유지한다.
 * 그래픽 팀 합류 시 이 타입이 인계 명세의 핵심.
 */
export interface CharacterParams {
  headYaw: number; // rad
  headPitch: number;
  headRoll: number;
  blinkL: number; // 0~1 (1 = 감음)
  blinkR: number;
  eyeWide: number; // 0~1
  jawOpen: number; // 0~1
  smile: number; // -1(찡그림) ~ 1(웃음)
  browUp: number; // -1(찌푸림) ~ 1(올림)
  pucker: number; // 0~1
  cheek: number; // 0~1
  grin: number; // 0~1 활짝 웃음(입꼬리 블렌드셰이프 원값) — 볼터치용
}

const DEG = Math.PI / 180;

function deadzone(v: number, dz: number): number {
  return Math.abs(v) < dz ? 0 : v - Math.sign(v) * dz;
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
function dz01(v: number, dz: number): number {
  return v < dz ? 0 : (v - dz) / (1 - dz);
}

/** 신호 → 캐릭터 파라미터. 게인·데드존·클램프는 전부 config.mapping */
export function mapSignal(sig: FaceSignal, m: Config["mapping"]): CharacterParams {
  const b = sig.blend;
  const g = (k: string) => b[k] ?? 0;

  const yaw = clamp(deadzone(sig.yaw, m.headDeadzoneDeg) * m.yawGain, -m.yawClampDeg, m.yawClampDeg);
  const pitch = clamp(deadzone(sig.pitch, m.headDeadzoneDeg) * m.pitchGain, -m.pitchClampDeg, m.pitchClampDeg);
  const roll = clamp(deadzone(sig.roll, m.headDeadzoneDeg) * m.rollGain, -m.rollClampDeg, m.rollClampDeg);

  // 실제 웹캠: signals.ts 가 사람별 무표정 기준선을 뺀 __ 값을 준다. (sim 은 원값)
  const rel = "__smileRel" in b;
  const geo = "__geoCorner" in b;
  // 실제 웹캠: 입꼬리 높이(랜드마크) 우선 — 웃음은 블렌드셰이프와 큰 쪽, 시무룩은 랜드마크로
  const geoSmile = geo ? Math.max(0, g("__geoCorner")) * m.cornerSmileGain : 0;
  const geoFrown = geo ? Math.max(0, -g("__geoCorner")) * m.cornerFrownGain : 0;
  const smilePos = Math.max(geoSmile, (rel ? g("__smileRel") * 2.2 : (g("mouthSmileLeft") + g("mouthSmileRight")) / 2) * m.smileGain);
  // 입술 오므림: 입이 실제로 벌어졌을 때만 'o'(노래). 다문 채 오므리거나 내밀면(뾰로통) 시무룩 쪽으로
  const puckRaw = rel ? g("__puckerRel") : Math.max(g("mouthPucker"), g("mouthFunnel"));
  const lipsApart = geo ? clamp((g("__geoOpen") - 0.04) / 0.08, 0, 1) : 1;
  // 이 오므림 값은 무표정에서도 0.3~0.5 씩 튀는 사람이 있어 확실히 클 때만
  const pout = geo ? Math.max(0, puckRaw - 0.3) * (1 - lipsApart) * m.poutFrownGain : 0;
  const smileNeg = geo ? Math.max(geoFrown, pout) : (rel ? g("__frownRel") : (g("mouthFrownLeft") + g("mouthFrownRight")) / 2) * m.frownGain;
  // 입 벌림: 입술 간격(랜드마크) / 입 폭. 말할 때 정도(~0.15)는 무시
  const openRaw = geo ? Math.max(0, g("__geoOpen") - m.mouthOpenGeoFrom) / m.mouthOpenGeoRange : rel ? g("__mouthOpen") : g("jawOpen");
  const browPos = g("browInnerUp") * m.browGain;
  const browNeg = (g("browDownLeft") + g("browDownRight")) / 2;

  // 눈마다 따로 (윙크 가능). 0~1 감김 정도만 넘기고, 뜸/감음 판정(히스테리시스)은 캐릭터 쪽에서.
  const bl = clamp(rel ? g("__blinkRelLeft") : g("eyeBlinkLeft"), 0, 1);
  const br = clamp(rel ? g("__blinkRelRight") : g("eyeBlinkRight"), 0, 1);

  return {
    headYaw: yaw * DEG,
    headPitch: pitch * DEG,
    headRoll: roll * DEG,
    // 눈 뜬 상태에서도 MediaPipe 감김 값이 0.2~0.4 로 나오는 일이 흔하다(특히 한쪽 눈·아래를 볼 때).
    // blinkOpenBelow 아래는 완전히 뜬 눈, blinkThreshold 이상은 완전히 감은 눈.
    blinkL: bl,
    blinkR: br,
    eyeWide: clamp(dz01((g("eyeWideLeft") + g("eyeWideRight")) / 2, m.blendDeadzone), 0, 1),
    jawOpen: clamp(dz01(openRaw, m.blendDeadzone) * m.jawGain, 0, 1),
    smile: clamp(dz01(smilePos, m.blendDeadzone) - dz01(smileNeg, m.blendDeadzone), -1, 1),
    browUp: clamp(dz01(browPos, m.blendDeadzone) - dz01(browNeg, m.blendDeadzone), -1, 1),
    // 오므림은 평소에도 0.2~0.4 가 흔함 → 확실히 클 때만
    pucker: clamp(dz01(puckRaw, rel ? 0.15 : m.puckerDeadzone) * lipsApart, 0, 1),
    cheek: clamp(dz01(g("cheekPuff"), m.blendDeadzone), 0, 1),
    // 활짝 웃음: 양쪽 입꼬리 블렌드셰이프가 '둘 다' 높을 때만 (말하거나 한쪽만 씰룩일 때 제외)
    grin: clamp(Math.min(g("mouthSmileLeft"), g("mouthSmileRight")), 0, 1),
  };
}

export const NEUTRAL_PARAMS: CharacterParams = {
  headYaw: 0, headPitch: 0, headRoll: 0,
  blinkL: 0, blinkR: 0, eyeWide: 0, jawOpen: 0, smile: 0, browUp: 0, pucker: 0, cheek: 0, grin: 0,
};
