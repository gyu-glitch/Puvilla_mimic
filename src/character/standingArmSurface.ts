import * as THREE from "three";

/** Continuous forearm roll, before skeletal skinning. Unlike blending two
 * matrices through a half turn, rotating each cross-section retains its radius.
 * The shoulder and torso are excluded by the connected-topology mask. */
export class StandingArmSurface {
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
        uPawTurn: this.turn, uPawWrist: this.wrist,
        uSocketActivation: this.socketActivation,
        uSocketRotation: this.correctiveRotation,
        uArmOrigin: { value: this.origin }, uArmAxis: { value: this.axis },
        uArmLength: { value: this.length },
      });
      shader.vertexShader = /* glsl */ `
attribute vec3 connectedArmWeights;
attribute vec3 connectedArmCorrective;
uniform vec4 uSocketRotation[2];
varying float vSocketNormalBlend;
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
void pvArmSurface(vec3 p, vec3 n, out vec3 deformed, out vec3 deformedNormal) {
  int side = position.x >= 0.0 ? 0 : 1;
  vec3 axis=uArmAxis[side], offset=p-uArmOrigin[side];
  float length=uArmLength[side], distance=dot(offset,axis), t=distance/length;
  float mask=clamp(connectedArmWeights.x+connectedArmWeights.y,0.0,1.0);
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
` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader
        .replace("#include <skinbase_vertex>", /* glsl */ `
#include <skinbase_vertex>
float socketWeight=clamp(connectedArmWeights.x+connectedArmWeights.y,0.0,1.0);
vSocketNormalBlend=max(4.0*socketWeight*(1.0-socketWeight),smoothstep(.1,1.0,length(connectedArmCorrective))*uSocketActivation[position.x>=0.0?0:1]);
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
pvArmSurface(position, objectNormal, pawUnused, pawNormal);
objectNormal=pawNormal;
if(pawDQ){
  objectNormal=pvRotateQ(pawReal,objectNormal);
}else{
#include <skinnormal_vertex>
}`)
        .replace("#include <skinning_vertex>", /* glsl */ `
vec3 pawPosition, pawUnusedNormal;
pvArmSurface(transformed, normal, pawPosition, pawUnusedNormal);
transformed=pawPosition;
if(pawDQ){
  transformed=pvRotateQ(pawReal,transformed)+2.0*(pawReal.w*pawDual.xyz-pawDual.w*pawReal.xyz+cross(pawReal.xyz,pawDual.xyz));
  int socketSide=position.x>=0.0?0:1;
  transformed+=pvRotateQ(uSocketRotation[socketSide],connectedArmCorrective)*uSocketActivation[socketSide];
}else{
#include <skinning_vertex>
}`);
      // Reconstruct the junction normal from the deformed surface. Rotating a
      // rest normal alone misses skin-weight derivatives and paints a false cuff.
      shader.fragmentShader='varying float vSocketNormalBlend;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_begin>', /* glsl */ `
#include <normal_fragment_begin>
vec3 socketNormal=normalize(cross(dFdx(vViewPosition),dFdy(vViewPosition)));
normal=normalize(mix(normal,socketNormal,vSocketNormalBlend));
`);
    };
    material.customProgramCacheKey = () => cache + "-anchored-torso-v5";
  }
}
