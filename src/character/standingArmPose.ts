import { Vector3 } from 'three';

const smooth=(a:number,b:number,x:number)=>{
  const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);
};

/** Downward human input returns the supplied 3D model's exact neutral axis.
 * Raised input follows the observed direction. No limb-length scaling. */
export function standingUpperDirection(side:1|-1,rest:Vector3,human:Vector3,maxRaise:number,continuousAzimuth=true):Vector3 {
  const theta=Math.acos(Math.max(-1,Math.min(1,-human.y)));
  const restPolar=Math.acos(-rest.y),restAzimuth=Math.atan2(rest.z,side*rest.x);
  const thetaOut=Math.min(maxRaise,theta+restPolar*(1-smooth(0,Math.PI/2,theta)));
  const raw=Math.atan2(human.z,side*human.x);
  const phi=(continuousAzimuth?standingAzimuth(raw):Math.min(2,Math.max(-.5,raw)))*smooth(.25,.7,theta)
    +restAzimuth*(1-smooth(0,.7,theta));
  return new Vector3(side*Math.sin(thetaOut)*Math.cos(phi),-Math.cos(thetaOut),Math.sin(thetaOut)*Math.sin(phi));
}

/** Keep the supported front/side sector exact. The excluded rear sector joins
 * the two limits continuously on the circle; +/- pi is not a joint boundary.
 * Rearward input is a constrained fallback, not a literal rearward arm pose. */
export function standingAzimuth(raw:number):number {
  const lo=-.5,hi=2,tau=Math.PI*2;
  const phi=Math.atan2(Math.sin(raw),Math.cos(raw));
  if(phi>=lo && phi<=hi)return phi;
  const gap=tau-(hi-lo),distance=(phi-hi+tau)%tau;
  return hi+(lo-hi)*smooth(.15,.85,distance/gap);
}

/** Follow raised camera arms directly. Only the source's relaxed A-pose has a
 * lower bound; the old offset continued lifting the arm even around 40–70deg. */
export function standingFollowDirection(side:1|-1,rest:Vector3,human:Vector3):Vector3 {
 const theta=Math.acos(Math.max(-1,Math.min(1,-human.y))),neutral=Math.acos(-rest.y);
 const band=.12,h=Math.max(0,band-Math.abs(theta-neutral))/band;
 const raised=Math.max(theta,neutral)+h*h*band*.25;
 const sourcePhi=Math.atan2(rest.z,side*rest.x),observedPhi=Math.atan2(human.z,side*human.x);
 const phi=sourcePhi+Math.atan2(Math.sin(observedPhi-sourcePhi),Math.cos(observedPhi-sourcePhi))*smooth(.12,.65,theta);
 return new Vector3(side*Math.sin(raised)*Math.cos(phi),-Math.cos(raised),Math.sin(raised)*Math.sin(phi));
}
