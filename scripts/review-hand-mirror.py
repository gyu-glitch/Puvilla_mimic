from pathlib import Path
import av
from PIL import Image,ImageDraw
root=Path('docs/arm-review')
for path in root.glob('codex-v33-handmirror-*.webm'):
    times=[.7,2.5,4,5.5,7.5,9.5,11,12.5,14,15.5]
    sheet=Image.new('RGB',(1600,420),'#20252a');draw=ImageDraw.Draw(sheet);i=0
    with av.open(str(path)) as video:
        for frame in video.decode(video=0):
            if i<len(times) and float(frame.time)>=times[i]:
                im=frame.to_image();im.thumbnail((320,180));x=i%5*320;y=i//5*210
                sheet.paste(im,(x,y+26));draw.text((x+5,y+5),f'{path.stem} / {times[i]}s',fill='white');i+=1
    sheet.save(path.with_name(path.stem+'-sequence.jpg'))
    print(path.name,i)
sheet=Image.new('RGB',(1280,1140),'#20252a');draw=ImageDraw.Draw(sheet)
for row,t in enumerate([3,8,11]):
    for col,kind in enumerate(['before','after']):
        path=root/f'codex-v33-handmirror-{kind}-handmirror-0.webm'
        if not path.exists():continue
        with av.open(str(path)) as video:
            for f in video.decode(video=0):
                if float(f.time)>=t:
                    im=f.to_image();im.thumbnail((640,340));sheet.paste(im,(col*640,row*380+35));break
        draw.text((col*640+10,row*380+10),f'{kind.upper()} / {t}s',fill='white')
sheet.save(root/'codex-v33-handmirror-comparison.jpg')
