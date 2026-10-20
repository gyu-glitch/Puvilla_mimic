import { BodyProcessor } from "./body";
import type { RawPose } from "./poseTracker";

/** Continue the body already associated with a face while raised hands obscure
 * that face. A body alone cannot acquire a new visitor. */
export class BodyTargetLock {
  private last: RawPose | null = null;
  private seen = -Infinity;
  private initialWidth = 0;

  update(poses: RawPose[], face: {cx:number;cy:number;h:number} | null, fresh: boolean, now: number): RawPose | null {
    if (!fresh) return now-this.seen<500 ? this.last : null;
    const usable = poses.filter(p => p.shoulderW>.03 && Number.isFinite(p.shoulderW) &&
      Number.isFinite(p.nose.x) && Number.isFinite(p.nose.y) &&
      [11,12].every(i=>p.world[i] && p.world[i].visibility>=.5 &&
        [p.world[i].x,p.world[i].y,p.world[i].z].every(Number.isFinite)));
    let selected = face ? BodyProcessor.pickForFace(usable,face) : null;
    if (selected) this.initialWidth=selected.shoulderW;
    if (!selected && this.last && now-this.seen<500) {
      const center=(p:RawPose)=>p.image?.[11] && p.image?.[12] &&
        [p.image[11].x,p.image[11].y,p.image[12].x,p.image[12].y].every(Number.isFinite)
        ? {x:(p.image[11].x+p.image[12].x)*.5,y:(p.image[11].y+p.image[12].y)*.5}
        : p.nose;
      const old=center(this.last);
      const candidates=usable.map(p=>({p,d:Math.hypot(center(p).x-old.x,center(p).y-old.y)}))
        .filter(c=>c.d<Math.max(.08,this.last!.shoulderW*.45) &&
          c.p.shoulderW>=this.initialWidth*.65 && c.p.shoulderW<this.last!.shoulderW*1.5)
        .sort((a,b)=>a.d-b.d);
      if (candidates.length===1 || (candidates.length>1 && candidates[1].d-candidates[0].d>.04))
        selected=candidates[0].p;
    }
    if (selected) { this.last=selected;this.seen=now; }
    else if (now-this.seen>=500) { this.last=null;this.initialWidth=0; }
    return selected;
  }
}
