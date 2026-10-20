# 유화 · 획 (세부 보존) 필터 — 다른 웹에 붙이기

재료 필터 갤러리의 메인 필터입니다. 영상이나 3D 장면을 유화 붓 획으로 다시 칠합니다.
WebGL2만 쓰고 의존성은 없습니다. 파일 하나(`oil-stroke.js`)를 복사해 씁니다.

| 파일 | 내용 |
|---|---|
| `oil-stroke.js` | 필터 모듈. 이 파일만 가져가면 됩니다 |
| `example.html` | 최소 예제: 영상 → 필터. 갤러리 배포 주소 뒤에 `/oil-stroke/example.html` |
| `oil-stroke-guide.md` | 이 문서 |

결과는 갤러리와 픽셀 단위로 같습니다. 2026-10-15에 짧은 변 1080, 정지 프레임, 그림 번호 3가지로 비교해 차이가 0이었습니다.

## 값

확정 세팅이 모듈의 기본값(`DEFAULTS`)입니다. 따로 넘기지 않으면 이 값으로 그립니다.

| 값 | 기본 | 범위 | 하는 일 |
|---|---|---|---|
| `strength` 강도 | **0.10** | 0 ~ 1.6 | 물감 두께. 붓 자국의 요철·광택, 캔버스 결, 획 색의 흔들림. 0이면 평평 |
| `size` 붓·코 크기 | **1.25** | 0.6 ~ 1.8 | 붓의 굵기·간격·길이 배율 |
| `boil` 획 다시 그리기 | **0.10** | 0 ~ 1 | 그림이 바뀔 때 새 자리에 놓는 획의 비율. 0이면 붓 자리 고정, 1이면 매번 전부 새로 |
| `fps` 초당 그림 | 24 | 2 ~ 30 | 1초에 그림을 몇 장 새로 그릴지 |
| `grade` 색 보정 | 1.0 | 0 ~ 1 | 색을 따뜻한 쪽으로 살짝 당기는 정도. 0이면 원본 색 |

## 붙이는 법

### 1. 영상 하나에 입히기

```html
<canvas id="out"></canvas>
<script type="module">
  import {OilStroke, fitSize} from './oil-stroke.js';

  const video = Object.assign(document.createElement('video'), {src: 'clip.mp4', muted: true, loop: true, playsInline: true});
  const canvas = document.getElementById('out');
  const fx = new OilStroke(canvas);                     // 기본값 그대로

  video.addEventListener('loadeddata', () => {
    const {w, h} = fitSize(video.videoWidth, video.videoHeight, 720);   // 결과 크기: 소스 비율, 짧은 변 720
    canvas.width = w; canvas.height = h;
    video.play();
  });
  (function loop() {
    if (video.readyState >= 2) fx.frame(video, video.currentTime);
    requestAnimationFrame(loop);
  })();
</script>
```

### 2. 이미 WebGL·three.js로 그리는 장면에 입히기

- 필터 캔버스를 따로 두고, 장면 캔버스를 소스로 넘깁니다. 모듈이 GL 상태를 바꾸니 장면과 같은 GL 컨텍스트를 함께 쓰지 마세요.
- 장면을 그린 **바로 다음 줄**에서 `frame()`을 부르세요. 브라우저는 화면에 내보낸 WebGL 캔버스를 비웁니다. 다음 틀에서 읽으면 검은 그림이 나옵니다. 따로 불러야 한다면 장면 렌더러를 `preserveDrawingBuffer: true`로 만드세요.
- 필터 캔버스를 장면 캔버스 위에 같은 크기로 겹치고 `pointer-events: none`을 주면, 마우스·터치는 아래 장면이 그대로 받습니다.

```js
const fx = new OilStroke(filterCanvas);                 // filterCanvas는 장면 캔버스 위에 겹친 캔버스
renderer.setAnimationLoop(t => {
  renderer.render(scene, camera);
  fx.frame(renderer.domElement, t / 1000);              // 같은 틀 안에서 바로
});
```

`fx.frame()`은 그림 번호가 바뀔 때만 다시 그립니다. 장면이 초당 60번 그려져도 필터 그림은 초당 `fps`장만 바뀝니다. 손그림처럼 그림이 한 장씩 넘어가는 이 느낌이 의도한 것입니다.

### 3. 이미지 한 장, 저장

```js
fx.render(image, 0);                                    // 두 번째 값 = 그림 번호. 같으면 같은 그림
canvas.toBlob(b => {/* 저장 */}, 'image/png');           // 모듈 캔버스는 지워지지 않게 만들어 둠
```

## 함수

| 함수 | 설명 |
|---|---|
| `new OilStroke(canvas, params?)` | 캔버스에 필터를 만든다. `params`는 위 표에서 바꿀 값만 |
| `fx.set({strength, size, boil, fps, grade})` | 값 바꾸기. 다음 `frame()`에서 다시 그린다 |
| `fx.frame(source, t)` | 시각 `t`(초)에 맞춰 필요할 때만 그린다. 그렸으면 `true` |
| `fx.render(source, seed)` | 지금 바로 한 장 그린다 |
| `fx.dispose()` | GPU 자원 돌려주기 |
| `fitSize(w, h, short)` | 소스 비율에 맞춘 결과 크기(짧은 변 `short`, 짝수) |
| `fx.ms` | 마지막 그림에서 CPU가 쓴 시간(ms). GPU 시간은 아님 |

