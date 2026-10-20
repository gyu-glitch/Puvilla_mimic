import { standingWavePose } from "../src/standingWave";
import type { RawPose } from "../src/poseTracker";

/** Deterministic 12-second camera-shaped input; no user video or camera access. */
export function armTrackingFixture(t: number): { raw: RawPose | null; phase: string } {
  const p = ((t % 12) + 12) % 12;
  const ease = (x: number) => { x = Math.max(0, Math.min(1, x)); return x*x*(3-2*x); };
  const lift = p < 3 ? ease(p-1) : p < 7 ? 1 : p < 8 ? 0 : p < 10 ? ease(p-8) : 1-ease(p-10);
  const left = standingWavePose(t, lift, -1), right = standingWavePose(t, lift, 1);
  const pose = {...left, shoulderL: right.shoulderL, elbowL: right.elbowL, wristL: right.wristL};
  const raw: RawPose = {
    world: Array.from({length:33}, () => ({x:0,y:0,z:0,visibility:1})),
    image: Array.from({length:33}, () => ({x:.5,y:.5})),
    nose:{x:.5,y:.3}, shoulderW:.36,
  };
  for (const [s, ids] of [["L",[12,14,16,24]],["R",[11,13,15,23]]] as const) {
    for (const [n, joint] of (["shoulder","elbow","wrist","hip"] as const).entries()) {
      const v = pose[`${joint}${s}`];
      Object.assign(raw.world[ids[n]], {x:-v[0],y:-v[1],z:-v[2]});
    }
  }
  let phase = "stable lift / lower";
  if ((p >= 3 && p < 5) || p >= 11) {
    phase = "uncertain left arm; right remains reliable";
    const beat = Math.floor(t*15)%3, angle = beat === 1 ? .3 : 2.8;
    const s = raw.world[11], e = raw.world[13], w = raw.world[15];
    Object.assign(e, {x:s.x+.27*Math.sin(angle),y:s.y+.27*Math.cos(angle),z:0,visibility:.72});
    Object.assign(w, {x:e.x+.25*Math.sin(angle),y:e.y+.25*Math.cos(angle),z:0,
      visibility:beat === 0 ? .48 : .72});
  } else if (p >= 5 && p < 6) {
    phase = "left wrist outside camera, confidence still high";
    raw.image![15].x = 1.15;
  } else if (p >= 6 && p < 7) {
    return {raw:null,phase:"no body detection"};
  }
  return {raw,phase};
}
