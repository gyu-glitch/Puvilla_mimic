import av
from PIL import Image,ImageDraw
from pathlib import Path
root=Path('docs/arm-review')
times=[.5,2.5,3.2,3.8,4.5,5.5,6.5,7.5,9.5,11.5]
for path in root.glob('codex-v24-tracking-*.webm'):
    frames=[]; idx=0
    with av.open(str(path)) as video:
        for f in video.decode(video=0):
            if idx<len(times) and float(f.time)>=times[idx]:
                im=f.to_image();im.thumbnail((320,180));frames.append(im);idx+=1
    sheet=Image.new('RGB',(320*5,210*2),'#20252a');draw=ImageDraw.Draw(sheet)
    for i,im in enumerate(frames):
        x=(i%5)*320;y=(i//5)*210
        sheet.paste(im,(x,y+25));draw.text((x+6,y+5),f'{path.stem}  {times[i]:.1f}s',fill='white')
    sheet.save(root/(path.stem+'-sequence.jpg'))
    print(path.name, len(frames))

# Compact identical-input comparison from real rendered videos.
compare=Image.new('RGB',(960,440),'#20252a'); d=ImageDraw.Draw(compare)
for row,kind in enumerate(['before','after']):
    targets=[3.45,3.55,4.5];i=0
    with av.open(str(root/f'codex-v24-tracking-{kind}-tracking-0.webm')) as video:
        for f in video.decode(video=0):
            if i<len(targets) and float(f.time)>=targets[i]:
                im=f.to_image();w,h=im.size
                im=im.crop((int(w*.20),int(h*.08),int(w*.80),int(h*.98)))
                im.thumbnail((320,190));x=i*320+(320-im.width)//2;y=row*220
                compare.paste(im,(x,y+26));d.text((i*320+8,y+8),f'{kind.upper()} - uncertain left arm - {targets[i]}s',fill='white');i+=1
compare.save(root/'codex-v24-tracking-comparison.jpg')

