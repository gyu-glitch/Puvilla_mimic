# 푸빌라 미믹 (pubilla-mimic)

신세계 2026 크리스마스 캠페인 "푸빌라 크리스마스 빌리지"의 인터랙션 5개 중 하나.
거울 프레임(세로 디스플레이) 앞에 다가가면 푸빌라(곰 캐릭터)가 등장해 고개 방향과 표정을 따라 한다.

- 담당: 규 (NAU 크리에이티브 전략). 1차 담당 3개(스노우글로브·미믹·숨바꼭질) 중 가장 기술 리스크가 큰 것.
- 일정: W1 = 2026-10-13 주. **11/13 게이트**(HW~백엔드 완료, 프록시 그래픽으로 2시간 무인 동작) → 그래픽 공통 디벨롭(11/16~25) → 11/26 설치·리허설 → 11/27 오픈(안).
- 이전 파이프라인은 언리얼 LiveLink + MediaPipe(별도 프로세스)였고, 안정성 때문에 이번엔 **브라우저 안에서 전부 도는 WebGL 구성**으로 바꾼다. 프로세스 1개, 외부 IPC 없음.

## 스택
- Vite 8 + TypeScript 7 (strict), 프레임워크 없음
- `@mediapipe/tasks-vision` 1.1.0 — FaceLandmarker (WASM + GPU delegate), 로컬 호스팅
- three 0.186 — 렌더
- lil-gui — 개발용 튜닝 오버레이

> 전체 인계 문서: [docs/HANDOFF.md](docs/HANDOFF.md) — 구조·표정 판정 방식·털·화면 시점·배포·할 일. 아래는 요약.

## 실행
```bash
npm install            # postinstall 이 wasm 을 public/mediapipe/wasm 로 복사
npm run fetch-models   # face_landmarker.task → public/models/  (최초 1회, 인터넷 필요)
npm run dev            # http://localhost:5173  (d 키: 오버레이 토글)
npm run build          # tsc --noEmit && vite build → dist/
npm run preview        # dist 서빙 (4173). 키오스크는 ?kiosk=1
```
URL 옵션: `?sim=1` 웹캠 없이 마우스(고개)·키보드(표정) 시뮬레이션 / `?char=proxy` 도형 프록시 캐릭터 / `?kiosk=1`.
sim 키(누르는 동안): s 웃음 · o 입 벌림 · p 오므림 · b 눈 감기 · l/r 한쪽 눈 · f 찡그림 · u/a 눈썹 올림/내림 · c 볼 · n 사람 있음/없음 토글. 휠 = roll.
키오스크 실행: `scripts/kiosk.cmd` (Windows, Chrome --kiosk + 카메라 권한 자동허용). 현장은 Windows 가정.

