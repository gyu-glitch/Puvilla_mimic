import {Vector3} from 'three';

/** Retain a hand's relative orientation across a few missing finger samples.
 * Invalid samples are never accepted; a sustained loss eases back to neutral. */
export class StandingPawTracking {
  roll=0;
  readonly wrist=new Vector3();
  private rollSeen=-Infinity;
  private wristSeen=-Infinity;
  reset(){this.roll=0;this.wrist.set(0,0,0);this.rollSeen=this.wristSeen=-Infinity;}
  update(roll:number|null,wrist:Vector3|null,now:number,dt:number){
    if(now<this.rollSeen || now<this.wristSeen)this.reset();
    const decay=Math.exp(-Math.min(.1,Math.max(0,dt))/.35);
    const measured=roll!==null&&Number.isFinite(roll)?Math.atan2(Math.sin(roll),Math.cos(roll)):null;
    if(measured!==null && Math.abs(measured)<=1.5){
      // This is a bounded offset from the current front-facing palm, not a
      // cumulative revolution count. A flipped finger plane near +/-pi is
      // outside the supported range: hold briefly, then release to front.
      // Never turn it into a saturated command that survives valid recovery.
      this.roll=Math.max(-1.3,Math.min(1.3,measured));this.rollSeen=now;
    }else if(now-this.rollSeen>.18)this.roll*=decay;
    if(wrist && [wrist.x,wrist.y,wrist.z].every(Number.isFinite)){
      this.wrist.copy(wrist).clampLength(0,.18);this.wristSeen=now;
    }else if(now-this.wristSeen>.18)this.wrist.multiplyScalar(decay);
  }
}
