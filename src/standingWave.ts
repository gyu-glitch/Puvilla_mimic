import type { BodyPose, V3 } from './body';

export function standingWaveMotion(time: number) {
  // Two relaxed waves followed by a rest; C2 envelope avoids a rhythmic jerk
  // at either end. The wrist leads, with only a small delayed forearm response.
  const phase=((time%4.6)+4.6)%4.6;
  const envelope=phase<3.2?Math.pow(Math.sin(Math.PI*phase/3.2),2):0;
  const swing=(lag:number)=>Math.sin((phase-lag)*Math.PI*2*.86)*envelope;
  return {upper:2.32+.012*swing(.14),bend:.48+.035*swing(.09),wrist:.12+.22*swing(0),depth:.08};
}

/** Reference greeting input, fed through the same retargeter as camera poses. */
export function standingWavePose(time: number, lift = 1, wavingSide: 1|-1 = -1): BodyPose {
  const motion=standingWaveMotion(time);
  const limb=(side: 1|-1)=>{
    const amount=side===wavingSide?Math.max(0,Math.min(1,lift)):0;
    const theta=motion.upper*amount;
    const fore=theta+motion.bend*amount;
    const phi=motion.depth*amount;
    const s:V3=[side*.18,.48,0];
    const dir=(a:number,length:number):V3=>[side*Math.sin(a)*Math.cos(phi)*length,-Math.cos(a)*length,Math.sin(a)*Math.sin(phi)*length];
    const u=dir(theta,.27),f=dir(fore,.25);
    const e=s.map((v,i)=>v+u[i]) as V3;
    const w=e.map((v,i)=>v+f[i]) as V3;
    const hand=dir(fore+motion.wrist*amount,1);
    return {s,e,w,hand};
  };
  const l=limb(1),r=limb(-1);
  return {shoulderL:l.s,elbowL:l.e,wristL:l.w,shoulderR:r.s,elbowR:r.e,wristR:r.w,
    handDirectionL:l.hand,handDirectionR:r.hand,
    hipL:[.1,0,0],hipR:[-.1,0,0],armL:1,armR:1,hips:1};
}
