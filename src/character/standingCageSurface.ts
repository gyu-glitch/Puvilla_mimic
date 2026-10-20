import * as THREE from 'three';
import {subdivide,toBufferGeometry,type PolyMesh} from './subdivide';
import {subdivisionPlans} from './subdivisionPlan';
import {roundedElbowCenter} from './standingBend';
import type {StandingArmSurface} from './standingArmSurface';

const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
type CageRig={weights:number[][];corrective?:number[][];joints:{L:{shoulder:number[];hand:number[]};R:{shoulder:number[];hand:number[]}}};

/** Skin the connected control cage, then evaluate its smooth surface. The
 * original mesh/UVs remain intact; only the arm support region is overridden. */
export class StandingCageSurface {
  private plans;
  private points:Float64Array;
  private normals:Float64Array;
  private faces:number[][];
  private mapping:Float32Array;
  private active:Uint8Array;
  private texture:THREE.DataTexture;
  private data:Float32Array;
  private mesh:THREE.SkinnedMesh|null=null;
  private origin:THREE.Vector3[];
  private axes:THREE.Vector3[];
  private lengths:number[];
  private matrices:THREE.Matrix4[]=[];
  private real:THREE.Quaternion[]=[];
  private dual:THREE.Quaternion[]=[];
  private ready={value:0};
  private previousState:number[]=[];
  evaluationCount=0;
  lastMilliseconds=0;
  constructor(private part:PolyMesh,levels:number,private rig:CageRig,private skin:THREE.BufferGeometry,geo:THREE.BufferGeometry,private surface:StandingArmSurface,private rounded=true){
    this.plans=subdivisionPlans(part,levels);
    this.points=new Float64Array(part.positions.length*3);
    const fine=subdivide(part,levels);
    this.faces=fine.faces;
    this.normals=new Float64Array(fine.positions.length*3);
    const ids=toBufferGeometry({...fine,positions:fine.positions.map((_,i)=>[i,0,0])});
    this.mapping=(ids.getAttribute('position').array as Float32Array).slice();ids.dispose();
    const aw=geo.getAttribute('connectedArmWeights'),co=geo.getAttribute('connectedArmCorrective');
    this.active=Uint8Array.from({length:aw.count},(_,i)=>+(aw.getX(i)+aw.getY(i)>1e-7 || Math.hypot(co.getX(i),co.getY(i),co.getZ(i))>1e-7));
    // Only faces incident to an overridden vertex contribute a used normal.
    // Keep their original order so the summed normals remain bit-identical.
    const activeVertices=new Set<number>();
    this.active.forEach((active,i)=>{if(active)activeVertices.add(this.mapping[i*3]);});
    this.faces=fine.faces.filter(face=>face.some(v=>activeVertices.has(v)));
    this.data=new Float32Array(1024*Math.ceil(aw.count*2/1024)*4);
    this.texture=new THREE.DataTexture(this.data,1024,this.data.length/4096,THREE.RGBAFormat,THREE.FloatType);
    this.texture.needsUpdate=true;
    this.origin=[rig.joints.L,rig.joints.R].map(j=>new THREE.Vector3().fromArray(j.shoulder));
    this.axes=[rig.joints.L,rig.joints.R].map((j,i)=>new THREE.Vector3().fromArray(j.hand).sub(this.origin[i]));
    this.lengths=this.axes.map(a=>a.length());this.axes.forEach(a=>a.normalize());
    geo.addEventListener('dispose',()=>{this.texture.dispose();skin.dispose();});
  }
  bind(mesh:THREE.SkinnedMesh){this.mesh=mesh;this.previousState=[];}
  attach(material:THREE.Material){
    const compile=material.onBeforeCompile,cache=material.customProgramCacheKey();
    material.onBeforeCompile=(shader,renderer)=>{
      compile.call(material,shader,renderer);
      shader.uniforms.uCageSurface={value:this.texture};shader.uniforms.uCageReady=this.ready;
      shader.vertexShader=`uniform sampler2D uCageSurface; uniform float uCageReady;
vec4 cageTex(int i){return texelFetch(uCageSurface,ivec2(i%1024,i/1024),0);}
`+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <skinnormal_vertex>',`#include <skinnormal_vertex>
vec4 cagePosition=cageTex(gl_VertexID*2);
if(uCageReady>.5 && cagePosition.w>.5)objectNormal=cageTex(gl_VertexID*2+1).xyz;`)
        .replace('#include <skinning_vertex>',`#include <skinning_vertex>
if(uCageReady>.5 && cagePosition.w>.5)transformed=cagePosition.xyz;`);
    };
    material.customProgramCacheKey=()=>cache+'-pose-first-cage-v1';material.needsUpdate=true;
  }
  update(){
    const mesh=this.mesh;if(!mesh)return;
    const start=performance.now();mesh.updateWorldMatrix(true,false);
    mesh.bindMatrixInverse.copy(mesh.matrixWorld).invert();
    const skeleton=mesh.skeleton;
    for(let i=0;i<skeleton.bones.length;i++){
      skeleton.bones[i].updateWorldMatrix(true,false);
      const m=this.matrices[i]??=new THREE.Matrix4();
      m.copy(mesh.bindMatrixInverse).multiply(skeleton.bones[i].matrixWorld).multiply(skeleton.boneInverses[i]).multiply(mesh.bindMatrix);
      const q=this.real[i]??=new THREE.Quaternion();q.setFromRotationMatrix(m);
      const e=m.elements,d=this.dual[i]??=new THREE.Quaternion();d.set(e[12],e[13],e[14],0).multiply(q);
      d.set(d.x*.5,d.y*.5,d.z*.5,d.w*.5);
    }
    const state=this.matrices.flatMap(m=>m.elements).concat(this.surface.turn.value.toArray(),this.surface.socketActivation.value.toArray(),this.surface.wrist.value.flatMap(v=>v.toArray()),this.surface.correctiveRotation.value.flatMap(q=>q.toArray()));
    if(state.length===this.previousState.length && state.every((v,i)=>Number.isFinite(v)&&Math.abs(v-this.previousState[i])<1e-9)){
      this.lastMilliseconds=performance.now()-start;return;
    }
    this.previousState=state;this.evaluationCount++;
    const si=this.skin.getAttribute('skinIndex'),sw=this.skin.getAttribute('skinWeight');
    const p=new THREE.Vector3(),v=new THREE.Vector3(),sum=new THREE.Vector3(),local=new THREE.Vector3(),qr=new THREE.Quaternion(),qd=new THREE.Quaternion(),rot=new THREE.Quaternion(),trans=new THREE.Quaternion();
    const bends=this.rounded && this.matrices.length>=8 ? this.axes.map((axis,side)=>{
      const bone=side===0?4:6,upper=axis.clone().transformDirection(this.matrices[bone]),fore=axis.clone().transformDirection(this.matrices[bone+1]);
      const hinge=upper.clone().cross(fore).normalize(),theta=upper.angleTo(fore),len=this.lengths[side];
      const width=Math.min(.60*len,Math.max(.36*len,theta*.32*len));
      return {bone,upper,fore,hinge,theta,width,origin:this.origin[side].clone().applyMatrix4(this.matrices[bone])};
    }):null;
    for(let i=0;i<this.part.positions.length;i++){
      p.fromArray(this.part.positions[i]);const side=p.x>=0?0:1,w=this.rig.weights[i],mask=Math.min(1,w[0]+w[1]);
      const axis=this.axes[side],origin=this.origin[side],len=this.lengths[side];
      const t=v.copy(p).sub(origin).dot(axis)/len;
      p.sub(origin).applyAxisAngle(axis,this.surface.turn.value.getComponent(side)*smooth(.30,.84,t)*mask).add(origin);
      const wrist=this.surface.wrist.value[side],bend=wrist.length();
      if(bend>1e-6){v.copy(origin).addScaledVector(axis,len*.84);p.sub(v).applyQuaternion(rot.setFromAxisAngle(sum.copy(wrist).normalize(),bend*smooth(.81,.86,t)*mask)).add(v);}
      local.copy(p);
      const correction=this.rig.corrective?.[i]??[0,0,0];
      if(mask>1e-7 || Math.hypot(...correction)>1e-7){
        qr.set(0,0,0,0);qd.set(0,0,0,0);const reference=this.real[si.getX(i)];
        for(let k=0;k<4;k++){
          const bone=si.array[i*4+k],q=this.real[bone],d=this.dual[bone],weight=sw.array[i*4+k]*(q.dot(reference)<0?-1:1);
          qr.set(qr.x+q.x*weight,qr.y+q.y*weight,qr.z+q.z*weight,qr.w+q.w*weight);
          qd.set(qd.x+d.x*weight,qd.y+d.y*weight,qd.z+d.z*weight,qd.w+d.w*weight);
        }
        const length=qr.length();qr.normalize();qd.set(qd.x/length,qd.y/length,qd.z/length,qd.w/length);
        trans.copy(qr).conjugate().premultiply(qd);p.applyQuaternion(qr);p.x+=2*trans.x;p.y+=2*trans.y;p.z+=2*trans.z;
      }else{
        sum.set(0,0,0);for(let k=0;k<4;k++)sum.addScaledVector(v.copy(p).applyMatrix4(this.matrices[si.array[i*4+k]]),sw.array[i*4+k]);p.copy(sum);
      }
      if(bends){
        let armInfluence=0;for(let k=0;k<4;k++)if(si.array[i*4+k]>=4)armInfluence+=sw.array[i*4+k];
        const blend=smooth(.95,1,Math.min(mask,armInfluence));
        if(blend>0){
          const b=bends[side],distance=v.copy(local).sub(origin).dot(axis);
          const center=roundedElbowCenter(distance,len,b.upper,b.fore).add(b.origin);
          v.addScaledVector(axis,-distance).applyQuaternion(this.real[b.bone]);
          v.applyAxisAngle(b.hinge,b.theta*smooth(.5*len-.5*b.width,.5*len+.5*b.width,distance));
          p.lerp(center.add(v),blend);
        }
      }
      p.add(v.fromArray(correction).applyQuaternion(this.surface.correctiveRotation.value[side]).multiplyScalar(this.surface.socketActivation.value.getComponent(side)));
      p.toArray(this.points,i*3);
    }
    let fine=this.points;for(const plan of this.plans)fine=plan.evaluate(fine);
    const normals=this.normals;normals.fill(0);
    for(const face of this.faces){
      let x=0,y=0,z=0;
      for(let k=0;k<face.length;k++){const a=face[k]*3,b=face[(k+1)%face.length]*3;
        x+=(fine[a+1]-fine[b+1])*(fine[a+2]+fine[b+2]);y+=(fine[a+2]-fine[b+2])*(fine[a]+fine[b]);z+=(fine[a]-fine[b])*(fine[a+1]+fine[b+1]);}
      for(const index of face){const j=index*3;normals[j]+=x;normals[j+1]+=y;normals[j+2]+=z;}
    }
    for(let i=0;i<this.active.length;i++){
      if(!this.active[i])continue;const j=this.mapping[i*3]*3,o=i*8,n=Math.hypot(normals[j],normals[j+1],normals[j+2])||1;
      this.data[o]=fine[j];this.data[o+1]=fine[j+1];this.data[o+2]=fine[j+2];this.data[o+3]=1;
      this.data[o+4]=normals[j]/n;this.data[o+5]=normals[j+1]/n;this.data[o+6]=normals[j+2]/n;
    }
    this.texture.needsUpdate=true;this.ready.value=1;this.lastMilliseconds=performance.now()-start;
  }
}
