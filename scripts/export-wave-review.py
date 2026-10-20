"""Transcode the actual canvas recording for inline/mobile review. No retouching."""
from pathlib import Path
from fractions import Fraction
import av
from PIL import Image

directory = Path(__file__).resolve().parents[1] / "docs" / "arm-review"
source = av.open(str(directory / "codex-wave-0.webm"))
output = av.open(str(directory / "codex-wave.mp4"), "w")
stream = output.add_stream("libx264", rate=30)
stream.width = source.streams.video[0].width
stream.height = source.streams.video[0].height
stream.pix_fmt = "yuv420p"
stream.options = {"crf": "20", "preset": "fast"}
frames = []
first = None
previous = -1
next_gif = 0
for frame in source.decode(video=0):
    first = frame.time if first is None else first
    elapsed = frame.time - first
    index = round(elapsed * 30)
    if index > previous:
        converted = av.VideoFrame.from_ndarray(frame.to_ndarray(format="rgb24"), format="rgb24")
        converted.pts = index
        converted.time_base = Fraction(1, 30)
        for packet in stream.encode(converted):
            output.mux(packet)
        previous = index
    if elapsed >= next_gif:
        im = frame.to_image().resize((640, 360), Image.Resampling.LANCZOS)
        frames.append(im)
        next_gif += .125
for packet in stream.encode():
    output.mux(packet)
output.close()
source.close()
palette = frames[0].quantize(colors=96)
indexed = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f in frames]
indexed[0].save(directory / "codex-wave.gif", save_all=True, append_images=indexed[1:],
                duration=125, loop=0, optimize=True, disposal=1)
contact = Image.new("RGB", (1200, 225))
for i, frame in enumerate([frames[0], frames[len(frames)//3], frames[2*len(frames)//3]]):
    contact.paste(frame.resize((400,225),Image.Resampling.LANCZOS),(i*400,0))
contact.save(directory / "wave-motion-check.jpg", quality=92)
print(f"Exported {len(frames)} sampled frames, duration approximately {elapsed:.2f}s")
