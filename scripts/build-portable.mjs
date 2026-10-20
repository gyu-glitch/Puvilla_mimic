import {execFileSync} from 'node:child_process';
import {cpSync,mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const root=process.cwd(), output=resolve(root,'release','Puuvilla-v48-local');
if(existsSync(output))throw Error('Preserve existing packages: choose a fresh output name before rebuilding.');
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','--noEmit'],{stdio:'inherit'});
execFileSync(process.execPath,['node_modules/vite/bin/vite.js','build'],{stdio:'inherit'});
mkdirSync(output,{recursive:true});
cpSync(resolve(root,'dist'),resolve(output,'site'),{recursive:true,filter:p=>!p.endsWith('.map')});
cpSync(resolve(root,'scripts/portable'),output,{recursive:true});
mkdirSync(resolve(output,'runtime'));
cpSync(process.execPath,resolve(output,'runtime/node.exe'));
const license=await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`);
if(!license.ok)throw Error('Node license download failed');
writeFileSync(resolve(output,'runtime/LICENSE-node.txt'),await license.text());
cpSync(resolve(root,'node_modules/three/LICENSE'),resolve(output,'runtime/LICENSE-three.txt'));
cpSync(resolve(root,'node_modules/lil-gui/LICENSE.md'),resolve(output,'runtime/LICENSE-lil-gui.txt'));
const mediaLicense=await fetch('https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/LICENSE');
if(!mediaLicense.ok)throw Error('MediaPipe license download failed');
writeFileSync(resolve(output,'runtime/LICENSE-mediapipe.txt'),await mediaLicense.text());
const config=JSON.parse(readFileSync(resolve(output,'site/config.json')));
config.build='local-v48-performance';
config.camera={...config.camera,applyImageSettings:false,autoExposure:true};
config.tracker.modelPath='./models/face_landmarker.task';
config.tracker.modelUrlFallback=config.tracker.modelPath;
config.tracker.wasmPath='./mediapipe/wasm';
config.tracker.useWorker=true;
config.pose.modelPath='./models/pose_landmarker_full.task';
config.pose.modelUrlFallback=config.pose.modelPath;
config.pose.useWorker=true;
config.filter.oil.fps=12;
writeFileSync(resolve(output,'site/config.json'),JSON.stringify(config,null,2));
writeFileSync(resolve(output,'사용방법.txt'),`\uFEFF푸빌라 v48 전시용 성능 후보

1. ZIP 전체를 쓰기 가능한 폴더에 압축 해제합니다.
2. Start.cmd를 더블클릭합니다. Chrome 앱 창이 열립니다(Chrome 없으면 Edge).
3. 카메라 권한을 허용하고 Chrome에서 OBS Virtual Camera를 선택합니다.
4. 앱 창을 닫으면 카메라가 종료됩니다. Stop.cmd로 로컬 서버도 종료합니다.

Node/npm 설치나 인터넷 연결 없이 실행됩니다. 기존 Chrome 설치는 필요합니다.
site/index.html을 직접 열지 마세요. 워커 사용을 위해 Start.cmd로 실행합니다.
주소: http://127.0.0.1:4178/
F: 동그란 아이콘 표시/숨김, D: 설정, 입력 회전/출력 반전은 기존 아이콘.
설정은 이 Chrome의 해당 주소에 저장됩니다. 다른 PC/공개 사이트의 설정은 자동 복사되지 않습니다.
기존 현장 설정은 백업 후 설정창에서 맞추세요. 시점/입력 회전은 현장마다 다릅니다.
카메라 영상은 기기 내 추론에만 사용합니다. 서버는 127.0.0.1에만 연결됩니다.
이미 다른 폴더에서 실행 중이면 그 폴더의 Stop.cmd로 먼저 종료하세요.

유화 품질과 리깅은 유지하며, 12fps 유화에 필요한 프레임만 3D 렌더링합니다.
얼굴/몸 추론은 별도 워커로 처리하고 밀린 영상은 쌓지 않습니다.
5070 현장 실측은 아직 하지 않았습니다. 기존 공개 버전은 별도로 보존했습니다.
`);
console.log(`Portable package: ${output}`);
