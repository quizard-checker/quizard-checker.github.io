from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'public' / 'demo'
OUT = SRC / 'quizard-demo-4-students-long-bond-v2.1.pdf'
PAGES = [
    ('pin-sheet-ivan.png', 'pin-sheet-joy.png'),
    ('pin-sheet-kat.png', 'pin-sheet-leo.png'),
]

# Long bond is 8.5 x 13 in. The demo sheets are rendered at 2142 px wide;
# keep the old print layout: 92% sheet size, big corner registration marks,
# and a dashed cut line between the two half-sheets.
DPI = 252
W, H = 2142, 3276
HALF_H = H // 2
SCALE = 0.920135
X_OFF = 85
Y_OFF = 65
MARK = 43
MARK_X = (97, 2000)
MARK_Y = (81, 1513)
CUT_COLOR = (160, 160, 160)
try:
    CUT_FONT = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 22)
except OSError:
    CUT_FONT = ImageFont.load_default()

def clear_corner_marks(draw, img, left, top):
    """White out the sheet's own small corner marks before drawing the big
    registration marks. The old long-bond layout used marks that covered
    these exactly; the regenerated sheets place them slightly differently,
    which leaves a little black tail under each big mark."""
    w, h = img.size
    regions = [
        (0, 0, 70, 100),
        (w - 70, 0, w, 100),
        (0, h - 100, 70, h),
        (w - 70, h - 100, w, h),
    ]
    pixels = img.load()
    for rx0, ry0, rx1, ry1 in regions:
        xs = []
        ys = []
        for y in range(ry0, ry1):
            for x in range(rx0, rx1):
                r, g, b = pixels[x, y]
                if r + g + b < 240:
                    xs.append(x)
                    ys.append(y)
        if not xs:
            continue
        pad = 8
        draw.rectangle(
            (left + min(xs) - pad, top + min(ys) - pad,
             left + max(xs) + pad, top + max(ys) + pad),
            fill='white',
        )


pages = []
for names in PAGES:
    page = Image.new('RGB', (W, H), 'white')
    draw = ImageDraw.Draw(page)
    for i, name in enumerate(names):
        img = Image.open(SRC / name).convert('RGB')
        img = img.resize(
            (round(img.width * SCALE), round(img.height * SCALE)),
            Image.Resampling.LANCZOS,
        )
        page.paste(img, (X_OFF, Y_OFF + i * HALF_H))
        clear_corner_marks(draw, img, X_OFF, Y_OFF + i * HALF_H)

    for i in range(2):
        top = i * HALF_H
        for x in MARK_X:
            for y in MARK_Y:
                draw.rectangle((x, top + y, x + MARK - 1, top + y + MARK - 1), fill='black')

    # Dashed cut line across the middle, same 19 px dash / 11 px gap as the
    # original long-bond PDF.
    x = 20
    while x < W - 20:
        draw.rectangle((x, HALF_H, min(x + 18, W - 21), HALF_H + 1), fill=CUT_COLOR)
        x += 30
    draw.text((W - 180, HALF_H - 30), 'cut here', fill=CUT_COLOR, font=CUT_FONT)

    pages.append(page)

OUT.parent.mkdir(parents=True, exist_ok=True)
pages[0].save(
    OUT, 'PDF', resolution=DPI, save_all=True, append_images=pages[1:], quality=95
)
print(f'wrote {OUT} ({OUT.stat().st_size} bytes)')
