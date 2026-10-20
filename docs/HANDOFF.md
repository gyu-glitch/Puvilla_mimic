# 푸빌라 미믹 — 개발 인계서

> 신세계 2026 크리스마스 캠페인 "푸빌라 크리스마스 빌리지" 인터랙션 중 하나.
> 거울 프레임(디스플레이) 앞에 선 사람의 **고개 방향·표정(눈 깜빡임/윙크·웃음·시무룩·입 벌림)** 을 3D 곰 캐릭터 푸빌라가 실시간으로 따라 한다.
> 브라우저 하나에서 전부 돈다 (웹캠 → MediaPipe 얼굴 인식 → Three.js WebGL 렌더). 서버·외부 프로세스 없음.

이 문서만 읽고 바로 이어서 개발할 수 있게 쓴 문서다. 더 짧은 요약은 [CLAUDE.md](../CLAUDE.md), 그래픽 팀 인계 명세는 [ASSET_HANDOFF.md](./ASSET_HANDOFF.md).

---

## 1. 5분 안에 실행하기

필요: **Node.js 20 이상**(개발 PC는 24), **Chrome**(최신), 웹캠.

```bash
# 압축을 푼 폴더에서
npm install            # 이미 node_modules 가 들어 있으면 생략 가능 (다른 OS 면 node_modules 지우고 실행)
npm run dev            # http://localhost:5173
```

- 웹캠 없이 보기: `http://localhost:5173/?sim=1` (마우스 = 고개, 키보드 = 표정 — 아래 4.3)
- 튜닝 화면: PC 에서 **`d` 키** 또는 오른쪽 위 ⚙ (기본 숨김)
- 모델 파일(`public/models/*.task`)·wasm(`public/mediapipe/wasm`)은 압축에 이미 들어 있음.
  없으면 `npm run fetch-models` (인터넷 필요) / `npm install` 이 wasm 을 복사함(postinstall).

> **카메라가 안 열리면 (`NotReadableError`)**: 다른 프로그램이 웹캠을 잡고 있는 것. Windows 는 `설정 → 개인 정보 → 카메라` 에서
> 최근 사용 앱 확인. 개발 중 이 PC 에선 다른 프로젝트의 Python 서버(mocap)가 웹캠을 잡아 실패한 적 있음.

---

## 2. 스택

| 항목 | 버전 | 용도 |
|---|---|---|
| Vite | 8.3 | 개발 서버·번들 (프레임워크 없음, 순수 TS) |
| TypeScript | 7.0 (strict) | |
| three | 0.186 | 렌더 |
| @mediapipe/tasks-vision | 1.1.0 | FaceLandmarker (얼굴 478점 + 블렌드셰이프 52 + 머리 변환행렬), PoseLandmarker(상반신, 기본 꺼짐) |
| lil-gui | 0.21 | 개발용 튜닝 화면 |

외부 CDN 의존 없음(개발/키오스크). 단, **공유 호스팅 배포본**만 무거운 MediaPipe 파일을 CDN 에서 받는다(7장).

---

## 3. 폴더 구조

```
pubilla-mimic/
├─ index.html                 진입 HTML (PWA 메타·manifest 포함)
├─ public/
│  ├─ config.json             ★ 런타임 튜닝값 전부 (코드에 숫자 박지 말고 여기)
│  ├─ models/pu_stand.obj     푸빌라 3D 원본 (C4D 서브디비전 케이지, 아래 5.1)
│  ├─ models/*.task           MediaPipe 얼굴·포즈 모델
│  ├─ mediapipe/wasm/         MediaPipe wasm (npm install 시 복사)
│  ├─ icons/ manifest.webmanifest   홈 화면에 추가 시 전체화면 앱
├─ src/
│  ├─ main.ts                 부팅 + rAF 루프 (아래 파이프라인 순서대로 호출)
│  ├─ camera.ts               getUserMedia, 재시도, 노출·밝기 적용
│  ├─ tracker.ts              FaceLandmarker (워커 우선 → 느리면 메인 스레드), 랜드마크로 입·눈 직접 측정
│  ├─ trackerWorker.ts        얼굴 인식 Web Worker
│  ├─ signals.ts              락온(다중 얼굴 중 1명), 스무딩(One Euro), 사람별 무표정 기준선
│  ├─ smoothing.ts            One Euro 필터
│  ├─ state.ts                FSM: IDLE / ATTRACT / ENTER / MIMIC / EXIT
│  ├─ character/mapping.ts    신호 → CharacterParams (게인·데드존·클램프)
│  ├─ character/puuvilla.ts   ★ 실제 3D 푸빌라: OBJ 로드·세분화·런타임 리깅·눈·입·털
│  ├─ character/puuvillaShaders.ts  ★ 털(셸)·먹선(입·감은 눈)·볼터치·스카프 셰이더
│  ├─ character/mouthRig.ts   원본 메쉬의 입 홈을 메워 지움 (입은 먹선으로 그림)
│  ├─ character/subdivide.ts  OBJ 파서 + Catmull-Clark + 뒤집힌 면 수정
│  ├─ character/proxy.ts      도형 프록시 캐릭터 (`?char=proxy`, 폴백)
│  ├─ scene.ts                렌더러·카메라 구도(가로/세로 시점)·조명
│  ├─ viewControls.ts         가로↔세로 버튼, 전체화면 버튼, 터치 확대·이동
│  ├─ quality.ts              성능 자동 조절 (느리면 해상도·털 층 단계 하향)
│  ├─ overlay.ts              튜닝 화면 (lil-gui, 한국어 라벨+단위, 자동 저장)
│  ├─ lockZone.ts             카메라 미리보기 + 락온 영역 마우스 편집 + 노출 슬라이더
│  ├─ poseTracker.ts body.ts  상반신 미믹 (기본 꺼짐)
│  ├─ sim.ts                  `?sim=1` 키보드·마우스 시뮬레이터
│  ├─ kiosk.ts                `?kiosk=1` 현장 모드
│  ├─ embedded.ts             단일 HTML 빌드용 내장 파일 로더
│  ├─ expressionTest.ts devShot.ts   개발 전용 (표정 정답 기록, 가이드 비교 촬영)
│  └─ logger.ts               링버퍼 로그 (`__mimic.logs()`)
├─ scripts/
│  ├─ config-saver.mjs        개발 서버 플러그인: 튜닝 저장 → public/config.json, 표정 수치 기록 → .trace/
│  ├─ deploy.mjs serve.mjs serve-loop.cmd serve-hidden.vbs   상시 호스팅 (7장)
│  ├─ build-single.mjs        HTML 파일 하나로 묶기
│  ├─ fetch-models.mjs copy-wasm.mjs   모델·wasm 준비
│  └─ kiosk.cmd kiosk.sh      키오스크 실행 (Chrome --kiosk + 카메라 자동 허용)
└─ docs/                      이 문서, 그래픽 인계, 비교 이미지
```

