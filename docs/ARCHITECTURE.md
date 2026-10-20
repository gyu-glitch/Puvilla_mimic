# Codex 미믹 파이프라인

웹캠 → FaceTracker → SignalProcessor(대상 얼굴) → MimicStateMachine → 표정 매핑 → PuuvillaCharacter → Scene.

같은 웹캠 → PoseTracker → BodyProcessor(대상 얼굴과 일치하는 몸, 미러링·스무딩·팔별 가림 유지) → PuuvillaCharacter.solveArm → 어깨/팔꿈치 본 → 몸·털 렌더.

서 있는 원본의 팔 가중치는 빌드 도구 `scripts/build-standing-rig.mjs`에서 `public/models/stand_connected_rig.json`으로 계산한다. 런타임은 원본 몸 정점과 일치하는지 검증한 뒤 가중치를 몸과 동일한 세분화로 보간한다. 원본 OBJ는 수정하지 않는다. `body.armRig=legacy`는 이전 공간 기반 가중치 비교용이다.

소유 경계·배포 규칙은 루트 AGENTS.md, 작업 환경은 CODEX_WORKSPACE.md, 팔 검증은 ARM_MIMIC.md를 따른다.
