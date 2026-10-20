from pathlib import Path
import av
from PIL import Image,ImageDraw
root=Path('docs/arm-review')
for path in root.glob('codex-v29-bend-*.webm'):
    times=[.5,2.5,4,5.5,7,8.5,10,11.5,13.5,15] if '-palmnear-' in path.name else [.5,2.5,4,6,8,9,10,11.5]
    sheet=Image.new('RGB',(1600,420),'#20252a');d=ImageDraw.Draw(sheet);i=0
    with av.open(str(path)) as video:
        for f in video.decode(video=0):
            if i<len(times) and float(f.time)>=times[i]:
                im=f.to_image();im.thumbnail((320,180));x=i%5*320;y=i//5*210
                sheet.paste(im,(x,y+26));d.text((x+6,y+5),f'{path.stem} / {times[i]}s',fill='white');i+=1
    sheet.save(path.with_name(path.stem+'-sequence.jpg'));print(path.name,i)
out=Image.new('RGB',(1280,760),'#20252a');d=ImageDraw.Draw(out)
for row,t in enumerate([3,8]):
    for col,kind in enumerate(['0p32','0p45']):
        path=root/f'codex-v29-bend-{kind}-palmnear-0.webm'
        if not path.exists():continue
        with av.open(str(path)) as video:
            for f in video.decode(video=0):
                if float(f.time)>=t:
                    im=f.to_image();im.thumbnail((640,340));out.paste(im,(col*640,row*380+35));break
        d.text((col*640+10,row*380+10),f'{kind.upper()} / palm stays forward / {t}s',fill='white')
out.save(root/'codex-v29-bend-comparison.jpg')
detail=Image.new('RGB',(600,880),'#20252a');d=ImageDraw.Draw(detail)
for row,view in enumerate([0,45]):
    for col,kind in enumerate(['0p32','0p45']):
        with av.open(str(root/f'codex-v29-bend-{kind}-palmnear-{view}.webm')) as video:
            for f in video.decode(video=0):
                if float(f.time)>=8:
                    im=f.to_image()
                    # Same source pixels and crop for both candidates, no retouching.
                    box=(300,170,600,580) if view==0 else (360,170,660,580)
                    detail.paste(im.crop(box),(col*300,row*440+30));break
        d.text((col*300+8,row*440+8),f'{kind} / {view} deg / 8 sec',fill='white')
detail.save(root/'codex-v29-bend-detail.jpg')
