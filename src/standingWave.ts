import type { BodyPose, V3 } from './body';

/** Reference greeting input, fed through the same retargeter as camera poses. */
export function standingWavePose(time: number, lift = 1, wavingSide: 1|-1 = -1): BodyPose {
  const limb=(side: 1|-1)=>{
    const amount=side===wavingSide?Math.max(0,Math.min(1,lift)):0;
    const theta=2.4*amount;
    const fore=theta+(.46+Math.sin(time*2.5)*.08)*amount;
    const phi=.08*amount;
    const s:V3=[side*.18,.48,0];
    const dir=(a:number,length:number):V3=>[side*Math.sin(a)*Math.cos(phi)*length,-Math.cos(a)*length,Math.sin(a)*Math.sin(phi)*length];
    const u=dir(theta,.27),f=dir(fore,.25);
    const e=s.map((v,i)=>v+u[i]) as V3;
    const w=e.map((v,i)=>v+f[i]) as V3;
    return {s,e,w};
  };
  const l=limb(1),r=limb(-1);
  return {shoulderL:l.s,elbowL:l.e,wristL:l.w,shoulderR:r.s,elbowR:r.e,wristR:r.w,
    hipL:[.1,0,0],hipR:[-.1,0,0],armL:1,armR:1,hips:1};
}
