from pathlib import Path
import av
from PIL import Image,ImageDraw
root=Path('docs/arm-review')
for p in root.glob('codex-v34-winding-*.webm'):
 times=[1,5,10,14,18,22,25,28,31,35];sheet=Image.new('RGB',(1600,420),'#20252a');d=ImageDraw.Draw(sheet);i=0
 with av.open(str(p)) as v:
  for f in v.decode(video=0):
   if i<len(times) and f.time>=times[i]:
    im=f.to_image();im.thumbnail((320,180));x=i%5*320;y=i//5*210;sheet.paste(im,(x,y+25));d.text((x+5,y+5),f'{p.stem} / {times[i]}s',fill='white');i+=1
 sheet.save(p.with_name(p.stem+'-sequence.jpg'));print(p.name,i)
for t in [18,27,35]:
 sheet=Image.new('RGB',(1280,390),'#20252a');d=ImageDraw.Draw(sheet)
 for col,kind in enumerate(['before','after']):
  p=root/f'codex-v34-winding-{kind}-winding-0.webm'
  if not p.exists():continue
  with av.open(str(p)) as v:
   for f in v.decode(video=0):
    if f.time>=t:
     im=f.to_image();im.thumbnail((640,355));sheet.paste(im,(col*640,30));break
  d.text((col*640+8,8),f'{kind.upper()} / {t}s',fill='white')
 sheet.save(root/f'codex-v34-comparison-{t}.jpg')