`source`에는 `video`·`img`·`canvas`·`ImageBitmap`·`VideoFrame`을 넣을 수 있습니다.

## 시간 규칙

- 그림 번호는 `floor(t × fps)`입니다. 번호가 같으면 앞 그림을 그대로 둡니다.
- 붓 자리는 그림 번호로 정해집니다(`seed = 번호 % 997`). 같은 시각이면 언제 다시 그려도 같은 그림이라, 영상을 멈추거나 되감아도 붓 자국이 흔들리지 않습니다.
- `t`에는 영상이면 `video.currentTime`, 실시간 장면이면 `performance.now() / 1000`을 넣습니다.

## 크기와 속도

결과 크기는 캔버스 크기(`width`·`height`)입니다. 필터 수치는 짧은 변 1080px 기준이고, 다른 크기에서는 붓 크기를 비례로 맞춥니다. 그래서 720에서도 같은 그림의 작은 판이 됩니다.

아래는 Apple M4 Pro, Chrome에서 그림 한 장에 든 시간입니다(GPU가 끝날 때까지 포함).

| 짧은 변 | 크기(세로 영상) | 한 장 | 초당 최대 |
|---|---|---|---|
| 1080 | 1080×1918 | 16.4ms | 61장 |
| 720 | 720×1278 | 12.6ms | 79장 |
| 540 | 540×960 | 12.5ms | 80장 |

- **실시간 웹은 짧은 변 720을 권합니다.** 720보다 작게 해도 빨라지지 않습니다. CPU가 획 목록(약 25만 개)을 만드는 약 8ms가 남기 때문입니다.
- 크기·`size`·`boil`을 처음 쓰는 조합에서는 획 목록을 새로 만드느라 한 장에 약 0.1초가 더 걸립니다. 이 값들을 매 틀 바꾸지 마세요. 같은 조합은 기억해 두고 다시 씁니다.
- 느린 기기에서는 다음 순서로 낮춥니다.
  1. `fps`를 24에서 12로: 그리는 횟수가 반으로 줄어듭니다.
  2. 결과 크기를 720에서 540으로.
- WebGL2와 `EXT_color_buffer_float`가 필요합니다. 요즘 데스크톱·모바일 브라우저는 대부분 지원합니다. 없으면 붓 방향 계산이 깨지니 `fx.floatOk`로 확인하세요.
- GPU 메모리는 짧은 변 720에서 약 27MB, 1080에서 약 60MB입니다. 여기에 소스 영상 한 장 크기가 더해집니다.

## 입력 조건

- 캔버스 비율을 소스 비율과 맞추세요(`fitSize`). 다르면 그림이 늘어납니다.
- 다른 주소(도메인)의 영상·이미지는 CORS가 열려 있어야 하고, `crossOrigin = 'anonymous'`를 주어야 합니다. 아니면 WebGL이 읽지 못해 오류가 납니다.
- 영상이 첫 프레임을 받기 전(`readyState < 2`)에는 부르지 마세요.
- 투명도는 쓰지 않습니다. 결과는 불투명입니다.

## 안 되면

| 증상 | 확인할 곳 |
|---|---|
| 검은 화면 | 영상 준비 전에 불렀는지, 다른 주소의 소스인지(CORS), WebGL 캔버스를 다음 틀에 읽었는지(2번 참고) |
| 그림이 늘어남 | 캔버스 비율과 소스 비율 |
| 화면이 멈춤 | `fps`가 너무 낮은지, 영상이 멈춰 `currentTime`이 그대로인지 |
| 갑자기 아무것도 안 그려짐 | GPU 컨텍스트를 잃었을 수 있음. `webglcontextlost` 이벤트에서 `new OilStroke()`로 다시 만들기 |

## 고칠 때

- 셰이더는 갤러리(`public/index.html`) 원문을 그대로 옮긴 것입니다. 모듈 안에서 고치지 말고, 갤러리를 고친 뒤 같은 이름의 `const` 블록을 다시 옮기세요.
- 그림의 성격은 `LAYERS`(굵은 붓 → 가는 붓 세 층)와 `REFINE`(눈·입처럼 세밀한 곳을 다시 칠하는 층)이 정합니다. 이 값을 바꾸면 갤러리와 다른 그림이 됩니다.
- 원리: 형태의 방향을 따라 굵은 붓부터 가는 붓까지 획을 겹쳐 칠합니다(Hertzmann 1998). 칠한 결과가 원본과 많이 다른 칸에만 가는 붓을 한 번 더 놓습니다. 마지막으로 획의 높이로 물감 두께와 광택을 얹습니다.
