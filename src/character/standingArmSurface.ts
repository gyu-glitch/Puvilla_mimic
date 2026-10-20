import * as THREE from "three";

/** Continuous forearm roll, before skeletal skinning. Unlike blending two
 * matrices through a half turn, rotating each cross-section retains its radius.
 * The shoulder and torso are excluded by the connected-topology mask. */
export class StandingArmSurface {
  readonly normalProbes = { value: null as THREE.DataTexture | null };
  readonly turn = { value: new THREE.Vector2() };
  readonly socketActivation = { value: new THREE.Vector2() };
  readonly wrist = { value: [new THREE.Vector3(), new THREE.Vector3()] };
  readonly correctiveRotation = { value: [new THREE.Quaternion(), new THREE.Quaternion()] };
  private origin: THREE.Vector3[];
  private axis: THREE.Vector3[];
  private length: number[];

  constructor(joints: { L: { shoulder: number[]; hand: number[] }; R: { shoulder: number[]; hand: number[] } }) {
    this.origin = [joints.L, joints.R].map(j => new THREE.Vector3(...j.shoulder as [number, number, number]));
    const end = [joints.L, joints.R].map(j => new THREE.Vector3(...j.hand as [number, number, number]));
    this.axis = end.map((p, i) => p.sub(this.origin[i]));
    this.length = this.axis.map(a => a.length());
    this.axis.forEach(a => a.normalize());
  }

