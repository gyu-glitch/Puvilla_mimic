# Puvilla_mimic — 푸빌라 미믹

웹캠 + MediaPipe Face Landmarker + Three.js(WebGL). 화면 앞 사람의 고개·표정(깜빡임·윙크·웃음·시무룩·입 벌림)을 3D 곰 푸빌라가 실시간으로 따라 하는 거울 인터랙션.

현재 작업본은 Codex 개발본 **v49**입니다. 얼굴·상반신·팔 미믹, 입력 90도 회전, 출력 좌우반전, 추론 워커와 유화 렌더 최적화, 빈 공간의 몸 오검출에 대한 얼굴 확인 처리를 포함합니다.

**이어서 개발하는 사람은 [AGENTS.md](./AGENTS.md), [docs/CONTINUOUS_REVIEW.md](./docs/CONTINUOUS_REVIEW.md), [docs/ARM_MIMIC.md](./docs/ARM_MIMIC.md)를 먼저 확인하세요.** 기존 [docs/HANDOFF.md](./docs/HANDOFF.md)와 [CLAUDE.md](./CLAUDE.md)는 초기 프로젝트 기록으로, 서버 경로·포트는 현재 작업본과 다를 수 있습니다.

Node.js 24 LTS와 npm을 사용합니다. 새로 복제한 저장소에서는 다음 순서로 실행합니다.

```bash
npm ci                 # 의존성 설치 및 MediaPipe WASM 복사
npm run fetch-models   # Git에서 제외한 얼굴/포즈 모델 다운로드
npm run dev            # http://localhost:5175  (웹캠 없이: /?sim=1, 튜닝: d 키)
```

| 명령 | 내용 |
|---|---|
| `npm run dev` | 개발 서버 (튜닝값 자동 저장 → public/config.json) |
| `npm run build` | 타입 검사 + 빌드 → dist/ |
| `npm run preview` | 빌드 결과 확인, http://localhost:4175 |
| `npm run deploy` | 이 PC의 Codex 전용 호스팅 빌드 교체 (AGENTS.md 확인) |
| `npm run build:single` | HTML 파일 하나로 (release/pubilla-mimic.html) |
| `npm run fetch-models` | MediaPipe 얼굴/포즈 모델 다운로드 |
| `npm run visitor:check` | 빈 공간 오검출 및 방문자 확인 회귀 검사 |
| `npm run performance:check` | 렌더 주기·추론 워커 회귀 검사 |

`node_modules`, 빌드 출력, 로컬 실행 ZIP, 다운로드한 `.task` 모델과 WASM은 Git에 포함하지 않습니다. 캐릭터 자산과 개발 검증 기록은 포함합니다. 공개 서버의 배포 이력·복구 방법은 `docs/CONTINUOUS_REVIEW.md`에 기록되어 있으며, 이 저장소에 푸시하는 것만으로 공개 서버가 배포되지는 않습니다.
