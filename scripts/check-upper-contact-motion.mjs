import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const T=await import('three');
const {standingHeadClearance,clearStandingForearm,clearStandingUpper,resolveStandingHeadContact,resolveStandingUpperContact,limitStandingContactMotion}=await import('../src/character/standingHeadClearance.ts');
const {standingUpperDirection}=await import('../src/character/standingArmPose.ts');
const rig=JSON.parse(readFileSync('public/models/stand_connected_cage_rig.json'));
const rows=[];
for(const fps of [15,30,60])for(const whole of [false,true]){
 let minimum=Infinity,maxStep=0;
 for(const side of [-1,1]){
  const j=rig.joints[side>0?'L':'R'],s=new T.Vector3(...j.shoulder),rest=new T.Vector3(...j.hand).sub(s),length=rest.length();rest.normalize();
  const uq=new T.Quaternion(),fq=new T.Quaternion(),head=new T.Quaternion();let previous=null;
  for(let i=0;i<12*fps;i++){
   const t=i/fps,k=1-Math.exp(-18/fps),theta=2.3+.3*Math.sin(t*.8),phi=1.7+.3*Math.sin(t*.5);
   head.slerp(new T.Quaternion().setFromEuler(new T.Euler(.3*Math.sin(t*3),.65*Math.sin(t*4),.2*Math.sin(t*5),'YXZ')),k);
   const human=new T.Vector3(side*Math.sin(theta)*Math.cos(phi),-Math.cos(theta),Math.sin(theta)*Math.sin(phi)),u=standingUpperDirection(side,rest,human,3),tu=new T.Quaternion().setFromUnitVectors(rest,u),tf=new T.Quaternion();
   if(whole)clearStandingUpper(s,length,rest,tu,tf,head);clearStandingForearm(s,length,rest,tu,tf,head);
   const oldU=uq.clone(),oldF=fq.clone();
   if(!i){uq.copy(tu);fq.copy(tf);}else{uq.slerp(tu,k);fq.slerp(tf,k);}
   if(whole)resolveStandingUpperContact(s,length,rest,uq,fq,head,1/fps);resolveStandingHeadContact(s,length,rest,uq,fq,head,1/fps);
   if(whole&&i)limitStandingContactMotion(rest,oldU,oldF,uq,fq,1/fps);
   const actualU=rest.clone().applyQuaternion(uq),actualF=rest.clone().applyQuaternion(fq).applyQuaternion(uq);
   minimum=Math.min(minimum,standingHeadClearance(s,length,actualU,actualF,head,true).distance);
   if(previous)maxStep=Math.max(maxStep,actualU.angleTo(previous.u),actualF.angleTo(previous.f));previous={u:actualU,f:actualF};
  }
 }
 rows.push({fps,whole,minimum,maxStep});
}
console.log(rows);
for(let i=0;i<rows.length;i+=2){assert.ok(rows[i+1].minimum>rows[i].minimum+.2);assert.ok(rows[i+1].minimum>.93);assert.ok(rows[i+1].maxStep<8/rows[i+1].fps);}
