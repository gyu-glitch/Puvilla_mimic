import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const T=await import('three');const {BodyProcessor}=await import('../src/body.ts');
const {armPalmFixture}=await import('../dev/arm-palm-fixture.ts');
const {PuuvillaCharacter}=await import('../src/character/puuvilla.ts');
const {StandingElbowPlane}=await import('../src/character/standingElbowPlane.ts');
const {standingPawRoll,standingFrontPawRoll}=await import('../src/character/standingPawFrame.ts');
const {StandingPawTracking}=await import('../src/character/standingPawTracking.ts');
const rig=JSON.parse(readFileSync('public/models/stand_connected_cage_mirrorleft.json'));
const cfg=JSON.parse(readFileSync('public/config.json'));cfg.body.armImagePalm=false; // Audit the deployed v32 3D path.
const rows=[];const rad=180/Math.PI;
for(const mirror of [true,false])for(const time of [3,5,6,8,11])for(const turn of [-1,-.6,0,.6,1,Math.PI]){
 const raw=armPalmFixture(time).raw;
 for(const [w,ix,pk,side] of [[15,19,17,1],[16,20,18,-1]]){
  const p=raw.world[w];for(const [id,sign] of [[ix,-1],[pk,1]]){
   raw.world[id]={x:p.x+sign*side*.035*Math.cos(turn),y:p.y-.085,z:p.z+sign*.035*Math.sin(turn),visibility:1};
   raw.image[id]={x:.5+raw.world[id].x*.65/raw.imageAspect,y:.88+raw.world[id].y*.65};
  }
 }
 const config=structuredClone(cfg);config.camera.mirror=mirror;
 const bp=new BodyProcessor(config);let pose;for(let k=0;k<60;k++)pose=bp.update(raw,true,k*1000/30);
 const fake={cfg:config,connectedArms:true,armsFree:false,elbowPlanes:[new StandingElbowPlane(),new StandingElbowPlane()]};
 const out=[];
 for(const side of [1,-1]){
  const name=side>0?'L':'R',j=rig.joints[name],rest=new T.Vector3(...j.hand).sub(new T.Vector3(...j.shoulder)).normalize();
  const arm={side,restUpper:rest,restFore:rest,restPolar:Math.acos(-rest.y)},u=new T.Quaternion(),f=new T.Quaternion();
  PuuvillaCharacter.prototype.solveArm.call(fake,arm,pose,new T.Quaternion(),u,f,1/30);
  const direction=rest.clone().applyQuaternion(f).applyQuaternion(u);
  const base=standingFrontPawRoll(rest,u,f,side,-side*Math.PI/2);
  const human=new T.Vector3(...pose['wrist'+name]).sub(new T.Vector3(...pose['elbow'+name])).normalize();
  const across=new T.Vector3(...pose['handAcross'+name]),forward=new T.Vector3(...pose['handDirection'+name]);
  const roll=standingPawRoll(rest,u,f,base,human,across,forward,new T.Vector3());
  const tracker=new StandingPawTracking();tracker.update(roll,null,0,1/30);
  const actual=new T.Vector3(0,0,1).addScaledVector(rest,-rest.z).normalize().applyAxisAngle(rest,base+tracker.roll).applyQuaternion(f).applyQuaternion(u);
  out.push({base,roll,accepted:tracker.roll,actual:actual.toArray(),u:u.toArray(),f:f.toArray()});
 }
 const reflected=new T.Vector3(...out[1].actual);reflected.x=-reflected.x;
 const err=new T.Vector3(...out[0].actual).distanceTo(reflected),sign=Math.abs(Math.atan2(Math.sin(out[0].roll+out[1].roll),Math.cos(out[0].roll+out[1].roll)));
 assert.ok(err<1e-6,`asymmetric final palm ${mirror}/${time}/${turn}: ${err}`);assert.ok(sign<1e-6,'same-signed mirrored rotation');
 rows.push({mirror,time,turnDegrees:turn*rad,leftRollDegrees:out[0].roll*rad,rightRollDegrees:out[1].roll*rad,accepted:out.map(x=>x.accepted*rad),mirrorVectorError:err});
}
console.log(JSON.stringify({scope:'BodyProcessor -> solveArm -> front frame -> observed palm -> v31 rejection. Symmetric controlled input, not measured camera data.',samples:rows.length,maxMirrorVectorError:Math.max(...rows.map(x=>x.mirrorVectorError)),rows},null,2));
