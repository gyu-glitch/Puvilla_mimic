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
