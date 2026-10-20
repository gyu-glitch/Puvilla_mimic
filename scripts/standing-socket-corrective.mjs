import * as T from 'three';

// Pose-space fairing of the connected shoulder cage. The source mesh and all
// topology stay untouched; only a zero-at-rest corrective attribute is baked.
export function socketCorrective(P, neighbors, weights, joints) {
 const v=a=>new T.Vector3(...a), smooth=(a,b,x)=>{const t=T.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
 const sides=[1,-1].map(side=>{
  const j=joints[side>0?'L':'R'],s=v(j.shoulder),e=v(j.elbow),axis=v(j.hand).sub(s),length=axis.length();axis.normalize();
  const polar=a=>new T.Vector3(side*Math.sin(a)*Math.cos(.08),-Math.cos(a),Math.sin(a)*Math.sin(.08));
  const upper=new T.Quaternion().setFromUnitVectors(axis,polar(2.32));
  const fore=new T.Quaternion().setFromUnitVectors(axis,polar(2.80).applyQuaternion(upper.clone().invert()));
  const around=(p,q)=>new T.Matrix4().makeTranslation(...p.toArray()).multiply(new T.Matrix4().makeRotationFromQuaternion(q)).multiply(new T.Matrix4().makeTranslation(...p.clone().negate().toArray()));
  const matrices=[new T.Matrix4(),around(s,upper),around(s,upper).multiply(around(e,fore))];
  const dq=matrices.map(m=>{const q=new T.Quaternion().setFromRotationMatrix(m),tr=new T.Vector3().setFromMatrixPosition(m);return {q,d:new T.Quaternion(tr.x,tr.y,tr.z,0).multiply(q).toArray().map(x=>x*.5)};});
  return {s,axis,length,dq,side};
 });
 const region=[];
 const posed=P.map((p,i)=>{
  const {s,axis,length,dq,side}=sides[p[0]>=0?0:1],mask=weights[i][0]+weights[i][1];
  const offset=v(p).sub(s),d=offset.dot(axis),t=d/length;
  region[i]=smooth(.005,.18,mask)*(1-smooth(.18,.48,t));
  if(p[1]>=119||Math.abs(p[0])<=15)region[i]=0;
  const shape=.43*smooth(-.18,.06,t)*(1-smooth(.22,.58,t))*mask;
  const width=new T.Vector3().crossVectors(axis,new T.Vector3(0,0,1)).normalize(),depth=new T.Vector3().crossVectors(width,axis);
  const radial=width.multiplyScalar(offset.dot(width)*(1-shape*.4)).add(depth.multiplyScalar(offset.dot(depth)*(1-shape)));
  radial.applyAxisAngle(axis,side*(-Math.PI/2)*smooth(.3,.84,t)*mask);
  const point=s.clone().addScaledVector(axis,d).add(radial);
  const neck=smooth(112,131,p[1]),wa=mask*(1-neck),wf=weights[i][2]*(1-neck),w=[1-wa,wa-wf,wf];
  const qr=[0,0,0,0],qd=[0,0,0,0];
  dq.forEach(({q,d},k)=>{const sign=q.w<0?-1:1,qa=q.toArray();for(let n=0;n<4;n++){qr[n]+=qa[n]*w[k]*sign;qd[n]+=d[n]*w[k]*sign;}});
  const magnitude=Math.hypot(...qr);for(let k=0;k<4;k++){qr[k]/=magnitude;qd[k]/=magnitude;}
  const dot=qr.reduce((sum,x,k)=>sum+x*qd[k],0);for(let k=0;k<4;k++)qd[k]-=qr[k]*dot;
  const rotation=new T.Quaternion(...qr),translation=new T.Quaternion(...qd).multiply(rotation.clone().conjugate());
  point.applyQuaternion(rotation).add(new T.Vector3(translation.x,translation.y,translation.z).multiplyScalar(2));
  point.y+=7.5*mask*smooth(-.25,0,t)*(1-smooth(.03,.40,t));
  return point;
 });
 let fair=posed.map(p=>p.clone());
 for(let pass=0;pass<28;pass++){
  fair=fair.map((p,i)=>{
   if(region[i]===0)return p;
   const average=new T.Vector3();let sum=0;
   for(const [j,d] of neighbors[i]){const weight=1/Math.max(1,d);average.addScaledVector(fair[j],weight);sum+=weight;}
   return p.clone().lerp(average.divideScalar(sum),.48*region[i]);
  });
 }
 const correction=fair.map((p,i)=>p.sub(posed[i]).toArray());
 console.log('Socket corrective maximum cm:',Math.max(...correction.map(p=>Math.hypot(...p))).toFixed(2));
 return correction;
}
