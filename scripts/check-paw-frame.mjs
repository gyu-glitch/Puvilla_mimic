import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Vector3,Quaternion} from 'three';
import {standingPawRoll,standingFrontPawRoll} from '../src/character/standingPawFrame.ts';
const rig=JSON.parse(readFileSync('public/models/stand_connected_cage_rig.json','utf8'));
const rows=[];
for(const side of [-1,1])for(const phi of [0,.6,1.2,1.57])for(const theta of [1.5,2,2.5]){
 const j=rig.joints[side>0?'L':'R'],rest=new Vector3(...j.hand).sub(new Vector3(...j.shoulder)).normalize();
 const upperDir=new Vector3(side*Math.sin(theta)*Math.cos(phi),-Math.cos(theta),Math.sin(theta)*Math.sin(phi));
 // Raise the forearm upright while the elbow points sideways or forwards.
 const direction=new Vector3(side*.2,.96,.2).normalize(),u=new Quaternion().setFromUnitVectors(rest,upperDir);
 const f=new Quaternion().setFromUnitVectors(rest,direction.clone().applyQuaternion(u.clone().invert()));
 const across=new Vector3(-side,0,0).addScaledVector(direction,side*direction.x).normalize(),base=-side*Math.PI/2;
 const roll=standingPawRoll(rest,u,f,base,direction,across);assert.notEqual(roll,null);
 const original=new Vector3(0,0,1).addScaledVector(rest,-rest.z).normalize();
 const actual=r=>original.clone().applyAxisAngle(rest,base+r).applyQuaternion(f).applyQuaternion(u);
 const before=actual(0).angleTo(across),after=actual(roll).angleTo(across);
 assert.ok(after<1e-6);
 const front=standingFrontPawRoll(rest,u,f,side,base);
 const screenAcross=direction.clone().cross(new Vector3(0,0,1)).multiplyScalar(-side).normalize();
 const zero=standingPawRoll(rest,u,f,front,direction,screenAcross);
 assert.ok(Math.abs(zero)<1e-6,'a front palm inherited the elbow plane twist');
 const turned=screenAcross.clone().applyAxisAngle(direction,.5);
 assert.ok(Math.abs(standingPawRoll(rest,u,f,front,direction,turned)-.5)<1e-6,'measured palm turn was double counted');
 rows.push({side,phi,theta,beforeDeg:before*180/Math.PI,afterDeg:after*180/Math.PI,correction:roll});
 // A known measured 30-degree turn must remain 30 degrees after retargeting.
 const rotated=across.clone().applyAxisAngle(direction,.5),r2=standingPawRoll(rest,u,f,base,direction,rotated);
 assert.ok(actual(r2).angleTo(rotated)<1e-6);
 assert.equal(standingPawRoll(rest,u,f,base,direction,direction),null,'edge-on collapsed span must be rejected');
}
console.log(rows.filter(r=>r.phi===1.57));
console.log({samples:rows.length,maxBeforeDegrees:Math.max(...rows.map(r=>r.beforeDeg)),maxAfterDegrees:Math.max(...rows.map(r=>r.afterDeg)),maxCorrection:Math.max(...rows.map(r=>Math.abs(r.correction)))});
