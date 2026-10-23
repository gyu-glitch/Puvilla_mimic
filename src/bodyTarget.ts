import { BodyProcessor } from "./body";
import type { RawPose } from "./poseTracker";
import type { Config } from "./config";
import { faceMatchesHint, type FaceHint } from "./faceRecovery";
import type { RawFace, TrackResult } from "./tracker";
import type { ZoneFace } from "./lockZone";

/** Direct mimic acquires the largest observed person in the operator's zone.
 * Legacy distance mode retains face-led acquisition. */
export class BodyTargetLock {
  private last: RawPose | null = null;
  private seen = -Infinity;
  private initialWidth = 0;
  private lastFaceObservation = -Infinity;
  private previousFaceMatch = -Infinity;
  private confirmedAt = -Infinity;
  private recentFaces: RawFace[] = [];
  revision = 0;
  constructor(private cfg?: Config) {}

  /** A pose is a search proposal, not proof that a visitor is present.
   * Two independent fresh face observations in that head region corroborate it.
   * Cached frames and repeated pose hallucinations cannot renew this evidence. */
  observeFace(track: TrackResult, now: number): void {
    const ts = track.observedAtMs;
    if (ts === undefined || !Number.isFinite(ts) || ts <= this.lastFaceObservation || ts > now || now-ts>500) return;
    this.lastFaceObservation = ts;
    this.recentFaces = track.faces;
    const hint = this.headHint(now);
    if (!hint || !track.faces.some(f => faceMatchesHint(f, hint, this.last!.imageAspect || 1))) return;
    // Acquisition/reacquisition needs two observations. Once confirmed, a
    // fresh matching face renews the lease even when inference is < 2 Hz.
    // Requiring a close pair on every renewal made a real visitor expire
    // despite continued face detections on a slower or intermittently occluded input.
    if (this.confirmed(now) || ts-this.previousFaceMatch <= 500) this.confirmedAt = ts;
    this.previousFaceMatch = ts;
  }

  confirmed(now: number): boolean {
    return this.headHint(now) !== null && now-this.confirmedAt < Math.max(3000, this.cfg!.presence.faceLostHoldMs);
  }

  private resetEvidence(): void {
    this.lastFaceObservation = this.previousFaceMatch = this.confirmedAt = -Infinity;
    this.recentFaces = [];
  }

  private inZone(p: RawPose): boolean {
    if (!this.cfg) return true;
    const z = this.cfg.presence.lockZone, x = this.cfg.camera.mirror ? 1-p.nose.x : p.nose.x;
    return x >= z.x && x <= z.x+z.w && p.nose.y >= z.y && p.nose.y <= z.y+z.h;
  }

  /** A geometric head search region, not a fabricated face detection. */
  headHint(now: number): FaceHint | null {
    if (!this.cfg?.presence.mimicOnLock || !this.last || now-this.seen >= this.cfg.presence.faceLostHoldMs) return null;
    const p = this.last, aspect = p.imageAspect || 1;
    const a = p.image?.[11], b = p.image?.[12];
    const width = a && b ? Math.hypot((a.x-b.x)*aspect,a.y-b.y) : p.shoulderW*aspect;
    return { cx:p.nose.x, cy:p.nose.y, size:width*1.8 };
  }

  debugTarget(now: number): ZoneFace[] {
    const h = this.headHint(now);
    if (!h) return [];
    const w = h.size/(this.last!.imageAspect || 1);
    return [{x:(this.cfg!.camera.mirror ? 1-h.cx : h.cx)-w/2,y:h.cy-h.size/2,w,h:h.size,
      locked:false,inZone:true,body:true,pending:!this.confirmed(now),held:now-this.seen>=250}];
  }

  update(poses: RawPose[], face: {cx:number;cy:number;h:number} | null, fresh: boolean, now: number): RawPose | null {
    if (this.cfg?.presence.mimicOnLock) return this.updatePerson(poses, fresh, now);
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

  private updatePerson(poses: RawPose[], fresh: boolean, now: number): RawPose | null {
    const hold = this.cfg!.presence.faceLostHoldMs;
    if (now-this.seen >= hold && this.last) { this.last=null; this.resetEvidence(); this.revision++; }
    if (!fresh) return now-this.seen<500 ? this.last : null;
    // No fixed on-screen size threshold. Require actual, finite shoulder
    // observations instead of accepting an undetected/degenerate skeleton.
    const usable = poses.filter(p => Number.isFinite(p.shoulderW) && p.shoulderW>0 &&
      Number.isFinite(p.nose.x) && Number.isFinite(p.nose.y) && this.inZone(p) &&
      [11,12].every(i=>p.world[i]?.visibility>=.5 && p.image?.[i] &&
        [p.world[i].x,p.world[i].y,p.world[i].z,p.image[i].x,p.image[i].y].every(Number.isFinite)) &&
      Math.hypot(p.image![11].x-p.image![12].x,p.image![11].y-p.image![12].y)>0);
    const width=(p:RawPose)=>Math.hypot((p.image![11].x-p.image![12].x)*(p.imageAspect || 1),p.image![11].y-p.image![12].y);
    const center=(p:RawPose)=>({x:(p.image![11].x+p.image![12].x)/2,y:(p.image![11].y+p.image![12].y)/2});
    let selected: RawPose | null = null;
    // A false pose proposal must not monopolize the head search when a real
    // face appears elsewhere. Confirmed visitors keep the existing identity rule.
    const currentHint = this.headHint(now);
    if (this.last && !this.confirmed(now) && now-this.lastFaceObservation<500 && currentHint &&
        !this.recentFaces.some(f=>faceMatchesHint(f,currentHint,this.last!.imageAspect || 1))) {
      selected=usable.filter(p=>this.recentFaces.some(f=>faceMatchesHint(f,
        {cx:p.nose.x,cy:p.nose.y,size:width(p)*1.8},p.imageAspect || 1)))
        .sort((a,b)=>width(b)-width(a))[0] ?? null;
      if (selected) { this.resetEvidence(); this.revision++; }
    }
    if (!selected && this.last) {
      const old=center(this.last), size=width(this.last), aspect=this.last.imageAspect || 1;
      const candidates=usable.map(p=>({p,d:Math.hypot((center(p).x-old.x)*aspect,center(p).y-old.y),ratio:width(p)/size}))
        .filter(c=>c.ratio>=.65 && c.ratio<=1.5 && c.d<Math.max(.04,size*.65))
        .sort((a,b)=>a.d-b.d);
      if (candidates.length===1 || candidates.length>1 && candidates[1].d-candidates[0].d>size*.2)
        selected=candidates[0].p;
      // While the original target is missing, do not hand the session to a bystander.
    } else if (!selected) {
      selected=usable.sort((a,b)=>width(b)-width(a))[0] ?? null;
      if (selected) { this.resetEvidence(); this.revision++; }
    }
    if (selected) { this.last=selected; this.seen=now; }
    return selected;
  }
}
