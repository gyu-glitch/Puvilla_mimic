import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const T=await import('three');
const {StandingTorsoContact}=await import('../src/character/standingTorsoClearance.ts');
const {clearStandingForearm}=await import('../src/character/standingHeadClearance.ts');
const {standingUpperDirection}=await import('../src/character/standingArmPose.ts');
const {RoundedElbowFrame}=await import('../src/character/standingBend.ts');
const rig=JSON.parse(readFileSync('public/models/stand_connected_cage_rig.json'));
let best={distance:Infinity};
for(const theta of [.8,1,1.2,1.4,1.6,1.8])for(const phi of [.8,1.2,1.6,2])for(const fy of [-.5,0,.5])for(const fz of [0,.3,.6]){
 const points=[];
 for(const side of [-1,1]){
  const j=rig.joints[side>0?'L':'R'],s=new T.Vector3(...j.shoulder),rest=new T.Vector3(...j.hand).sub(s),length=rest.length();rest.normalize();
  const human=new T.Vector3(side*Math.sin(theta)*Math.cos(phi),-Math.cos(theta),Math.sin(theta)*Math.sin(phi)),hf=new T.Vector3(-side,fy,fz).normalize();
  const upper=standingUpperDirection(side,rest,human,3),axis=new T.Vector3().crossVectors(human,hf).normalize().applyQuaternion(new T.Quaternion().setFromUnitVectors(human,upper));
  const fore=upper.clone().applyAxisAngle(axis,Math.min(2.4,human.angleTo(hf)));
  const uq=new T.Quaternion().setFromUnitVectors(rest,upper),fq=new T.Quaternion().setFromUnitVectors(rest,fore.clone().applyQuaternion(uq.clone().invert()));
  const contact=new StandingTorsoContact();
  for(let i=0;i<90;i++)contact.solve(s,length,rest,uq,fq,1/60);
  clearStandingForearm(s,length,rest,uq,fq,new T.Quaternion());
  fore.copy(rest).applyQuaternion(fq).applyQuaternion(uq);
  points.push(new RoundedElbowFrame(length,upper,fore).center(length,new T.Vector3()).add(s));
 }
 const distance=points[0].distanceTo(points[1]);if(distance<best.distance)best={distance,theta,phi,fy,fz,points:points.map(p=>p.toArray())};
}
console.log(best);writeFileSync('dev/hand-contact-case.json',JSON.stringify(best,null,2));
