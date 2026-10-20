# 푸빌라 미믹

웹캠 + MediaPipe Face Landmarker + Three.js(WebGL). 화면 앞 사람의 고개·표정(깜빡임·윙크·웃음·시무룩·입 벌림)을 3D 곰 푸빌라가 실시간으로 따라 하는 거울 인터랙션.

**이어서 개발하는 사람은 [docs/HANDOFF.md](./docs/HANDOFF.md) 부터.** 요약은 [CLAUDE.md](./CLAUDE.md), 그래픽 인계는 [docs/ASSET_HANDOFF.md](./docs/ASSET_HANDOFF.md).

```bash
npm install            # node_modules 가 이미 있으면 생략 (다른 OS 면 지우고 다시)
npm run dev            # http://localhost:5173  (웹캠 없이: /?sim=1, 튜닝: d 키)
```

| 명령 | 내용 |
|---|---|
| `npm run dev` | 개발 서버 (튜닝값 자동 저장 → public/config.json) |
| `npm run build` | 타입 검사 + 빌드 → dist/ |
| `npm run deploy` | 상시 호스팅용 빌드 교체 (docs/HANDOFF.md 7장) |
| `npm run serve` | 호스팅 서버 127.0.0.1:4173 |
| `npm run build:single` | HTML 파일 하나로 (release/pubilla-mimic.html) |
| `npm run fetch-models` | MediaPipe 모델 다운로드 (압축본엔 포함됨) |
