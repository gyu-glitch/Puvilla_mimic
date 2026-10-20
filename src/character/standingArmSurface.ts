import * as THREE from "three";

/** Continuous forearm roll, before skeletal skinning. Unlike blending two
 * matrices through a half turn, rotating each cross-section retains its radius.
 * The shoulder and torso are excluded by the connected-topology mask. */
export class StandingArmSurface {
  readonly turn = { value: new THREE.Vector2() };
  readonly spread = { value: new THREE.Vector2() };
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
        uPawTurn: this.turn, uPawSpread: this.spread,
        uArmOrigin: { value: this.origin }, uArmAxis: { value: this.axis },
        uArmLength: { value: this.length },
      });
      shader.vertexShader = /* glsl */ `
attribute vec3 connectedArmWeights;
uniform vec2 uPawTurn, uPawSpread;
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
  float scale=1.0+uPawSpread[side]*smoothstep(.68,.94,t)*mask;
  vec3 radial=offset-axis*distance;
  vec3 rr=pvArmRotate(radial,axis,a);
  deformed=uArmOrigin[side]+axis*distance+rr*scale;
  // Inverse-transpose of the twist/scale Jacobian, including the longitudinal
  // derivative; prevents a false dark seam through the rolled forearm.
  float at=clamp((t-.30)/.54,0.0,1.0);
  float st=clamp((t-.68)/.26,0.0,1.0);
  float da=uPawTurn[side]*mask*6.0*at*(1.0-at)/(.54*length);
  float ds=uPawSpread[side]*mask*6.0*st*(1.0-st)/(.26*length);
  vec3 rn=pvArmRotate(n-axis*dot(n,axis),axis,a)/scale;
  vec3 tangent=rr*ds+cross(axis,rr)*scale*da;
  deformedNormal=normalize(rn+axis*(dot(n,axis)-dot(rn,tangent)));
}
` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader
        .replace("#include <skinbase_vertex>", /* glsl */ `
#include <skinbase_vertex>
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
if(pawDQ){objectNormal=pvRotateQ(pawReal,objectNormal);}else{
#include <skinnormal_vertex>
}`)
        .replace("#include <skinning_vertex>", /* glsl */ `
vec3 pawPosition, pawUnusedNormal;
pvArmSurface(transformed, normal, pawPosition, pawUnusedNormal);
transformed=pawPosition;
if(pawDQ){transformed=pvRotateQ(pawReal,transformed)+2.0*(pawReal.w*pawDual.xyz-pawDual.w*pawReal.xyz+cross(pawReal.xyz,pawDual.xyz));}else{
#include <skinning_vertex>
}`);
    };
    material.customProgramCacheKey = () => cache + "-continuous-paw-dq-v2";
  }
}