---

## 4. 동작 구조

### 4.1 파이프라인 (매 프레임, `main.ts`)
```
camera ─▶ tracker ─▶ signals ─▶ state(FSM) ─▶ mapping ─▶ PuuvillaCharacter.apply ─▶ scene.render
웹캠      얼굴 인식   락온·스무딩   상태 전이       파라미터     눈·입·고개·털            Three.js
          (워커)     무표정 기준선
```
- 추론은 새 비디오 프레임이 들어왔을 때만. 워커 모드에서 렌더는 추론을 기다리지 않는다.
- 캐릭터 교체 인터페이스: `CharacterRig { root, apply(params, dt, t, body), setState(snapshot) }` + `CharacterParams` (mapping.ts). 그래픽 팀이 본·블렌드셰이프 있는 glb 를 주면 이 인터페이스로 갈아끼우면 됨.

### 4.2 표정 판정 (실제 웹캠 실측으로 정한 방식 — 중요)
MediaPipe 블렌드셰이프만 쓰면 실제로 안 된다는 걸 실측으로 확인했고, 그래서 **랜드마크 좌표로 직접 잰다** (`tracker.ts` `measureMouth`/`measureEyes`):

| 표정 | 측정 | 이유 |
|---|---|---|
| 눈 감기·윙크 | 눈꺼풀 위아래 간격 ÷ 눈 폭 (EAR), 사람별 '뜬 눈' 기준선 대비 감김 0~1. 0.8↑ 감음 / 0.55↓ 다시 뜸 (히스테리시스) | `eyeBlink` 블렌드셰이프는 한쪽만 감아도 양쪽이 같이 올라가 윙크 구분 불가 |
| 입 벌림 | 윗·아랫입술 안쪽 간격 ÷ 입 폭 (얼굴 좌표계, 고개 각도 무관) | `jawOpen` 은 다물어도 0.1~0.2 → 'o' 오인식 |
| 웃음·시무룩 | 입꼬리가 입 중심보다 위/아래인 정도 ÷ 입 폭. 무표정 시작값 −0.042, 사람별로 천천히 학습 | `mouthFrown` 은 입꼬리를 내려도 거의 0 |
| 뾰로통(입술 내밀기) | 다문 입 + 오므림 → 시무룩 '︵' | |
| 'o' 입 | 입술이 실제로 벌어졌을 때만 | 다문 채 오므림이 'o' 로 나오던 문제 |
| 볼터치 | 양쪽 `mouthSmile` 둘 다 높을 때만, 천천히 물듦 | 아무 때나 뜨던 문제 |

- 미러: 캐릭터는 거울이므로 yaw/roll 부호 반전 + Left/Right 교환 (`signals.ts`, `camera.mirror`).
- 다중 얼굴 = **락온**: `presence.lockZone`(화면 좌표, 기본 중앙 40%) 안에서 '가까움 × 가운데' 최고인 1명. 얼굴 박스가 영역에 걸쳐 있는 동안 유지, 완전히 벗어난 지 `faceLostHoldMs`(1.5초) 지나면 재탐색. 영역은 PC 튜닝 화면의 카메라 미리보기에서 마우스로 편집.

### 4.3 시뮬레이터 `?sim=1`
마우스 = 고개, 휠 = 기울기. 누르는 동안: `s` 웃음 · `o` 입 벌림 · `p` 오므림 · `b` 두 눈 감기 · `l`/`r` 한쪽 눈 · `f` 시무룩 · `c` 볼 · `n` 사람 있음/없음.

### 4.4 디버그 핸들 (브라우저 콘솔)
`window.__mimic` — `.cfg` `.logs()` `.signal()` `.state()` `.character` `.scene` `.tracker` `.step(초)`(숨긴 탭에서도 프레임 진행) `.shot(name, opts)`(sim 에서 고정 구도 촬영 → `.trace/trace.jsonl`).

---

## 5. 캐릭터 (character/puuvilla.ts)

