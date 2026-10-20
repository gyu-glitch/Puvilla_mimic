"""Local connected-surface solve. Torso and distal arm targets are hard anchors.
This is a development candidate, not a claim of volume-preserving deformation.
"""
import json,sys
from pathlib import Path
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import splu

src=json.loads(Path('dev/shoulder-solve-input.json').read_text())
rig=src['rig'];P=np.array(rig['rest']);Q=np.array(src['initial']);target=np.array(src['posed'])
mask=np.sum(np.array(rig['weights'])[:,:2],axis=1);along=np.array(src['along'])
cap_mode='--cap' in sys.argv
solid_mode='--solid' in sys.argv
lift_mode='--lift' in sys.argv
relative_mode='--relative' in sys.argv
if lift_mode:cap_mode=True;solid_mode=True
free=(mask>0)&(along<.42)&(P[:,1]<119)&(np.abs(P[:,0])>15)
cap=(mask==0)&(P[:,1]>(86 if lift_mode else 94))&(P[:,1]<126)&(np.abs(P[:,0])>(18 if lift_mode else 22))
if cap_mode:free|=cap
E={}
for face in src['faces']:
    for k in range(len(face)):
        a,b=sorted((face[k],face[(k+1)%len(face)]));E[a,b]=1.
    if len(face)==4:
        for a,b in ((face[0],face[2]),(face[1],face[3])): E.setdefault(tuple(sorted((a,b))),.5)
if solid_mode:
    for ring in src['rings']:
        for i,a in enumerate(ring):
            for b in ring[i+1:]: E.setdefault(tuple(sorted((a,b))),.5)
ij=np.array(list(E));w=np.array(list(E.values()));a,b=ij.T
if relative_mode:w/=np.maximum(.5,np.linalg.norm(P[a]-P[b],axis=1))**2
# Directed edges simplify the local/global formulas and preserve symmetry.
ii=np.r_[a,b];jj=np.r_[b,a];ww=np.r_[w,w];rest=P[ii]-P[jj]
degree=np.bincount(ii,weights=ww,minlength=len(P))
L=coo_matrix((np.r_[-ww,degree],(np.r_[ii,np.arange(len(P))],np.r_[jj,np.arange(len(P))])),shape=(len(P),len(P))).tocsc()
f=np.where(free)[0];c=np.where(~free)[0]
penalty=np.where(cap&cap_mode,degree*.4,0)
from scipy.sparse import diags
penalties=np.repeat(penalty[:,None],3,axis=1)
if lift_mode:penalties[cap]=degree[cap,None]*np.array([2.,.025,2.])[None,:]
solvers=[splu(L[f][:,f]+diags(penalties[f,k])) for k in range(3)]
boundary=L[f][:,c]@target[c]
Q[c]=target[c]
history=[]
for step in range(100):
    covariance=np.zeros((len(P),3,3))
    np.add.at(covariance,ii,ww[:,None,None]*rest[:,:,None]*(Q[ii]-Q[jj])[:,None,:])
    u,s,vt=np.linalg.svd(covariance);v=vt.transpose(0,2,1)
    sign=np.linalg.det(v@u.transpose(0,2,1));v[:,:,2]*=sign[:,None]
    R=v@u.transpose(0,2,1)
    rhs=np.zeros_like(P)
    np.add.at(rhs,ii,.5*ww[:,None]*np.einsum('nij,nj->ni',R[ii]+R[jj],rest))
    new=np.column_stack([solvers[k].solve(rhs[f,k]-boundary[:,k]+penalties[f,k]*P[f,k]) for k in range(3)])
    change=float(np.max(np.linalg.norm(new-Q[f],axis=1)));Q[f]=new
    history.append(change)
    if change<1e-5: break
correction=Q-target
rig['corrective']=correction.tolist()
tag='araprelative' if relative_mode else 'araplift' if lift_mode else 'arapsolid' if solid_mode else 'arapcap' if cap_mode else 'arap'
tag=next((a.split('=',1)[1] for a in sys.argv if a.startswith('--tag=')),tag)
Path(f'dev/stand_socket_{tag}.json').write_text(json.dumps(rig))
edge_ratio=np.linalg.norm(Q[a]-Q[b],axis=1)/np.linalg.norm(P[a]-P[b],axis=1)
active=free[a]|free[b]
report={'free_vertices':int(len(f)),'iterations':len(history),'final_change_cm':history[-1],
        'max_correction_cm':float(np.max(np.linalg.norm(correction,axis=1))),
        'active_edge_ratio_percentiles':np.percentile(edge_ratio[active],[0,5,50,95,100]).tolist(),
        'torso_max_offset':float(np.max(np.abs(correction[rig['torsoAnchors']]))) }
Path(f'docs/arm-review/v8-{tag}-metrics.json').write_text(json.dumps(report,indent=2));print(report)