  attach(material: THREE.Material): void {
    const compile = material.onBeforeCompile;
    const cache = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      compile.call(material, shader, renderer);
      Object.assign(shader.uniforms, {
        uPawTurn: this.turn, uPawWrist: this.wrist, uSocketProbes: this.normalProbes,
        uSocketActivation: this.socketActivation,
        uSocketRotation: this.correctiveRotation,
        uArmOrigin: { value: this.origin }, uArmAxis: { value: this.axis },
        uArmLength: { value: this.length },
      });
      shader.vertexShader = /* glsl */ `
attribute vec3 connectedArmWeights;
attribute vec3 connectedArmCorrective;
uniform vec4 uSocketRotation[2];
uniform sampler2D uSocketProbes;
uniform vec2 uPawTurn, uSocketActivation;
uniform vec3 uPawWrist[2];
uniform vec3 uArmOrigin[2], uArmAxis[2];
uniform float uArmLength[2];
vec4 pvMulQ(vec4 a, vec4 b){return vec4(a.w*b.xyz+b.w*a.xyz+cross(a.xyz,b.xyz),a.w*b.w-dot(a.xyz,b.xyz));}
vec3 pvRotateQ(vec4 q,vec3 v){return v+2.0*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
vec4 pvRotation(mat4 m){
  float trace=m[0][0]+m[1][1]+m[2][2];
  if(trace>0.0){float s=sqrt(trace+1.0)*2.0;return vec4((m[1][2]-m[2][1])/s,(m[2][0]-m[0][2])/s,(m[0][1]-m[1][0])/s,.25*s);}
  if(m[0][0]>m[1][1]&&m[0][0]>m[2][2]){float s=sqrt(1.0+m[0][0]-m[1][1]-m[2][2])*2.0;return vec4(.25*s,(m[1][0]+m[0][1])/s,(m[2][0]+m[0][2])/s,(m[1][2]-m[2][1])/s);}
  if(m[1][1]>m[2][2]){float s=sqrt(1.0+m[1][1]-m[0][0]-m[2][2])*2.0;return vec4((m[1][0]+m[0][1])/s,.25*s,(m[2][1]+m[1][2])/s,(m[2][0]-m[0][2])/s);}
  float s=sqrt(1.0+m[2][2]-m[0][0]-m[1][1])*2.0;return vec4((m[2][0]+m[0][2])/s,(m[2][1]+m[1][2])/s,.25*s,(m[0][1]-m[1][0])/s);
}
void pvAddDQ(mat4 m,float weight,vec4 reference,inout vec4 real,inout vec4 dual){
  vec4 q=pvRotation(m);float w=dot(q,reference)<0.0?-weight:weight;
  real+=q*w;dual+=.5*pvMulQ(vec4(m[3].xyz,0.0),q)*w;
}
vec3 pvArmRotate(vec3 p, vec3 axis, float a) {
  return p*cos(a)+cross(axis,p)*sin(a)+axis*dot(axis,p)*(1.0-cos(a));
}
// Integrate unit tangents to preserve limb length through a rounded elbow.
// Upper arm and paw stay rigid outside this transition; the torso is untouched.
void pvRoundedElbow(vec3 p,vec3 n,mat4 upperM,mat4 foreM,out vec3 bent,out vec3 bentNormal) {
  int side=position.x>=0.0?0:1;
  vec3 restAxis=uArmAxis[side],delta=p-uArmOrigin[side];
  float distance=dot(delta,restAxis),len=uArmLength[side];
  vec3 upper=normalize(mat3(upperM)*restAxis),fore=normalize(mat3(foreM)*restAxis);
  vec3 hinge=cross(upper,fore);
  float theta=acos(clamp(dot(upper,fore),-1.0,1.0));
  bent=(upperM*vec4(p,1.0)).xyz;
  bentNormal=normalize(mat3(upperM)*n);
  if(theta<.00001||length(hinge)<.00001)return;
  hinge=normalize(hinge);
  float width=min(.60*len,max(.36*len,theta*.32*len)),start=.5*len-.5*width;
  if(distance<=start)return;
  float amount=min(distance-start,width);
  vec3 center=(upperM*vec4(uArmOrigin[side],1.0)).xyz+upper*start;
  float nodes[6]=float[6](.033765242898424,.169395306766868,.380690406958402,.619309593041598,.830604693233132,.966234757101576);
  float weights[6]=float[6](.085662246189585,.180380786524069,.233956967286346,.233956967286346,.180380786524069,.085662246189585);
  for(int k=0;k<6;k++){
    float t=amount*nodes[k]/width;
    center+=pvArmRotate(upper,hinge,theta*t*t*(3.0-2.0*t))*(amount*weights[k]);
  }
  center+=fore*max(0.0,distance-start-width);
  float t=clamp((distance-start)/width,0.0,1.0);
  vec3 radial=mat3(upperM)*(delta-restAxis*distance);
  float angle=theta*t*t*(3.0-2.0*t);
  radial=pvArmRotate(radial,hinge,angle);
  bent=center+radial;
  vec3 tangent=pvArmRotate(upper,hinge,angle);
  vec3 nr=pvArmRotate(mat3(upperM)*n,hinge,angle);
  vec3 derivative=cross(hinge,radial)*(theta*6.0*t*(1.0-t)/width);
  bentNormal=normalize(nr-tangent*dot(derivative,nr)/max(.1,1.0+dot(tangent,derivative)));
}
void pvArmSurface(vec3 p, vec3 n, vec3 armWeights, out vec3 deformed, out vec3 deformedNormal) {
  int side = position.x >= 0.0 ? 0 : 1;
  vec3 axis=uArmAxis[side], offset=p-uArmOrigin[side];
  float length=uArmLength[side], distance=dot(offset,axis), t=distance/length;
  float mask=clamp(armWeights.x+armWeights.y,0.0,1.0);
  float a=uPawTurn[side]*smoothstep(.30,.84,t)*mask;
  vec3 radial=offset-axis*distance;
  vec3 rr=pvArmRotate(radial,axis,a);
  deformed=uArmOrigin[side]+axis*distance+rr;
  // Cross-sections only rotate: the guidebook's source dimensions are retained.
  float at=clamp((t-.30)/.54,0.0,1.0);
  float da=uPawTurn[side]*mask*6.0*at*(1.0-at)/(.54*length);
  vec3 rn=pvArmRotate(n-axis*dot(n,axis),axis,a);
  vec3 tangent=cross(axis,rr)*da;
  deformedNormal=normalize(rn+axis*(dot(n,axis)-dot(rn,tangent)));
  // A separate soft wrist: palm motion no longer rotates the entire forearm.
  // Keep the transition differentiable, including its normal transform.
  float bend=sqrt(dot(uPawWrist[side],uPawWrist[side]));
  if(bend>.00001){
    vec3 hinge=uPawWrist[side]/bend;
    float bt=clamp((t-.81)/.05,0.0,1.0);
    float angle=bend*bt*bt*(3.0-2.0*bt)*mask;
    float derivative=bend*6.0*bt*(1.0-bt)/(.05*length)*mask;
    vec3 center=uArmOrigin[side]+axis*length*.84;
    vec3 v=deformed-center, tangentB=cross(hinge,v), gradient=axis*derivative;
    vec3 corrected=deformedNormal-gradient*dot(tangentB,deformedNormal)/max(.25,1.0+dot(gradient,tangentB));
    deformed=center+pvArmRotate(v,hinge,angle);
    deformedNormal=normalize(pvArmRotate(corrected,hinge,angle));
  }
}
vec4 pvProbeTexel(int i){return texelFetch(uSocketProbes,ivec2(i%1024,i/1024),0);}
vec3 pvProbeDeform(vec3 p,vec3 aw,vec3 correction,vec4 sw,mat4 mx,mat4 my,mat4 mz,mat4 mw,mat4 upperM,mat4 foreM){
  vec3 point,unused;
  pvArmSurface(p,vec3(0.0,1.0,0.0),aw,point,unused);
  vec4 reference=pvRotation(mx),qr=vec4(0.0),qd=vec4(0.0);
  pvAddDQ(mx,sw.x,reference,qr,qd);pvAddDQ(my,sw.y,reference,qr,qd);
  pvAddDQ(mz,sw.z,reference,qr,qd);pvAddDQ(mw,sw.w,reference,qr,qd);
  float magnitude=max(length(qr),.00001);qr/=magnitude;qd/=magnitude;qd-=qr*dot(qr,qd);
  vec3 result=pvRotateQ(qr,point)+2.0*(qr.w*qd.xyz-qd.w*qr.xyz+cross(qr.xyz,qd.xyz));
  float weight=smoothstep(.95,1.0,aw.x+aw.y);
  if(weight>0.0){vec3 bent,bn;pvRoundedElbow(point,vec3(0.0,1.0,0.0),upperM,foreM,bent,bn);result=mix(result,bent,weight);}
  int side=position.x>=0.0?0:1;
  return result+pvRotateQ(uSocketRotation[side],correction)*uSocketActivation[side];
}
` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader
        .replace("#include <skinbase_vertex>", /* glsl */ `
#include <skinbase_vertex>
float socketWeight=clamp(connectedArmWeights.x+connectedArmWeights.y,0.0,1.0);
float socketNormalBlend=max(4.0*socketWeight*(1.0-socketWeight),smoothstep(.1,1.0,length(connectedArmCorrective))*uSocketActivation[position.x>=0.0?0:1]);
vec4 pawReal=vec4(0.0,0.0,0.0,1.0),pawDual=vec4(0.0);
bool pawDQ=connectedArmWeights.x+connectedArmWeights.y>.0001;
if(pawDQ){
  mat4 px=bindMatrixInverse*boneMatX*bindMatrix;
  vec4 reference=pvRotation(px);pawReal=vec4(0.0);
  pvAddDQ(px,skinWeight.x,reference,pawReal,pawDual);
  pvAddDQ(bindMatrixInverse*boneMatY*bindMatrix,skinWeight.y,reference,pawReal,pawDual);
  pvAddDQ(bindMatrixInverse*boneMatZ*bindMatrix,skinWeight.z,reference,pawReal,pawDual);
  pvAddDQ(bindMatrixInverse*boneMatW*bindMatrix,skinWeight.w,reference,pawReal,pawDual);
  float magnitude=max(length(pawReal),.00001);pawReal/=magnitude;pawDual/=magnitude;
  pawDual-=pawReal*dot(pawReal,pawDual);
}`)
        .replace("#include <skinnormal_vertex>", /* glsl */ `
vec3 pawUnused, pawNormal;
pvArmSurface(position, objectNormal, connectedArmWeights, pawUnused, pawNormal);
objectNormal=pawNormal;
if(pawDQ){
  objectNormal=pvRotateQ(pawReal,objectNormal);
  float bendWeight=smoothstep(.95,1.0,connectedArmWeights.x+connectedArmWeights.y);
  if(bendWeight>0.0){
    bool left=position.x>=0.0;
    mat4 upperM=bindMatrixInverse*getBoneMatrix(left?4.0:6.0)*bindMatrix;
    mat4 foreM=bindMatrixInverse*getBoneMatrix(left?5.0:7.0)*bindMatrix;
    vec3 unused,bentNormal;
    pvRoundedElbow(pawUnused,pawNormal,upperM,foreM,unused,bentNormal);
    objectNormal=normalize(mix(objectNormal,bentNormal,bendWeight));
  }
  if(socketNormalBlend>.001){
    mat4 mx=bindMatrixInverse*boneMatX*bindMatrix,my=bindMatrixInverse*boneMatY*bindMatrix;
    mat4 mz=bindMatrixInverse*boneMatZ*bindMatrix,mw=bindMatrixInverse*boneMatW*bindMatrix;
    bool left=position.x>=0.0;
    mat4 upperM=bindMatrixInverse*getBoneMatrix(left?4.0:6.0)*bindMatrix;
    mat4 foreM=bindMatrixInverse*getBoneMatrix(left?5.0:7.0)*bindMatrix;
    vec3 center=pvProbeDeform(position,connectedArmWeights,connectedArmCorrective,skinWeight,mx,my,mz,mw,upperM,foreM);
    int base=gl_VertexID*8;
    vec3 du=pvProbeDeform(pvProbeTexel(base).xyz,pvProbeTexel(base+2).xyz,pvProbeTexel(base+3).xyz,pvProbeTexel(base+1),mx,my,mz,mw,upperM,foreM)-center;
    vec3 dv=pvProbeDeform(pvProbeTexel(base+4).xyz,pvProbeTexel(base+6).xyz,pvProbeTexel(base+7).xyz,pvProbeTexel(base+5),mx,my,mz,mw,upperM,foreM)-center;
    vec3 surfaceNormal=cross(du,dv);
    if(dot(surfaceNormal,surfaceNormal)>1e-12)objectNormal=normalize(mix(objectNormal,normalize(surfaceNormal),socketNormalBlend));
  }
}else{
#include <skinnormal_vertex>
}`)
        .replace("#include <skinning_vertex>", /* glsl */ `
vec3 pawPosition, pawUnusedNormal;
pvArmSurface(transformed, normal, connectedArmWeights, pawPosition, pawUnusedNormal);
transformed=pawPosition;
if(pawDQ){
  transformed=pvRotateQ(pawReal,transformed)+2.0*(pawReal.w*pawDual.xyz-pawDual.w*pawReal.xyz+cross(pawReal.xyz,pawDual.xyz));
  float bendWeight=smoothstep(.95,1.0,connectedArmWeights.x+connectedArmWeights.y);
  if(bendWeight>0.0){
    bool left=position.x>=0.0;
    mat4 upperM=bindMatrixInverse*getBoneMatrix(left?4.0:6.0)*bindMatrix;
    mat4 foreM=bindMatrixInverse*getBoneMatrix(left?5.0:7.0)*bindMatrix;
    vec3 bent,bentNormal;
    pvRoundedElbow(pawPosition,normal,upperM,foreM,bent,bentNormal);
    transformed=mix(transformed,bent,bendWeight);
  }
  int socketSide=position.x>=0.0?0:1;
  transformed+=pvRotateQ(uSocketRotation[socketSide],connectedArmCorrective)*uSocketActivation[socketSide];
}else{
#include <skinning_vertex>
}`);
      // Interpolate smooth vertex normals from deformed tangent probes. Flat
      // fragment derivatives made the shoulder look like stacked rings.
    };
    material.customProgramCacheKey = () => cache + "-socket-probe-v7";
  }
}
