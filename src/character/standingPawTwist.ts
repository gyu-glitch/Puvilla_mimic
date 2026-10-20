/** Integral of a smooth acceleration ramp with constant twist rate in the middle.
 * Keeps each cross-section rigid, and the root/paw endpoint rotations unchanged. */
export function distributedPawTwist(start: number, end: number, distance: number): number {
  const x = Math.max(0, Math.min(1, (distance - start) / (end - start)));
  const ramp = .15;
  const entry = (t: number) => {
    const u = t / ramp;
    return ramp * (u*u*u - .5*u*u*u*u) / (1-ramp);
  };
  if (x < ramp) return entry(x);
  if (x > 1-ramp) return 1-entry(1-x);
  return (x-ramp*.5)/(1-ramp);
}

/** A distributed mesh twist is a displacement, not an orientation on a circle:
 * adding 2pi leaves the hand tip equivalent but winds intermediate vertices.
 * Choose a bounded target and approach that physical displacement directly. */
export function stepStandingPawTwist(current:number,target:number,k:number,dt:number):number{
 const from=Number.isFinite(current)?current:0;
 const to=Number.isFinite(target)?Math.atan2(Math.sin(target),Math.cos(target)):0;
 const delta=(to-from)*Math.max(0,Math.min(1,k));
 const maxStep=6*Math.max(0,Math.min(.1,dt));
 return from+Math.max(-maxStep,Math.min(maxStep,delta));
}