## 파이프라인 (src/)
```
camera.ts ──▶ tracker.ts ──▶ signals.ts ──▶ state.ts ──▶ character/mapping.ts ──▶ character/puuvilla.ts ──▶ scene.ts
getUserMedia   MediaPipe      OneEuro 스무딩    FSM            CharacterParams        CharacterRig               three 렌더
라벨로 장치고정  blendshape 52   타깃 1명 선택     IDLE/ATTRACT/  (게인·데드존·클램프)     (실제 3D 푸빌라, 폴백=proxy.ts)
               + 변환행렬      접근 히스테리시스  ENTER/MIMIC/
               → yaw/pitch/roll 표정 분류        EXIT
```
- `main.ts` 가 rAF 루프에서 위 순서대로 호출. 추론은 비디오 프레임이 바뀔 때만(`tracker.update`).
- `config.ts` — `public/config.json` 을 기본값과 deep-merge. **임계값·게인·타임아웃은 코드에 박지 말고 config 로.**
- `overlay.ts` — config 객체를 직접 바인딩하므로 슬라이더 조정이 즉시 반영. "저장" = config.json 다운로드 → `public/config.json` 덮어쓰기.
- `kiosk.ts` — `?kiosk=1`: 오버레이/커서 숨김, wakeLock, 치명 오류 시 N초 후 reload, 선택적 헬스 POST.
- `sim.ts` — `?sim=1` 시뮬레이터. signals.ts 출력과 같은 FaceSignal 을 만들어 mapping 이후를 그대로 탄다.
- `character/puuvilla.ts` — `public/models/pu_stand.obj`(원본: `asset/PUUVILLA IP FINAL/3 3D FILE/푸빌라_3D/푸빌라_스카프_obj/pu_stand.obj`) 로드 → `subdivide.ts` Catmull-Clark 2단계(원본이 C4D SDS 케이지) → 런타임 스키닝(root/head/armL/armR). 목 가중치는 스카프 안쪽(y 112~131cm)에서 블렌딩해 이음매가 가려진다. 눈·코는 head 본에 강체.
- `character/mouthRig.ts` — 원본 메쉬의 입 홈을 로드 시 메워 지운다(가이드북 3D 렌더 44~52장엔 홈이 없음). 원래 입선 곡선(y=a+kx²)만 측정해 넘김.
- `character/puuvillaShaders.ts` — 입(무표정 선·웃음 ‿·찡그림 ︵·'o')·감은 눈(‿)·눈썹은 전부 **먹선**: 털 끝 높이에 띄운 별도 레이어(`makeInkMaterial`)로 그려 털 위에 또렷하게. 셸 털(#F2F2F2), 스카프 줄무늬(#EF2E2E), 볼터치. 눈알은 원본보다 작게(`face.eyeScale`) — 가이드의 작은 점 눈.
- 표정 판정(실측 기반, `.trace/trace.jsonl` 로 검증): 눈 = 랜드마크 눈꺼풀 간격/눈 폭(EAR)을 사람별 뜬 눈 기준으로 → 감김 0~1, 0.8↑ 감음 / 0.55↓ 뜸 (MediaPipe eyeBlink 블렌드셰이프는 한쪽만 감아도 양쪽이 같이 올라 윙크 구분 불가). 입 = 랜드마크 입술 간격·입꼬리 높이(무표정 시작값 −0.042). 다문 채 입술 오므림/내밀기 = 시무룩 '︵', 'o' 는 입술이 실제로 벌어졌을 때만. 볼터치 = 양쪽 mouthSmile 둘 다 높을 때만.
- 개발 서버에선 표정 수치(영상 아님)를 0.1초마다 `.trace/trace.jsonl` 에 기록(`/__mimic/trace`). 탭이 숨겨져 rAF 가 멈춰도 `__mimic.step(초)` 로 프레임 진행 가능(sim 렌더 검증용).
- `logger.ts` — 링버퍼 500줄. `window.__mimic.logs()`, `.signal()`, `.state()`, `.cfg` 로 현장 디버깅.

## 내 PC 상시 호스팅 (공유 링크)
- 공개 주소: **https://nau-gyuchan.tailc22fe0.ts.net/** — Tailscale Funnel(개인 tailnet sg.enzika@, HTTPS 자동) → 127.0.0.1:4173. 이 PC 는 통신사 공유 IP(CGNAT)라 포트포워딩 불가 → 터널 필요.
- 패치 반영: `npm run deploy` 한 번 → `../pubilla-mimic-hosting/<시각>/` 에 빌드하고 `current.txt` 로 교체(최근 3개 보관). 서버 재시작 불필요, 보는 사람은 새로고침.
- 서버: `scripts/serve.mjs` (gzip 미리 압축본·ETag 304·캐시 등급). 작업 스케줄러 `PubillaMimicServe`(로그인 시 `scripts/serve-hidden.vbs` → `serve-loop.cmd`, 죽으면 3초 뒤 재시작). 로그 `../pubilla-mimic-hosting/serve.log`.
- Funnel 회선이 느려서(≈150KB/s) 배포본만 MediaPipe 엔진·모델을 jsDelivr/Google CDN 에서 받음(로컬과 바이트 동일 확인, 모델은 로컬 사본이 예비). 첫 접속 ≈17초. 현장 키오스크는 지금처럼 전부 로컬.
- 배포본은 카메라 자동 노출로 시작, 보는 사람의 튜닝값은 그 브라우저(localStorage)에 저장 — 공용 config.json 은 개발 서버에서만 바뀜.
- 끄기: `tailscale funnel --https=443 off` / 작업 스케줄러에서 PubillaMimicServe 사용 안 함.
- 파일 하나로 주기: `npm run build:single` → `release/pubilla-mimic.html`(35MB, 서버 없이 Chrome 더블클릭).

## 설계 원칙
1. **접근 감지는 별도 센서 없이 얼굴 bbox 높이**로 한다 (`presence.enterBboxHeight / exitBboxHeight` 히스테리시스 + 중앙 조건). mmWave 는 숨바꼭질 쪽.
2. **다중 얼굴 = 락온**: `presence.lockZone`(화면 좌표, 기본 중심 40%) 안에 얼굴 중심이 있는 사람 중 '가까움 × 가운데' 점수 최고인 1명을 잡고, 그 사람의 얼굴 박스가 영역에 조금이라도 걸쳐 있는 동안 유지(뒤에 누가 와도 안 바뀜, 경계에서 덜컥 풀리지 않게). 완전 이탈/소실이 `faceLostHoldMs`(1.5초) 지나면 재탐색. 카메라 화면 아래에 노출·밝기 슬라이더(어두우면 인식이 끊김, `camera.*`에 저장). 영역은 개발 화면 오른쪽 아래 카메라 박스에서 마우스로 편집(`lockZone.ts`). 상반신 Pose 는 최대 3명 중 락온 얼굴과 같은 사람(`BodyProcessor.pickForFace`).
3. **미러**: 캐릭터는 거울이므로 yaw/roll 부호 반전 + Left/Right blendshape 교환 (`signals.ts`). `camera.mirror` 로 끌 수 있음.
4. **머리 회전**은 `facialTransformationMatrixes` (column-major 4x4) → `Matrix4.fromArray` → Euler YXZ. 현장 카메라에서 축이 뒤집혀 보이면 코드 수정 전에 오버레이의 `transposeMatrix` 와 `camera.mirror` 부터 토글해 본다.
5. **그래픽 교체 인터페이스** = `CharacterRig { root, apply(params, dt, t), setState(snapshot) }` + `CharacterParams`. 현재 `PuuvillaCharacter`(실제 3D, 본·블렌드셰이프 없는 OBJ 를 런타임 리깅)가 기본. 그래픽 팀이 본·블렌드셰이프 있는 glb 를 주면 같은 인터페이스로 교체 — `docs/ASSET_HANDOFF.md`.
6. 상태 전이·센서 이상·복구는 전부 `log.*` 로 남긴다. 2시간 무인 테스트 때 이 로그로 판정.
8. **팔**: 원본 메쉬(pu_stand·Seat_A)는 팔이 몸통에 붙어 모델링돼 팔을 들면 겨드랑이가 늘어남(`body.armRaiseMaxRad` 1.2rad 제한). 앉은 몸(Seat_A, `?seat=1` / `/preview/`)은 팔만 원본 껍질을 거울로 닫은 팔로 바꾼 `seat_t2.bin` → 몸통 고정에 팔을 머리 위까지 들 수 있음(`character.freeArm*`, HANDOFF 5.4-2).
9. **배포 규칙**: 공개 링크 https://nau-gyuchan.tailc22fe0.ts.net/ (current.txt, 서 있는 몸 + 뜨개 목도리 = 10/15 구성)는 **사용자가 "올려"라고 하기 전엔 절대 안 바꾼다** — `npm run deploy` 금지, current.txt 수정 금지. 작업 버전은 `npm run deploy:preview`(preview.txt) → **테스트 주소 https://nau-gyuchan.tailc22fe0.ts.net:8443/** (별도 서버 `scripts/serve-loop-test.cmd` 4174 + Funnel 8443, 공개와 주소·localStorage 분리). 테스트 서버는 로그인 시 자동 실행이 아직 없음 — 죽었으면 `wscript scripts\serve-hidden-test.vbs`.
7. 털 셸 개수(`fur.shells`)가 GPU 부하의 대부분 (14셸 ≈ 1M tris). 현장 PC 에서 렌더 60fps 미달이면 먼저 셸을 8 → 0 순으로 줄인다.

## 지금 상태 / 다음 할 일
- [x] 스캐폴드: 카메라 → 트래커 → 신호 → FSM → 프록시 캐릭터 → 렌더, 오버레이, config, 키오스크 골격. `tsc` + `vite build` 통과. 헤드리스 Chromium(fake webcam)에서 wasm 로드·그래프 시작 확인.
- [x] 실제 푸빌라 3D 적용 (pu_stand.obj, 털·스카프·표정 셰이더, 머리/팔 런타임 리그). `?sim=1` 로 표정 8종·고개 ±35°·ENTER/EXIT/ATTRACT 손 흔들기 확인. RTX 5090 에서 60fps.
- [ ] **실카메라로 첫 실행** — 모델 fetch 후 `npm run dev`. 축 방향(yaw/pitch/roll 부호), 미러, 블렌드셰이프 좌우가 맞는지 오버레이 수치로 확인.
- [ ] 접근 임계값 실측 — 거울 앞 1.0 m / 1.5 m / 2.5 m 에서 bboxH 값을 읽어 `enterBboxHeight/exitBboxHeight` 결정 (아이 키 100~130 cm 기준도).
- [ ] 성능 — 추론 30 fps / 렌더 60 fps / 카메라→화면 지연 < 120 ms. 미달이면 `inferenceEveryNFrames=2`, 입력 해상도 720p→ 540p, delegate 확인.
- [ ] 표정 분류 튜닝 (smile/surprise dwell), 놀람 리액션 트리거(효과음·연출 훅) 추가.
- [ ] ATTRACT/ENTER/EXIT 연출 다듬기 (지금은 위치·스케일 이징만).
- [ ] 조명 조건 테스트 — 점멸 크리스마스 조명·역광에서 랜드마크 떨림. 필요 시 보조광.
- [ ] 안경·마스크·모자 착용 동작 확인.
- [ ] 2시간 연속 동작 — 메모리(랜드마크 결과 객체), 추론 fps 저하, WebGL 컨텍스트 유지.
- [ ] 키오스크 셋업 — 자동 로그인·자동 실행·watchdog(OS 레벨), 디스플레이 ON/OFF 스케줄.
- [ ] 에셋 매니페스트(`docs/ASSET_HANDOFF.md`) 확정 → 11/13 게이트에서 그래픽 인계.

## 컨벤션
- 커밋은 작은 단위, 메시지 한국어 OK. 설정값 변경은 `public/config.json` 커밋으로 남긴다.
- 새 모듈을 추가하면 위 파이프라인 다이어그램과 `docs/ARCHITECTURE.md` 를 같이 갱신.
- 외부 CDN 의존 금지 (wasm·모델 로컬). 런타임 fetch 는 `config.json` 과 모델 폴백뿐.
- 절대 하지 말 것: 카메라 프레임 저장/전송. 개인정보 안내 문구 필요 여부는 현장 운영과 확인.
