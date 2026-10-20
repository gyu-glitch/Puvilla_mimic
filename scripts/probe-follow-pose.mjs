import {readFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const T=await import('three');
const {standingUpperDirection}=await import('../src/character/standingArmPose.ts');
const {clearStandingForearm}=await import('../src/character/standingHeadClearance.ts');
const {clearStandingTorso}=await import('../src/character/standingTorsoClearance.ts');
const rig=JSON.parse(readFileSync('public/models/stand_connected_cage_rig.json','utf8'));
const rows=[];
for(const side of [-1,1])for(const phi of [0,.4,.8,1.2,1.57])for(const theta of [.3,.7,1.2,1.7,2.2,2.7,3]){
 const j=rig.joints[side>0?'L':'R'],s=new T.Vector3(...j.shoulder),rest=new T.Vector3(...j.hand).sub(s),len=rest.length();rest.normalize();
 const human=new T.Vector3(side*Math.sin(theta)*Math.cos(phi),-Math.cos(theta),Math.sin(theta)*Math.sin(phi));
 const u=new T.Quaternion().setFromUnitVectors(rest,standingUpperDirection(side,rest,human,3,true)),f=new T.Quaternion();
 clearStandingTorso(s,len,rest,u,f,new T.Quaternion());
 clearStandingForearm(s,len,rest,u,f,new T.Quaternion());
 const upper=rest.clone().applyQuaternion(u),fore=rest.clone().applyQuaternion(f).applyQuaternion(u);
 rows.push({side,theta,phi,inputBend:0,outputBend:upper.angleTo(fore)*180/Math.PI,upperError:upper.angleTo(human)*180/Math.PI});
}
rows.sort((a,b)=>b.outputBend-a.outputBend);console.log(rows.slice(0,10));