### 5.1 메쉬
- 원본: `asset/PUUVILLA IP FINAL/3 3D FILE/푸빌라_3D/푸빌라_스카프_obj/pu_stand.obj` (서 있는 포즈, 본·텍스처 없음). → `public/models/pu_stand.obj`
- 로드 시: Catmull-Clark 2단계 세분화 → `pu_eyes_L` 뒤집힌 면 바로잡기(원래 눈이 초승달처럼 보이던 원인) → 눈구멍 파기 → **입 홈 메우기**(가이드북 3D 렌더 44~52장엔 입 홈이 없음; 메운 자리의 접힌 주름은 Tutte 임베딩+2차 곡면으로 폄) → 런타임 스키닝(root/spine/chest/head/팔).
- 좌표: 원본 cm, 정면 +z. `character.modelScale` 0.04 로 축소.

### 5.2 얼굴 (가이드북 44~52장 기준)
- 눈: 작은 반광택 차콜 점 (`face.eyeScale`), 반사 하이라이트 없음.
- 입·감은 눈은 **먹선**: 털 위 별도 레이어(`makeInkMaterial`)에 SDF 로 그림. 무표정 = 원래 입선 곡선, 웃음 '‿', 시무룩 짧고 둥근 '︵', 노래/놀람 'o'. 감은 눈은 털 위에 얹힌 반광택 튜브 '‿' (`closedEyeTube`).
- 눈썹 없음(가이드에 없음, `face.browEnabled` false). 볼터치 있음.

