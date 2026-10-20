import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const T=await import('three');
const {parseObj,subdivide,toBufferGeometry}=await import('../src/character/subdivide.ts');
const {StandingCageSurface}=await import('../src/character/standingCageSurface.ts');
const {StandingArmSurface}=await import('../src/character/standingArmSurface.ts');
const {StandingShoulderMetric}=await import('../src/character/standingShoulderMetric.ts');
const part=parseObj(readFileSync('public/models/pu_stand.obj','utf8')).find(p=>p.name==='pu_body');
const rig=JSON.parse(readFileSync('public/models/stand_connected_cage_rig.json','utf8'));
const metric=new StandingShoulderMetric(part.positions,part.faces,rig.weights);
const smooth=(a,b,x)=>{const t=T.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const geo=toBufferGeometry(subdivide(part,2)),skin=new T.BufferGeometry();
for(const [name,values] of [['connectedArmWeights',rig.weights],['connectedArmCorrective',rig.corrective]])geo.setAttribute(name,toBufferGeometry(subdivide({...part,positions:values},2)).getAttribute('position'));
const indices=[],weights=[];
for(let i=0;i<part.positions.length;i++){
 const p=part.positions[i],w=rig.weights[i],u=p[0]>=0?4:6,neck=smooth(112,131,p[1]),wa=(w[0]+w[1])*(1-neck),wf=w[2]*(1-neck);
 indices.push(0,u,u+1,3);weights.push(1-neck-wa,wa-wf,wf,neck);
}
skin.setAttribute('skinIndex',new T.Uint16BufferAttribute(indices,4));skin.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));
const surface=new StandingArmSurface(rig.joints),cage=new StandingCageSurface(part,2,rig,skin,geo,surface);
const root=new T.Group(),mesh=new T.SkinnedMesh(geo,new T.MeshBasicMaterial()),bones=Array.from({length:8},()=>new T.Bone());root.add(mesh,...bones);
for(const [side,u,f] of [['L',4,5],['R',6,7]]){bones[u].position.fromArray(rig.joints[side].shoulder);bones[f].position.fromArray(rig.joints[side].elbow);bones[u].attach(bones[f]);}
root.updateMatrixWorld(true);mesh.bind(new T.Skeleton(bones));cage.bind(mesh);
const edges=new Map();for(const face of part.faces)for(let k=0;k<face.length;k++){const a=face[k],b=face[(k+1)%face.length],key=[a,b].sort((x,y)=>x-y).join(',');edges.set(key,[a,b]);}
const rows=[];
for(const theta of [0,1,1.57,2.32,2.8]){
 for(const [side,u,f] of [['L',4,5],['R',6,7]]){
  const j=rig.joints[side],axis=new T.Vector3(...j.hand).sub(new T.Vector3(...j.shoulder)).normalize(),sign=side==='L'?1:-1;
  const polar=a=>new T.Vector3(sign*Math.sin(a)*Math.cos(.08),-Math.cos(a),Math.sin(a)*Math.sin(.08));
  const upper=theta?polar(theta):axis,fore=theta?polar(theta+.48):axis;
  bones[u].quaternion.setFromUnitVectors(axis,upper);bones[f].quaternion.setFromUnitVectors(axis,fore.clone().applyQuaternion(bones[u].quaternion.clone().invert()));
  surface.turn.value.setComponent(side==='L'?0:1,theta?-sign*Math.PI/2:0);
  surface.socketActivation.value.setComponent(side==='L'?0:1,smooth(-.35,.70,upper.y));
  surface.correctiveRotation.value[side==='L'?0:1].copy(bones[u].quaternion).multiply(new T.Quaternion().setFromUnitVectors(axis,polar(2.32)).invert());
 }
 cage.update();
 const corrected=cage.points.slice();metric.apply(corrected);
 let displacement=0,anchors=0,paw=0;
 for(let i=0;i<part.positions.length;i++){
  const d=Math.hypot(...[0,1,2].map(k=>corrected[i*3+k]-cage.points[i*3+k]));displacement=Math.max(displacement,d);
  if(rig.torsoAnchors.includes(i))anchors=Math.max(anchors,d);
  if(rig.weights[i][0]+rig.weights[i][1]>.999)paw=Math.max(paw,d);
 }
 const strained=[];
 for(const [a,b] of edges.values()){
  if(part.positions[a][0]<0||part.positions[b][0]<0)continue;
  if(![a,b].some(i=>rig.weights[i][0]>0&&rig.weights[i][0]<.999))continue;
  const p=new T.Vector3(...part.positions[a]),q=new T.Vector3(...part.positions[b]),rest=p.distanceTo(q);
  const posed=new T.Vector3().fromArray(cage.points,a*3).distanceTo(new T.Vector3().fromArray(cage.points,b*3));
  const after=new T.Vector3().fromArray(corrected,a*3).distanceTo(new T.Vector3().fromArray(corrected,b*3));
  strained.push({a,b,ratio:posed/rest,afterRatio:after/rest,rest,posed,pa:part.positions[a],pb:part.positions[b],wa:rig.weights[a][0],wb:rig.weights[b][0]});
 }
 strained.sort((a,b)=>b.ratio-a.ratio);rows.push({theta,edges:strained.length,displacement,anchors,paw,afterMax:Math.max(...strained.map(e=>e.afterRatio)),afterMin:Math.min(...strained.map(e=>e.afterRatio)),max:strained[0],min:strained.at(-1),top:strained.slice(0,12)});
}
writeFileSync('dev/shoulder-shape-probe.json',JSON.stringify(rows,null,2));
console.log(rows.map(({theta,displacement,anchors,paw,afterMax,afterMin,max,min})=>({theta,displacement,anchors,paw,beforeMax:max.ratio,afterMax,beforeMin:min.ratio,afterMin})));
