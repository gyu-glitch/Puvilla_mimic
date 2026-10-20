import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const T=await import('three'),{PuuvillaCharacter}=await import('../src/character/puuvilla.ts');
const {StandingElbowPlane}=await import('../src/character/standingElbowPlane.ts');
const cfg=JSON.parse(readFileSync('public/config.json')),rig=JSON.parse(readFileSync('public/models/stand_connected_cage_mirrorleft.json'));
let maxOld=0,maxNew=0;
for(const yaw of [-.5,.3,.6])for(const roll of [-.3,0,.3]){
 const human=new T.Quaternion().setFromEuler(new T.Euler(.1,yaw,roll,'YXZ'));
 const chest=new T.Quaternion().setFromEuler(new T.Euler(.05,yaw*.72,roll*.9,'YXZ'));
 const pose={shoulderL:[.18,.48,0],shoulderR:[-.18,.48,0],armL:1,armR:1};
 for(const side of [1,-1]){
  const n=side>0?'L':'R',s=new T.Vector3(...pose['shoulder'+n]),u=new T.Vector3(side*.65,.65,.1).normalize(),f=new T.Vector3(side*.1,.99,.05).normalize(),e=s.clone().addScaledVector(u,.27);
  pose['elbow'+n]=e.toArray();pose['wrist'+n]=e.clone().addScaledVector(f,.25).toArray();
  const j=rig.joints[n],rest=new T.Vector3(...j.elbow).sub(new T.Vector3(...j.shoulder)).normalize();
  const arm={side,restUpper:rest,restFore:rest,restPolar:Math.acos(-rest.y)};
  for(const [old,frame] of [[true,human],[false,chest]]){
   const fake={cfg,connectedArms:true,armsFree:false,elbowPlanes:[new StandingElbowPlane(),new StandingElbowPlane()]};
   const uq=new T.Quaternion(),fq=new T.Quaternion();
   PuuvillaCharacter.prototype.solveArm.call(fake,arm,pose,frame,uq,fq,1/60);
   const result=rest.clone().applyQuaternion(fq).applyQuaternion(uq).applyQuaternion(chest);
   const err=result.angleTo(f);if(old)maxOld=Math.max(maxOld,err);else maxNew=Math.max(maxNew,err);
  }
 }
}
console.log({oldMaxForearmDirectionErrorDeg:maxOld*180/Math.PI,newMaxForearmDirectionErrorDeg:maxNew*180/Math.PI});
assert.ok(maxOld>.04);assert.ok(maxNew<1e-7);
