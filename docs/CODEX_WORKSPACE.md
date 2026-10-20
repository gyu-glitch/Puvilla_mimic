# Codex 작업 환경 — 2026-10-20

최신 업데이트: Codex current.txt는 `codex-20261020-021858`(연결된 원본 메쉬 기반 팔 미믹 첫 검토본)을 가리킨다. 초기 공개 기준본은 별도 폴더에 그대로 보존했다. 상세 검증은 [ARM_MIMIC.md](ARM_MIMIC.md).

## 소유 범위

사용자는 Claude와 Codex가 독립적으로 작업하기를 요청했다.

| 구분 | 경로 / 주소 |
| --- | --- |
| Codex 소스 | C:/SSG_Christmas/pubilla-mimic-codex |
| Codex 호스팅 | C:/SSG_Christmas/pubilla-mimic-codex-hosting |
| 실행 중인 로컬 기준본 | http://localhost:4175/?sim=1 |
| 개발 서버 설정 | http://localhost:5175/ (`npm run dev`로 시작) |
| 외부 주소 계획 | https://nau-gyuchan.tailc22fe0.ts.net:10000/ — 아직 연결 안 됨 |
| Claude 소스 (참조 전용) | C:/SSG_Christmas/pubilla-mimic |
| 원래 호스팅 (참조 전용) | C:/SSG_Christmas/pubilla-mimic-hosting |

원래 공개 current.txt는 `20261020-004619`, Claude 테스트 preview.txt는 `preview-20261020-015018`이다. 두 포인터와 기존 Funnel 443/8443은 변경하지 않았다.

## 출발점과 검증

- 소스는 기존 작업 디렉터리의 미커밋 변경을 포함한 파일 복사본이다. 기존 Git 이력, 임시 생성물(dev/tmp), 작업 실험(work), 로그는 복사하지 않았다. node_modules도 독립 파일 사본이다.
- `work/stand/pu_stand.obj`와 `muffler_fit.bin`은 공개 빌드 `20261020-004619`에서 직접 복사했다. 같은 파일을 Codex public/models에도 적용했다.
- 공개 배포본 49개 파일을 `../pubilla-mimic-codex-hosting/baseline-20261020-004619`에 보존했다. 모든 파일의 SHA-256 일치 확인.
- 초기 Codex current.txt는 이 보존 사본을 가리켰다. 소스 스냅샷 빌드와 공개 배포본이 동일하다는 뜻은 아니다.
- `npm run build` 타입 검사와 번들 빌드 통과. 로컬 config.json HTTP 200 및 공개 기준 빌드 ID 확인.
- 공개 화면은 ?sim=1로 확인했다. 실카메라 추적 테스트는 하지 않았다.

원본 SHA-256:

| 파일 | SHA-256 |
| --- | --- |
| pu_stand.obj | 18ee1aacbd91b86a87d7fc05576b563ca2b1dc79534da92c02b9a50e288f7aef |
| muffler_fit.bin | d1b64cde6d7457b524c103848e5c9cc4b15c6e9c205bd7d03f2030e6b3095496 |

## 팔 작업 판단

- 사용자가 `stand_arm_split.py`의 팔 자르기 방식을 명시적으로 거절했다. 이 방식은 어깨에서 몸통과 팔을 별도 닫힌 메쉬로 나누고, 별도 팔 뼈 가중치와 들어 올릴 때 가늘게 만드는 처리를 적용한다. 이후 실험의 기준 모델로 사용하지 않는다.
- `stand_wave_arap.py`는 연결된 원본 쿼드 메쉬에서 오른팔·어깨 주변을 변형하고 앞발의 위치/방향을 강제로 맞추는 사전 계산 스크립트다. 올림 키 포즈와 흔들기 양 끝 포즈를 OBJ/JSON으로 출력한다.
- 이 스냅샷에는 ARAP 결과 파일이나 이를 앱에 연결한 코드가 없다. 검증된 해결책이 아니다. 어깨·팔의 부피, 자기 교차, 손바닥 방향, 원래 실루엣을 확인한 후 채택 여부를 판단해야 한다.
- 현재 작업 대상은 서 있는 공개 모델이다. 앉은 몸 실험은 제외한다.

## 실행과 업데이트

이 프로젝트 폴더에서 실행한다.

```powershell
npm run dev       # 5175 개발 서버
npm run build     # 타입 검사 + dist 빌드
npm run serve     # 4175, Codex hosting의 current.txt 제공 (이미 실행 중이면 중복 실행 금지)
npm run deploy    # Codex hosting에 새 빌드 + Codex current.txt 교체
```

deploy 스크립트는 Codex 호스팅만 사용하도록 수정했고 자동 이전 빌드 삭제를 제거했다. `deploy:preview`도 같은 Codex 전용 배포 명령이다. 원래 프로젝트에서 배포 명령을 실행하면 안 된다.

로컬 서버는 현재 Codex 명령 세션으로 실행 중이다. 재로그인 자동 시작은 등록하지 않았다. `scripts/serve-codex.ps1`은 수동 시작용 재시작 루프다.

## 외부 주소 연결 미완료

전용 서버 시작·Funnel 연결·빌드가 포함된 명령이 자동 승인 검토에서 `blocked by policy`로 거절됐다. 구체적인 이유는 도구 응답에 없었다. 이후 로컬 전용 서버 실행과 빌드는 별도로 완료했다. Tailscale 조회 결과 기존 443/8443만 있으며 10000 연결은 없다.

외부 연결은 사용자 측에서 아래 명령을 실행하거나 차단이 해소된 후 별도 검증이 필요하다.

```powershell
& 'C:\Program Files\Tailscale\tailscale.exe' funnel --bg --https=10000 http://127.0.0.1:4175
```
