from pathlib import Path
import av
import numpy as np
from PIL import Image,ImageDraw
root=Path('docs/arm-review')
for path in root.glob('codex-v27-jitter-*.webm'):
    times=[.5,2.3,3.4,5,6.5,8,10.5,12,13.5,15] if '-after-jitter-' in path.stem or '-before-jitter-' in path.stem else [.5,2.5,4,6,8,9,10,11.5]
    sheet=Image.new('RGB',(1600,420),'#20252a');d=ImageDraw.Draw(sheet);i=0
    with av.open(str(path)) as video:
        for f in video.decode(video=0):
            if i<len(times) and float(f.time)>=times[i]:
                im=f.to_image();im.thumbnail((320,180));x=i%5*320;y=i//5*210
                sheet.paste(im,(x,y+26));d.text((x+6,y+5),f'{path.stem} / {times[i]}s',fill='white');i+=1
    sheet.save(path.with_name(path.stem+'-sequence.jpg'));print(path.name,i)
out=Image.new('RGB',(1280,480),'#20252a');d=ImageDraw.Draw(out)
for row,kind in enumerate(['before','after']):
    path=root/f'codex-v27-jitter-{kind}-jitter-0.webm'
    if not path.exists():continue
    times=[2.3,2.7,3.1,3.5];i=0;motion=[];prev=None
    with av.open(str(path)) as video:
        for f in video.decode(video=0):
            t=float(f.time)
            if 2.5<=t<5.5:
                a=np.asarray(f.to_image().resize((320,180))).astype(float)
                if prev is not None:motion.append(float(np.mean(abs(a-prev))))
                prev=a
            if i<len(times) and t>=times[i]:
                im=f.to_image();im.thumbnail((320,180));out.paste(im,(i*320,row*240+40))
                d.text((i*320+8,row*240+10),f'{kind.upper()} / held still {times[i]}s',fill='white');i+=1
    print(kind,'mean rendered pixel change',np.mean(motion))
out.save(root/'codex-v27-jitter-comparison.jpg')