### 5.3 털 (셸 텍스처링)
- 몸통 위에 투명 껍질 14장(`fur.shells`)을 털 길이만큼 띄워 쌓고, 각 층에서 **가닥 셰이더**(`pvStrands`: 셀마다 1가닥, 끝으로 가늘게, 가닥마다 눕는 방향·길이·밝기 무작위)로 그림.
- 털뭉치 음영(`pvTuftShade`, `fur.tuftCm`·`bumpCm`), 무광(`fur.roughness` 1), 얼굴·코·눈 주변 털 짧게(`pvFurMask`).
- 기준: 가이드북 2.4 (C4D Ornatrix, #F2F2F2). 밝기 분포는 가이드와 수치로 맞춤(중간값 ≈225).
- **아직 다듬는 중**: 사용자 피드백 "가죽 같다". 가이드는 더 길고 성긴 솜털 테두리·구름 같은 털뭉치. 남은 방향: 윤곽 털 길이↑, 털뭉치 음영 대비↑, 셸 개수/간격. 비교는 `__mimic.shot()` + 가이드 이미지 1:1 크롭으로.
- GPU 부하 대부분이 셸 개수. 느리면 `quality.ts` 가 자동으로 줄임.

### 5.6 그림 필터 (테스트, `paintFilter.ts`)
털 메쉬를 직접 고치는 대신 화면 단계에서 질감을 바꾸는 시도. 왼쪽 아래 붓 버튼으로 켜고 끔(기본 켜짐), PC 튜닝 화면 '그림 필터'.
- 방식 `filter.style`: **soft(기본)** = 경계 보존 블러(bilateral, 색 차이 `softColor` 이내만 섞음) → 털 결 노이즈가 녹은 몽글한 면, 각진 조각 없음 / brush = 일반화 쿠와하라(8 부채꼴) → 붓 터치지만 폰처럼 고밀도 화면에선 바위처럼 각져 보임(사용자 피드백). 언샤프 선명화, 포스터(기본 끔).
- 털 끝 반투명 솜털 띠(알파 < 0.98)는 필터 제외 — 필터가 평평한 띠로 뭉개면 경계에 불투명한 층처럼 보였음.
- 장면은 HalfFloat 렌더타깃에 선형·알파 곱한 상태로 받고, 필터 안에서 알파를 풀어 Neutral 톤매핑·sRGB 후 페이지 그라디언트 위에 합성(그래야 윤곽 테두리가 안 생김).
- 가는 먹선 보호: 필터가 원본보다 확 밝게 만든 곳(입선·감은 눈)은 원본 유지.
- 붓 크기는 화면(CSS) px 기준 `filter.radiusPx` × 픽셀 배율(최대 12). 무거우면 품질 자동 조절이 해상도를 낮춤.

### 5.3-1 유화 획 필터 (왼쪽 아래 팔레트 버튼)
- 제작자가 준 단독 모듈 `src/vendor/oil-stroke.js`(재료 필터 갤러리 '유화 · 획 (세부 보존)'과 픽셀 단위로 같음, 사용법 `docs/oil-stroke-guide.md`)를 그대로 씀. **모듈 안은 고치지 말 것** — 갤러리가 바뀌면 새 파일로 교체.
- `src/oilFilter.ts`: 우리 캔버스에 '필터 입력 화면'(장면 → 톤매핑·sRGB → 배경(주황/겨울 그림) 위 → 앞 가지까지 합성)을 그리고, 같은 틀에서 바로 `fx.frame(우리 캔버스)` → 모듈이 위에 겹친 자기 캔버스에 칠함. 배경·가지까지 전부 유화.
- 조정 패널(유화 켜면 열림, 빈 화면 누르면 접힘, 켜진 채 접혀 있으면 버튼 = 다시 열기 / 열려 있으면 버튼 = 끄기): 갤러리 '조정'과 같은 항목·범위.
  강도 0~1.6 · 붓·코 크기 0.6~1.8 · 획 다시 그리기 0~1 · 초당 그림 24/12/8 · 색 보정 0~1 · 비교 위치(왼쪽 원본) · 처리 해상도 ½/¾/1(필터 캔버스 짧은 변 = 1080 × 배율).
  기본값(10/15 확정): 켜짐 · 강도 0.30 · 붓·코 크기 1.40 · 획 다시 그리기 0.05 · 초당 그림 12 · 색 보정 1.00 · 처리 해상도 1. 값은 `filter.oil` 에 저장.
- 느린 기기: 가이드 권장대로 초당 그림 24 → 12, 처리 해상도 ¾(810)·½(540). 720 미만은 CPU 획 목록(약 8ms) 때문에 더 빨라지지 않음.
- 기존 부드러운 그림 필터(`paintFilter.ts`) 버튼은 뺐고 기본 꺼짐.

### 5.4 의상·몸 (오른쪽 아래 아이콘)
- 산타 모자 아이콘(**기본**) = **기존 서 있는 푸빌라 + 새 FBX 뜨개 목도리**(시안 PDF 261014)를 목에 맞춰 붙인 것 / 곰 아이콘 = 기존 서 있는 푸빌라(pu_stand.obj) + 줄무늬 스카프.
  선택은 그 기기에만(localStorage `pubilla-mimic-outfit`), 바꾸면 다시 불러옴. `outfit.sitBody: true` 면 아래 '앉은 푸빌라' 몸째로(현재 끔 — 고개·오른손 리깅된 파일 받기로 함).
- 목도리 맞추기(`fitMuffler`, outfit.ts) — 원본 `muffler.bin` → 기존 곰 목:
  0. 크기 `scale` 1.0 (1.1 이면 띠가 시안보다 두툼).
  1. 고리는 각도별 중심선을 옛 스카프 고리 길에 옮기고, 끝자락은 평행 이동해 가슴에 붙임.
  2. **조이기**: (각도 × 고리 높이) 칸마다 몸(턱·목 포함)에서 뜬 만큼 안쪽으로 당김(`hugMaxCm`) — 안 하면 옆·뒤 윗단이 나팔처럼 벌어져 안쪽 면이 보임.
  3. 몸을 파고든 만큼 고리째 바깥·위로 부풀림.
  3-1. **턱 밑에 붙이고 어깨에 걸치기**(`liftMaxCm`): 시안처럼 윗단은 턱·뒤통수 밑에 빈틈없이, 바깥 아랫단은 어깨에 얹히게 —
     세로 기둥(각도 × 반지름 1cm)마다 위에 머리가 있으면(목 쪽 안쪽) 윗면이 머리 아랫면에 닿게 올리고, 위에 머리가 없으면(어깨 위 바깥쪽) 아랫면이 어깨에 닿게 내림.
     그 뒤 한 번 더 조이며 안쪽 면을 목 속으로 `hugInsetCm`(두께 40% 한도) 묻음.
     (내리기만 하면 목이 휑한 '어깨도리', 올리기만 하면 바깥쪽이 어깨 위에 공중부양 — 둘 다 써 봤다가 버림)
     올리는 양은 최대 4cm(`liftMaxCm`) — 10cm 면 옆이 볼까지 올라옴. `topCapCm`(각도별 윗단 높이 제한)은 띠가 어깨에 파묻혀 보여서 끔(0).
  3-2. 마지막에 몸을 파고든 정점만 몸 노멀 방향으로 밀어냄(흐리기 앞뒤로).
  - 목도리 밑 몸 털은 `aCover`(목도리에서 5cm 안 → 털 없음)로 가림. 목도리를 두르면 옛 스카프 자리 털 가림(uOldScarf)은 끔.
  5. 색: 줄무늬 정점 색 + 오목하게 말린 안쪽은 어두운 빨강(`bakeKnitShadow`), 재질은 양면이고 뒷면은 한 가지 어두운 빨강 — 원본 안쪽 조각(얼룩·구멍)이 보여도 그늘로 보이게.
  - 폰에선 맞추기가 느려서 개발 서버에서 `__mimic.bakeMuffler()` 로 `public/models/muffler_fit.bin` 에 구워 둠(맞추기 코드·설정 바꾸면 다시 구울 것). `?refit=1`(개발) = 구운 파일 무시하고 그 자리에서 맞춤.
- (참고) 앉은 푸빌라 몸째 쓰는 방식:
- 새 몸: `asset/Puuvilla_V02/A.fbx` (리깅·블렌드셰이프 없음 — 정적 메쉬). `node scripts/build-sit.mjs [fbx] [몸 삼각형] [고개 드는 각°]` →
  `public/models/pu_sit.obj`(몸 6만 삼각형 + 눈·코·입선 부품) · `muffler_sit.bin`(목도리 18만 삼각형 + 정점별 UV). 
  - 몸이 7.9° 돌아 있어 눈 높이선 기준으로 바로잡고, 숙인 고개를 목도리 고리 평면 위만 12° 들어 정면을 보게(0°=입이 목도리에 묻힘, 20°↑=턱이 드러나 얼굴이 길어 보임 — 시안 PDF 정면과 비교해 정함),
    기존 pu_stand 눈 위치·간격에 맞춰 크기(42cm/단위)·위치를 옮겨 기존 얼굴 파이프라인(cm 상수)을 그대로 씀.
  - 눈·코·입은 원본에서 몸 표면의 검은 패치 → 몸은 패치까지 포함해 구멍 없이, 눈·코는 0.35cm 띄워 위에, 입선은 곡선만 재서 먹선 입 위치로.
  - 런타임 리깅: 목도리 고리가 뒤쪽이 높게 ~33° 기울어 있어 머리·목 가중치를 높이(y) 대신 **고리 면(PCA) 기준**으로 줌 — 몸은 면 위 = 머리, 아래 = 몸통(경계는 목도리 두께 안),
    목도리 고리는 머리를 일정 비율(`outfit.muffler.headFollow` 0.3)만 따라가는 강체, 앞 끝자락은 몸통. (높이 기준이면 고개 돌릴 때 고리가 비틀려 옆으로 날개처럼 튀어나왔음)
    팔 본은 안 씀(팔이 몸 앞에 붙은 자세). 옛 스카프 자리 털 가림은 끄고(uOldScarf), 대신 목도리에서 5cm 안의 몸 털을 눕힘(aLip 재사용 — 가장자리로 털이 삐져나오지 않게).
  - 눈 둘레 털 걷는 반경은 `uEyeClear`(앉은 메쉬는 좁게 — 넓으면 회색 그늘 고리), 코 둘레는 코 부품 크기로 잰 `uNoseHalf`.
- 목도리 색: 원본 텍스처(`muffler_color.jpg`, FBX 내장본)의 흰 정도를 메쉬 이웃끼리 6번 평균해 잡티를 지운 뒤, 좁은 경사로 시안 PDF 빨강 #B3210F(시안 렌더 픽셀 비율에 맞춤) · 크림 #E9DDC9 두 색으로 나눠 정점 색으로 구움(또렷한 띠).

### 5.4-0 크리스마스 몸 = Seat_A (asset/Puuvilla_V03, 기본)
- `outfit.seatBody: true`(기본) → `public/models/seat.bin` + `muffler_seat.bin`. 만드는 곳: `dev/armsplit.html?save=1`(개발 서버에서 열면 seat.bin · seat_a.glb 저장).
- 원본 Seat_A.fbx 는 고개·오른팔만 리깅, 관절 배율이 하나 걸러 0.01 이라 three 에서 뼈대가 뭉침 → 관절 위치(boneInverse 역)만 써서 뼈대를 새로 만듦.
- **팔은 원본 메쉬·원본 가중치 그대로**(`dev/rigmirror.html?w=orig&sh=-58,182,-4&helpers=1&save=1` 이 seat.bin 을 만듦), 왼팔은 오른팔 가중치를 거울로.
  원본은 위팔이 몸통 옆면에 붙어 모델링돼 있어 위팔을 크게 들면 옆구리가 막처럼 늘어남 → 인사는 위팔을 살짝(앞 0.35 · 옆 0.25 rad)만 들고
  팔꿈치를 굽혀 아래팔을 세워 까딱 (`character.seatWave*`). 팔을 잘라 새로 만드는 방식(`dev/armsplit.html`)은 앞발이 뭉개져서 버림.
  팔을 머리 위까지 들게 하려면 그래픽 쪽에서 겨드랑이를 띄운(A포즈) 모델이 필요.
- 앱 좌표: 눈 두 개 중심·간격을 pu_stand 눈에 맞춤(배율 0.424). 눈·코·입은 검은 면 덩어리를 부품으로 떼고 0.45cm 띄움(몸 면은 그 자리도 덮음 — 구멍 방지).
- 앱에서: 몸통 기울이기 없음, 목 본이 머리 회전의 `character.seatNeckShare`(0.35) 를 나눠 가짐, 팔은 기존 손 흔들기·상반신 미믹 로직 그대로(위팔 = 어깨 본, 아래팔 = 팔꿈치 본).
- 목도리(`muffler_seat.bin`): V03 OBJ 목도리(고개 숙인 몸 기준)를 Seat 몸으로 — 몸통끼리/머리끼리 따로 강체 정합해 고리 높이로 섞고, 몸을 파고든 만큼 공간에서 흐린 변위로 덩어리째 밀어냄(`scripts/seat/` — scarf_to_seat.py → scarf_push.py → muf_seat_decim.mjs, 중간 파일 경로는 첫 인자 폴더).
  가중치: 고리 면 위 = 목 본, 아래·끝자락 = 몸.
- 개발: `__mimic.character.debugWave = 1` → 손 흔들기 강제.

### 5.4-3 서 있는 모델의 팔 분리 = `public/models/pu_stand_arm.obj` (작업 버전, 테스트 주소 :8443)
공개 링크의 서 있는 몸(pu_stand + muffler_fit)을 그대로 두고 팔만 몸통에서 떼어 낸 케이지 — `scripts/stand_arm_split.py`.
- pu_stand 케이지에서 팔은 어깨 위 16각 고리(base loop)에서 몸통 옆을 따라 뽑아낸 관(extrusion)이고, 관의 안쪽 절반은 몸통 속에 겹쳐 있다(단면 y 60~95 에서 팔 고리와 몸통 고리가 교차). 붙은 자리는 어깨 고리 하나뿐.
- 스크립트: 세로 모서리 묶음(edge ring, 16개)을 앞발에서 어깨까지 추적 → 맨 위 두 묶음이 공유하는 정점 = base loop(중심 (∓28,106,−1), r 15) → 앞발에서 홍수 채움(그 고리 모서리는 못 건넘) = 팔 면 264개.
  몸통 = 나머지 + base loop 채움(동심 고리 1단 + 부채꼴, 바깥으로 1.5cm 볼록 = 어깨), 팔 = 관 + base loop 를 안쪽 2cm 돔으로 닫음(쉴 땐 몸통 속). 왼팔은 거울. 출력 OBJ 부품: pu_body / pu_arm_R / pu_arm_L (+ 눈·코·스카프 원본), 옆에 .json(어깨 회전 중심 = 고리 중심 안쪽 7cm, 팔꿈치 = 팔 길이 45%, 손).
- 앱(`puuvilla.ts`): 부품 이름 `pu_arm_*` 면 .json 관절로 뼈를 두고(`armJoints`), 팔 부품은 전부 팔 본(어깨→손 축 위치로 위팔/아래팔), 몸통은 팔 가중치 0 → 팔 들어도 몸통·겨드랑이 안 늘어남. `armsFree`+`restIsIdle` → 인사는 `freeArmWave*`, 미믹은 사람 각 그대로. 서브디비전·털·목도리는 기존 그대로.
- 개발 확인: `?arm=1` (modelPath 교체) · `?wave=1`. 테스트 배포: `DEPLOY_CONFIG='{"character":{"modelPath":"./models/pu_stand_arm.obj"}}' npm run deploy:preview`.

### 5.4-2 (폐기) 앉은 몸 팔 교체 = `public/models/seat_t2.bin`
원본 Seat_A 는 위팔 안쪽 절반이 몸통에 붙어 있어(열린 껍질) 팔을 들면 막처럼 늘어남(5.4-0). **머리·몸통·목도리는 원본 그대로 두고 팔만** 닫힌 팔로 바꾼다 — `scripts/seat/arm_mirror.py`:
- 입력: `dev/armsplit.html?arm=mesh&cap=0&exportParts=1` → `public/models/parts_seat.glb` (앱 cm: torso = 팔 떼고 구멍 메운 몸통 · armR/armL = 원본 팔 껍질(바깥 절반) · fillR/fillL = 채움면).
- 팔 축: 껍질을 수평으로 썰어 원 맞춘 중심들의 직선(잔차 0.3cm). 거울면 = 축 + 앞뒤(z) 방향 평면, 법선 = 바깥쪽. 뼈 사슬은 팔 안쪽(붙었던 면)에 치우쳐 있어 축으로 못 씀.
- 바깥 절반(원본 면 그대로, 평면에서 잘라 용접) + 그 거울상 = 단면 좌우대칭 닫힌 팔. **바깥 표면은 원본과 동일** → 가만히 있을 땐 원본 화면과 같음.
- 위끝: 껍질 윗부분(어깨 돔)에 맞춘 구(중심 ≈ 축 위 (−27,99), r 15)와 거리장(감김수 부호)으로 합쳐 marching cubes → Taubin → 4000면. 거울면 테두리 띠가 만드는 V자 홈은 구 속에 묻히고, 회전 중심 위쪽은 구만 남김.
- 회전 중심(R/L_Shoulder) = 그 구의 중심 → 팔을 돌려도 어깨 돔은 제자리. **몸통 가중치는 팔 성분 0(고정)** → 팔 들어도 몸통이 안 딸려감. 팔꿈치 = 축 위 y=80, 어깨/팔꿈치 ±4cm 섞음.
- 헤더 `armsFree: true, restIsIdle: true` → 앱은 바인드(원본 내린 팔)를 쉬는 자세로 쓰고(`freeArmIdle*` 안 씀), 인사는 `freeArmWave*`(theta 2.2 · phi 0.4 · 팔꿈치 1.15 · ±0.3rad 1.4Hz), 상반신 미믹은 사람 각 그대로(`freeArmRaiseMaxRad`).
- 버린 방법(2026-10-20): 생성기(Hunyuan3D-2mv)로 몸 전체를 새로 만드는 것 — 몸통이 자루처럼 뭉개지고 앞발이 사라져 안 됨. 아래 기록은 참고용.

#### (참고·폐기) 생성 A포즈 몸 (`seat_t.bin`, `scripts/seat/gen_to_seat.py`)
Seat_A 를 A포즈로 돌린 참고 렌더로 3D 생성기가 팔 떨어진 몸을 새로 만들게 한 시도.
- 참고 렌더: `dev/armsplit.html?arm=sdf&ref=1&refArm=-0.5&rq=0.75&upperMax=1.15&thumbR=7` → 몸통(팔 구멍 메움) + 뼈 사슬 따라 만든 둥근 SDF 팔을 수평보다 0.5rad 아래로 벌린 자세, 앞/왼/뒤/오른 4방향 1024px RGBA 를 `/__mimic/trace` 로 보냄(IMG 줄 → 스크래치 폴더의 extract.py 가 png 로).
  팔 두께는 참고 렌더가 정함(rq 0.6 = 가늘고 0.9 = 뚱뚱, 0.75 채택). 2D 가이드 그림을 잘라 붙인 합성 입력은 팔이 납작한 날개로 나와서 버림(깊이 단서가 없음).
- 생성: `C:\SSG_Christmas\tools\gen_tpose.py front.png back.png --left left.png --right right.png --out dev/tmp/tpose_r4.glb --steps 50 --octree 384 --seed 7`
  — Hunyuan3D-2mv(로컬, `tools/Hunyuan3D-2`, 가중치 `tools/hf`), RTX 5090 에서 ≈110초. 출력은 y-up · 앞 +z, 20만 면. `dev/meshview.html?f=/dev/tmp/tpose_r4.glb` 로 4방향 확인.
- 앱용 변환: `python scripts/seat/gen_to_seat.py dev/tmp/tpose_r4.glb --out public/models/seat_t.bin --head orig`
  1. Taubin 다듬기(생성 노이즈) → 6만 면으로 간략화(털 셸 14겹 × 6만).
  2. seat.bin(원본, 앱 cm)에 정합: 키 배율 → 팔 뺀 영역(|x|<33)으로 ICP(강체+배율, 잔차 median 1.7cm).
  3. **머리는 원본 그대로**(`--head orig`): 목도리 띠 한가운데(방위각마다 다름 — 뒤 136 · 옆 ~120 · 앞 ~105cm)에서 잘라 원본 머리 + 생성 몸통·팔을 4cm 겹쳐 잇는다. 이음매는 목도리 속. 눈·코·입·목도리(`muffler_seat.bin`)는 손대지 않음. `--head gen` 이면 생성 머리 통째(눈·코·입은 새 표면에 다시 얹음).
  4. 뼈대: 몸·목·머리 원본. 팔 사슬은 생성 팔의 PCA 축 위 — 어깨 = 참고 렌더의 회전 중심(FBX `-75,165,-4` → 앱 `-31.8,107.9,-1.6`)을 축에 투영, 팔꿈치 = 팔 길이 45%.
  5. 가중치: 몸 = 원본 최근접 정점(팔 성분 제거 후 정규화), 팔 = 축 위치 t 로 어깨/팔꿈치(±6cm 섞음), 팔뿌리 둘레는 t∈[-10,4]cm · 반지름 1.8~2.6R 에서 몸과 smoothstep.
  헤더 `armsFree: true` 가 앱에 "팔이 자유" 를 알림.
- 앱(`puuvilla.ts`, `armsFree`): 바인드가 A포즈라 **쉬는 자세 = 위팔을 아래로 내린 절대 방향**(`character.freeArmIdleTheta/Phi/Elbow` — 아래에서 0.2rad 벌림·앞으로 0.55·팔꿈치 0.5) + 살랑임.
  인사(`freeArmWave*`): 위팔을 옆·위로(theta 2.0, phi 0.45) 들고 팔꿈치 1.0rad 굽혀 ±0.35rad 를 1.4Hz 로 흔듦 — 쉬는 자세와 slerp. 상반신 미믹은 사람 각 그대로(`freeArmRaiseMaxRad` 2.8, 붙은 팔용 [rest,π] 압축 안 함). 오버레이 "자유 팔" 폴더.
- 되돌리기: `character.seatModelPath` 를 `./models/seat.bin` 으로 (헤더에 armsFree 없음 → 5.4-0 동작).

### 5.4-1 배경 (가운데 아래 버튼)
- 겨울 마을 그림(기본) ↔ 주황 그라디언트. 선택은 그 기기에만(localStorage `pubilla-mimic-bg`), 다시 불러오지 않고 바로 바뀜. 키오스크는 주황 고정.
- 그림: `public/bg/` (원본 `카카오톡 받은 파일/plates/` 중 5장) — `src/backdrop.ts`
  - 캐릭터 뒤: `bg_far`(맨 아래, 화면을 덮게·아래 정렬) + `village_left`/`village_right`(왼쪽·오른쪽 아래, 높이 = min(화면 높이 56%, 폭 52%)) → 2D 캔버스 한 장에 그림.
  - 캐릭터 앞: `branches_left`/`branches_right` 좌상단·우상단 (DOM 이미지, 폭 min(72vh, max(46vw, 34vh)), 터치 통과).
- 그림 필터는 캐릭터를 배경 위에 합성해 불투명으로 내보내므로, 같은 뒤 배경 캔버스를 텍스처(`uBgTex`)로 넘겨 그 위에 합성 — 필터 켜도 끄도 같은 배경.
- 같은 폴더의 나머지(ground_snow·mound_*·props_*)는 아직 안 씀.

### 5.5 상태 연출
`character.alwaysVisible` true(기본): 등장/퇴장/유도 연출 없이 항상 떠 있음. false 면 IDLE→ATTRACT(빼꼼)→ENTER→MIMIC→EXIT 연출.

---

## 6. 화면·시점·성능

- **가로/세로**: `scene.layout` = `auto`(기본: 세로로 든 폰 = 세로 구도) / `landscape` / `portrait`. 왼쪽 아래 아이콘 버튼으로 전환(그 기기에 저장).
- **시점**: 가로 `viewCenterCm/viewHeightCm/viewOffsetXcm`, 세로 `pView*` (캐릭터 cm 기준: 화면 가운데 높이·보이는 높이·좌우). 캔버스는 항상 화면 전체, 시점 아래 끝이 화면 아래에 붙음. 화면이 더 길쭉하면 위로 하늘, 넓으면 양옆이 더 보임.
- PC: 튜닝 화면 '화면 시점' 슬라이더 + '📋 시점 값 복사'. 폰·태블릿: 두 손가락 확대/축소, 한 손가락 이동 (설정 메뉴 없음).
- 전체화면 버튼(안드로이드), 홈 화면에 추가 시 전체화면 앱(manifest).
- **성능**: 최고 품질로 시작 → 렌더 < `quality.minFps`(45) 또는 사람 있을 때 추론 < `minInferFps`(12)가 3초 지속되면 해상도·털 층 한 단계 하향. 얼굴 인식은 Web Worker → 2초에 16회 미만이면 메인 스레드 GPU 로 자동 전환.
- 폰: 카메라 640×480, MSAA 끔, 필터 샘플 줄임.
- 주소 옵션: `?quality=max` = 기기 상관없이 최고 품질 고정(화면 해상도 그대로·털 14층·MSAA·필터 전체·카메라 1280, 자동 하향 없음) / `?quality=0~5` = 그 단계 고정 / `?debug=1` = 폰에서도 튜닝 화면·속도 표시. 함께 쓰려면 `?quality=max&debug=1`. 주소 옵션은 그 기기에 저장되지 않음.

---

## 7. 배포·공유

| 방식 | 명령 | 용도 |
|---|---|---|
| 개발 | `npm run dev` | 튜닝 화면 값이 `public/config.json` 에 자동 저장. **HMR 꺼 둠**(코드 수정 때마다 카메라가 다시 열리며 노출이 리셋되던 문제) → 코드 바꾸면 F5 |
| 상시 호스팅 (현재 사용 중) | `npm run deploy` | `../pubilla-mimic-hosting/<시각>/` 에 빌드, `current.txt` 로 교체(서버 재시작 불필요, 최근 3개 보관). `scripts/serve.mjs`(127.0.0.1:4173, gzip·ETag) 를 Tailscale Funnel 이 HTTPS 로 공개 |
| 파일 하나 | `npm run build:single` | `release/pubilla-mimic.html`(≈36MB, 모델·wasm 내장). Chrome 더블클릭으로 실행 |
| 키오스크(현장) | `npm run build` → `scripts/kiosk.cmd` | `?kiosk=1`: 오버레이·커서 숨김, 절전 방지, 치명 오류 시 자동 재시작. 전부 로컬 |

**현재 공개 주소**: `https://nau-gyuchan.tailc22fe0.ts.net/` — 개발 PC(Windows) + Tailscale Funnel(개인 tailnet).
- 서버 상시 실행: 작업 스케줄러 `PubillaMimicServe`(로그인 시 `serve-hidden.vbs` → `serve-loop.cmd`, 죽으면 3초 뒤 재시작). 로그 `../pubilla-mimic-hosting/serve.log`.
- Funnel 회선이 느려(≈150KB/s) 배포본만 MediaPipe wasm·모델을 jsDelivr/Google CDN 에서 받음(로컬과 바이트 동일 확인).
- 배포본은 카메라 자동 노출로 시작, 보는 사람이 바꾼 값(시점·노출)만 그 브라우저에 저장(`pubilla-mimic-config-v2`).
- 다른 PC 로 옮기려면: Tailscale 설치·로그인 → tailnet 관리 콘솔에서 HTTPS 켜기 + ACL `nodeAttrs` 에 `funnel` 추가 → `tailscale funnel --bg 4173` → 작업 스케줄러 등록(`scripts/serve-hidden.vbs`).
- 끄기: `tailscale funnel --https=443 off`.

---

## 8. 설정 (public/config.json)

전부 튜닝 화면(`d`)에서 한국어 라벨+단위로 조절 가능. 섹션 요약:

| 섹션 | 내용 |
|---|---|
| camera | 해상도·미러·장치 라벨 고정·노출/밝기 |
| tracker | 모델 경로·GPU/CPU·인식 문턱·워커 사용 |
| smoothing | One Euro 필터 (고개·표정·깜빡임 따로) |
| presence | 접근 판정(얼굴 크기)·락온 영역·유지 시간 |
| mapping | 고개 게인·클램프, 눈 감음 문턱, 웃음/시무룩 배율, 입 벌림 문턱 |
| character | 모델·스케일·항상 표시·호흡·자동 깜빡임 |
| fur | 털 길이·가닥 굵기/간격·눕기·털뭉치·광택·그늘 |
| face | 먹선 색·굵기, 입 모양(웃음/시무룩/o), 눈 크기, 감은 눈, 볼터치 |
| scene | 배경색·조명·노출·카메라 각·가로/세로 시점 |
| quality | 성능 자동 조절 문턱 |
| pose / body | 상반신 미믹 (기본 꺼짐 — 원본 메쉬 팔이 몸에 붙어 있어 수평 이상 들면 늘어남) |
| kiosk | 현장 모드 |

---

## 9. 개발 도구

- **표정 정답 기록**: 개발 서버에서 `t` 키 → 화면 안내(무표정·웃음·시무룩·윙크 등 14단계, 약 77초)대로 하면 수치+정답 라벨이 `.trace/trace.jsonl` 에 기록(영상 아님). 문턱 조정 근거로 사용.
- **가이드 비교 촬영**: `?sim=1` 에서 `await __mimic.shot("이름", { rootY, mx, my, fov, ox, oy, w, h, levels })` → `.trace/trace.jsonl` 의 `IMG 이름 <dataURL>` 줄.
- 커밋 규칙: 작은 단위, 한국어 메시지 OK, 설정값 변경은 `public/config.json` 커밋으로.

---

## 10. 알려진 문제 / 다음 할 일

- [ ] **털 질감** — 가이드 2.4 처럼 보송한 솜털로 (5.3). 사용자가 가장 신경 쓰는 부분.
- [ ] **폰 지연** — 워커/메인 전환·품질 자동 조절을 넣었지만 "살짝 지연" 남음. 폰에서 추론 fps 실측 필요(폰은 설정 메뉴가 없으니 PC 원격 디버깅 또는 임시 표시).
- [ ] 실제 웹캠으로 표정 문턱 최종 확인 (`t` 키 테스트 데이터로).
- [ ] 접근 판정 실측(거울 앞 1.0/1.5/2.5m 얼굴 크기), 현장 조명(점멸·역광), 안경·마스크·모자.
- [ ] 2시간 무인 연속 동작 테스트 (메모리·fps·WebGL 컨텍스트).
- [ ] 팔: 제대로 하려면 그래픽 팀의 T/A 포즈 + 리깅 glb 필요 (ASSET_HANDOFF.md).
- [ ] 키오스크 셋업 (자동 로그인·실행·watchdog, 디스플레이 스케줄).

일정: 11/13 게이트(HW~백엔드, 2시간 무인 동작) → 11/16~25 그래픽 디벨롭 → 11/26 설치·리허설 → 11/27 오픈(안).

---

## 11. 개인정보
카메라 영상은 저장·전송하지 않는다. 얼굴 인식은 기기 안에서만 돈다(워커 포함). `.trace` 기록은 수치(블렌드셰이프·각도)만이고 개발 서버에서만 켜진다. 현장 안내 문구 필요 여부는 운영과 확인.
