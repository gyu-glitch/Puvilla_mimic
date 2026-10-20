import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const T=await import('three');
const {StandingTorsoContact,standingTorsoClearance}=await import('../src/character/standingTorsoClearance.ts');
const {clearStandingForearm,resolveStandingHeadContact}=await import('../src/character/standingHeadClearance.ts');
const {standingUpperDirection}=await import('../src/character/standingArmPose.ts');
const rig=JSON.parse(readFileSync('public/models/stand_connected_cage_rig.json'));
const rows=[];
for(const movingChest of [false,true])for(const fps of [15,30,60,100]){
 let minimum=2,maxStep=0;
 for(const side of [-1,1]){
  const j=rig.joints[side>0?'L':'R'],s=new T.Vector3(...j.shoulder),rest=new T.Vector3(...j.hand).sub(s),length=rest.length();rest.normalize();
  const contact=new StandingTorsoContact(),uq=new T.Quaternion(),fq=new T.Quaternion(),head=new T.Quaternion(),chest=new T.Quaternion();let previous=null;
  for(let frame=0;frame<24*fps;frame++){
   const t=frame/fps,theta=(Math.sin(t*.7+side*.4)+1)*.75,bend=-(Math.sin(t*1.1)+1)*1.2,phi=Math.sin(t*.4)*.35;
   const human=new T.Vector3(side*Math.sin(theta)*Math.cos(phi),-Math.cos(theta),Math.sin(theta)*Math.sin(phi));
   const upper=standingUpperDirection(side,rest,human,3),fore=human.clone().applyAxisAngle(new T.Vector3(0,0,side),bend).applyQuaternion(new T.Quaternion().setFromUnitVectors(human,upper));
   const tu=new T.Quaternion().setFromUnitVectors(rest,upper),tf=new T.Quaternion().setFromUnitVectors(rest,fore.clone().applyQuaternion(tu.clone().invert()));
   if(movingChest)chest.setFromEuler(new T.Euler(.15*Math.sin(t*.8),.25*Math.sin(t*.7),.18*Math.sin(t*1.1)));
   contact.solve(s,length,rest,tu,tf,1/fps,chest);clearStandingForearm(s,length,rest,tu,tf,head);
   if(!frame){uq.copy(tu);fq.copy(tf);}else{const k=1-Math.exp(-18/fps);uq.slerp(tu,k);fq.slerp(tf,k);}
   resolveStandingHeadContact(s,length,rest,uq,fq,head,1/fps);
   const u=rest.clone().applyQuaternion(uq),f=rest.clone().applyQuaternion(fq).applyQuaternion(uq);
   minimum=Math.min(minimum,standingTorsoClearance(s,length,u,f,chest).distance);
   if(previous)maxStep=Math.max(maxStep,f.angleTo(previous));previous=f;
  }
 }
 rows.push({movingChest,fps,minimum,maxStep});assert.ok(minimum>.99,'smoothed arm entered too deeply into the belly proxy');assert.ok(maxStep<4/fps+.015,'contact produced an abrupt frame step');
}
console.log(rows);
