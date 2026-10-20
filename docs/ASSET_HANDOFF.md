# 그래픽 인계 명세 (초안 — 11/13 게이트에서 확정)

프록시 캐릭터(`src/character/proxy.ts`)를 실제 푸빌라 에셋으로 교체할 때 필요한 것.
리그 방식(2D 파츠 vs 3D glb+blendshape)은 W1 결정 사항. 어느 쪽이든 인터페이스는 동일.

## 코드 인터페이스 (고정)
```ts
interface CharacterRig {
  root: THREE.Object3D;                      // 씬에 add
  apply(p: CharacterParams, dtSec, tSec);    // 매 프레임
  setState(s: { state, elapsedMs, progress });
}
interface CharacterParams {
  headYaw, headPitch, headRoll   // rad, 클램프 적용됨 (기본 ±40/±25/±20°)
  blinkL, blinkR                 // 0~1
  eyeWide                        // 0~1
  jawOpen                        // 0~1
  smile                          // -1(찡그림) ~ +1(웃음)
  browUp                         // -1(찌푸림) ~ +1(올림)
  pucker, cheek                  // 0~1
}
```

## 현재 적용 상태 (2026-10-13)
- `pu_stand.obj` 를 그대로 쓰고 런타임에 세분화·리깅 (`src/character/puuvilla.ts`). 텍스처 파일은 없고 가이드북 값(털 #F2F2F2, 스카프 #EF2E2E, 라인 #000)을 셰이더로 재현.
- 입·볼터치·눈썹·감은 눈은 메쉬에 없어서 셰이더로 그림 → 그래픽 팀 확인 필요: 입 위치/폭(`face.mouthY/mouthHalfW`), 볼터치 위치, 선 굵기.
- 그래픽 팀에 요청하면 품질이 오를 것: (1) 머리·팔 본이 있는 glb, (2) 입/눈 감기 블렌드셰이프(또는 얼굴 텍스처 아틀라스), (3) 털 노멀/알파 텍스처.

## 상태별 필요 모션
| 상태 | 설명 | 길이 | 루프 |
| --- | --- | --- | --- |
| IDLE | 캐릭터 없음 (프레임/배경만) | — | — |
| ATTRACT | 프레임 아래에서 빼꼼 → 손짓 → 내려감 | 4 s 주기 | 루프 |
| ENTER | 등장 (튀어오르듯) | 0.6 s | 1회 |
| MIMIC | 기본 idle (호흡·자동 깜빡임) 위에 파라미터 적용 | — | 루프 |
| EXIT | 손 흔들며 퇴장 | 0.8 s | 1회 |
| (리액션) | 놀람/웃음 트리거 시 짧은 리액션 (선택) | 0.5~1 s | 1회 |

## 3D(glb + blendshape)인 경우
- ARKit 52 blendshape 네이밍 그대로면 `mapping.ts` 를 거의 안 거치고 직결 가능 (`signals.ts` 의 `blend` 를 morphTargetInfluences 로).
- 머리 본(head bone) 1개 필요. yaw/pitch/roll 을 그 본의 rotation 에 적용.
- 텍스처 2K 이하, 드로우콜 10 이하 목표 (내장 GPU 가능성 대비).

## 2D 파츠인 경우
- 레이어: 몸 / 머리 / 눈(L,R) / 눈꺼풀(L,R) / 눈썹(L,R) / 입(열림 단계 3~4종 또는 메시 변형) / 볼 / 귀 / 목도리
- 머리 회전은 파츠 패럴랙스(눈·코·입 오프셋)로 표현. yaw ±40° 에서 깨지지 않는 범위 정의 필요.
- PNG(알파) 또는 Spine/Live2D 익스포트 — 런타임 라이브러리 추가 여부 결정 필요.

## 배경·프레임
- 세로 화면(예: 1080×1920). 거울 프레임 이미지 1장 (알파), 배경 1장. 크리스마스 장식은 프레임에 포함.

## 사운드 (선택)
- 등장 / 퇴장 / 놀람 리액션 3종. 키오스크 PC 스피커 유무 확인.
