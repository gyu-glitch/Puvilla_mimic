from pathlib import Path
import av
from PIL import Image,ImageDraw
root=Path('docs/arm-review')
for path in root.glob('codex-v31-palm-*.webm'):
    times=[.5,2.5,3.5,3.8,4.5,5.5,6.5,8,10,11.5] if '-palmflip-' in path.name else [.5,2.5,4,6,8,9,10,11.5]
    sheet=Image.new('RGB',(1600,420),'#20252a');d=ImageDraw.Draw(sheet);i=0
    with av.open(str(path)) as video:
        for f in video.decode(video=0):
            if i<len(times) and float(f.time)>=times[i]:
                im=f.to_image();im.thumbnail((320,180));x=i%5*320;y=i//5*210
                sheet.paste(im,(x,y+26));d.text((x+6,y+5),f'{path.stem} / {times[i]}s',fill='white');i+=1
    sheet.save(path.with_name(path.stem+'-sequence.jpg'));print(path.name,i)
out=Image.new('RGB',(1280,760),'#20252a');d=ImageDraw.Draw(out)
for row,t in enumerate([3,6]):
    for col,kind in enumerate(['before','after']):
        path=root/f'codex-v31-palm-{kind}-palmflip-0.webm'
        if not path.exists():continue
        with av.open(str(path)) as video:
            for f in video.decode(video=0):
                if float(f.time)>=t:
                    im=f.to_image();im.thumbnail((640,340));out.paste(im,(col*640,row*380+35));break
        d.text((col*640+10,row*380+10),f'{kind.upper()} / palm stays forward / {t}s',fill='white')
out.save(root/'codex-v31-palm-comparison.jpg')

