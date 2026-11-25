# 把若干张手机截图缩小后拼成一张，便于整体查看。
#   python3 tools/contact-sheet.py <out.png> <img1> <img2> ...
import sys
from PIL import Image
out, names = sys.argv[1], sys.argv[2:]
ims = [Image.open(n).convert('RGB') for n in names]
tw = 360
thumbs = [im.resize((tw, round(im.height * tw / im.width)), Image.LANCZOS) for im in ims]
th = max(t.height for t in thumbs)
cols = min(5, len(thumbs))
rows = (len(thumbs) + cols - 1) // cols
sheet = Image.new('RGB', (cols * (tw + 8) + 8, rows * (th + 8) + 8), (80, 80, 80))
for i, t in enumerate(thumbs):
    sheet.paste(t, (8 + (i % cols) * (tw + 8), 8 + (i // cols) * (th + 8)))
sheet.save(out)
print(out, sheet.size)
