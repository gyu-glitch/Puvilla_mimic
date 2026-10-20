from pathlib import Path
import av
from PIL import Image,ImageDraw
root=Path('docs/arm-review')
for p in root.glob('codex-v26-session-*.webm'):
    times=[.5,2.5,4,7,12,15,17,19] if 'sustain' in p.name else [.5,2.5,4,6,8,9,10,11.5]
    sheet=Image.new('RGB',(1280,420),'#20252a');draw=ImageDraw.Draw(sheet);i=0
    with av.open(str(p)) as v:
        for f in v.decode(video=0):
            if i<len(times) and float(f.time)>=times[i]:
                im=f.to_image();im.thumbnail((320,180));x=i%4*320;y=i//4*210
                sheet.paste(im,(x,y+26));draw.text((x+6,y+5),f'{p.stem} {times[i]}s',fill='white');i+=1
    sheet.save(p.with_name(p.stem+'-sequence.jpg'));print(p.name,i)
for mode,time in [('depthpair',4),('sustain',12)]:
    out=Image.new('RGB',(1280,400),'#20252a');d=ImageDraw.Draw(out)
    for col,kind in enumerate(['before','after']):
        p=root/f'codex-v26-session-{kind}-{mode}-0.webm'
        if not p.exists():continue
        with av.open(str(p)) as v:
            for f in v.decode(video=0):
                if float(f.time)>=time:
                    im=f.to_image();im.thumbnail((640,360));out.paste(im,(col*640,40));break
        d.text((col*640+12,12),f'{kind.upper()} / {mode} / identical input at {time}s',fill='white')
    out.save(root/f'codex-v26-{mode}-comparison.jpg')
