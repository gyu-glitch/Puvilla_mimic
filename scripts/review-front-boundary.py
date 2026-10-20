from pathlib import Path
import av
from PIL import Image, ImageDraw
root = Path('docs/arm-review')
for p in root.glob('codex-v35-front-*.webm'):
    times = [1, 3, 4, 5, 6, 7, 9, 14, 17, 19]
    sheet = Image.new('RGB', (1600, 420), '#20252a')
    draw = ImageDraw.Draw(sheet)
    i = 0
    with av.open(str(p)) as video:
        for f in video.decode(video=0):
            if i < len(times) and f.time >= times[i]:
                im = f.to_image()
                im.thumbnail((320, 180))
                x, y = i % 5 * 320, i // 5 * 210
                sheet.paste(im, (x, y + 25))
                draw.text((x + 5, y + 5), f'{p.stem} / {times[i]}s', fill='white')
                i += 1
    sheet.save(p.with_name(p.stem + '-sequence.jpg'))
for angle in [0, 45, 90]:
    # Dense near-boundary samples reveal oscillating palm roll.
    sheet = Image.new('RGB', (1600, 420), '#20252a')
    draw = ImageDraw.Draw(sheet)
    for row, kind in enumerate(['before', 'after']):
        p = root / f'codex-v35-front-{kind}-frontboundary-{angle}.webm'
        if not p.exists():
            continue
        times, i = [5, 5.25, 5.5, 5.75, 6], 0
        with av.open(str(p)) as video:
            for f in video.decode(video=0):
                if i < len(times) and f.time >= times[i]:
                    im = f.to_image()
                    im.thumbnail((320, 180))
                    sheet.paste(im, (i * 320, row * 210 + 25))
                    draw.text((i * 320 + 5, row * 210 + 5), f'{kind} / {times[i]}s', fill='white')
                    i += 1
    sheet.save(root / f'codex-v35-detail-{angle}.jpg')
