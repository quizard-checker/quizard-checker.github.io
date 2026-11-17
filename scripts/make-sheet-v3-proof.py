#!/usr/bin/env python3
"""Generate a print proof for the v3 PIN half-sheet layout.

Design constraints:
- 8.5 x 13 in long bond, two 468 pt halves per page.
- 10 mm solid corner markers with a white quiet zone, inside a safe margin.
- 50 items in 5 sub-columns x 10 rows.
- Distinct horizontal column bars (not small square anchors).
- 90 pt QR with a 4-module quiet zone.
- No printed outer border.

This is a design proof only. The scanner still uses the v2 geometry until P3
adds old/new layout selection.
"""
from __future__ import annotations

import os
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

DPI = 300
PX_PER_PT = DPI / 72.0
PAGE_W_PT, PAGE_H_PT = 612, 936
HALF_H_PT = 468
CUT_PT = 468
OUT = Path(os.environ.get("QUIZARD_V3_PROOF", r"C:\Users\user\Downloads\quizard-sheet-v3-proof-long-bond.pdf"))

INK = (11, 8, 32)
GRAY = (100, 106, 120)
LIGHT = (225, 228, 235)
WHITE = (255, 255, 255)

# v3 geometry, in PDF points, local to one 612 x 468 half.
MARKER = 28.35               # 10 mm
QUIET = 11.34                # 4 mm
MARKER_CENTERS = [(50, 50), (562, 50), (562, 418), (50, 418)]
CONTENT = (80, 80, 532, 388)  # left, top, right, bottom
CONTENT_W = CONTENT[2] - CONTENT[0]
CONTENT_H = CONTENT[3] - CONTENT[1]
PIN_X0 = 80
PIN_DX = 18
PIN_WRITE_Y = 136
PIN_ROW_Y0 = 162
PIN_PITCH = 20
PIN_R = 3.3
ITEM_X0 = 200
ITEM_DX = 46
ITEM_ROW_Y0 = 170
ITEM_PITCH = 20
ITEM_R = 3.3
LETTERS = ["A", "B", "C", "D"]
LETTER_DX = 9
LETTER_PAD = 8
QR_SIZE = 90
QR_X = 430
QR_Y = 258
QR_PAYLOAD = "QZ3v3:demo-cls-eng:demo-quiz-2"
QR_QUIET_MODULES = 4


def px(pt: float) -> int:
    return int(round(pt * PX_PER_PT))


def font(size_pt: float, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\calibrib.ttf" if bold else r"C:\Windows\Fonts\calibri.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, px(size_pt))
    return ImageFont.load_default()


FONT_6 = font(6)
FONT_65 = font(6.5)
FONT_7 = font(7)
FONT_8 = font(8)
FONT_9 = font(9)
FONT_10 = font(10)
FONT_10B = font(10, True)
FONT_11B = font(11, True)
FONT_14B = font(14, True)


def make_qr(text: str, size_pt: float) -> Image.Image:
    """Return a white-quiet-zone QR image at the requested point size."""
    qr = None
    try:
        import qrcode  # type: ignore
        q = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_M,
                          box_size=1, border=0)
        q.add_data(text)
        q.make(fit=True)
        qr = np.array(q.get_matrix(), dtype=np.uint8)
    except Exception:
        try:
            enc = cv2.QRCodeEncoder_create()
            raw = enc.encode(text)
            if raw is None:
                raise RuntimeError("cv2 QR encoder returned None")
            # OpenCV returns a code image; normalize whichever polarity it uses.
            raw = np.asarray(raw, dtype=np.uint8)
            if raw.ndim == 3:
                raw = raw[:, :, 0]
            dark = raw < 128 if raw.mean() > 127 else raw > 0
            qr = dark.astype(np.uint8)
        except Exception as exc:
            raise RuntimeError(f"no QR encoder available: {exc}") from exc

    modules = len(qr)
    # four white modules of quiet zone around the symbol
    padded = np.zeros((modules + QR_QUIET_MODULES * 2,) * 2, dtype=np.uint8)
    padded[QR_QUIET_MODULES:QR_QUIET_MODULES + modules,
           QR_QUIET_MODULES:QR_QUIET_MODULES + modules] = qr
    img = Image.new("L", (padded.shape[1], padded.shape[0]), 255)
    for r in range(padded.shape[0]):
        for c in range(padded.shape[1]):
            if padded[r, c]:
                img.putpixel((c, r), 0)
    return img.convert("RGB").resize((px(size_pt), px(size_pt)), Image.Resampling.NEAREST)


QR_IMG = make_qr(QR_PAYLOAD, QR_SIZE)


def line(draw: ImageDraw.ImageDraw, x1, y1, x2, y2, fill=INK, width=1):
    draw.line([(px(x1), px(y1)), (px(x2), px(y2))], fill=fill, width=width)


def dashed(draw: ImageDraw.ImageDraw, y, x0, x1, fill=(150, 156, 168)):
    x = x0
    while x < x1:
        line(draw, x, y, min(x + 5, x1), y, fill, 1)
        x += 9


def draw_half(page: Image.Image, draw: ImageDraw.ImageDraw, offset_y: float, label: str):
    """Draw one half-sheet at a page-space y offset (0 or 468)."""
    def y(v):
        return offset_y + v

    # 10 mm corner markers; page is white, so the quiet zone is the absence of
    # any content around them.
    for cx, cy in MARKER_CENTERS:
        draw.rectangle(
            [px(cx - MARKER / 2), px(y(cy - MARKER / 2)),
             px(cx + MARKER / 2), px(y(cy + MARKER / 2))],
            fill=INK,
        )

    # Header table
    hx, hy, hw = CONTENT[0], CONTENT[1], CONTENT_W
    row_h = 18
    label_w = 36
    draw.rectangle([px(hx), px(y(hy)), px(hx + label_w), px(y(hy + row_h))], fill=LIGHT, outline=INK, width=1)
    draw.text((px(hx + 4), px(y(hy + 5))), "Name", font=FONT_65, fill=INK)
    draw.rectangle([px(hx + label_w), px(y(hy)), px(hx + hw), px(y(hy + row_h))], outline=INK, width=1)
    draw.text((px(hx + label_w + 5), px(y(hy + 5))), label, font=FONT_65, fill=INK)
    y2 = hy + row_h
    draw.rectangle([px(hx), px(y(y2)), px(hx + label_w), px(y(y2 + row_h))], fill=LIGHT, outline=INK, width=1)
    draw.text((px(hx + 4), px(y(y2 + 5))), "Class", font=FONT_65, fill=INK)
    draw.rectangle([px(hx + label_w), px(y(y2)), px(hx + 170), px(y(y2 + row_h))], outline=INK, width=1)
    draw.text((px(hx + label_w + 5), px(y(y2 + 5))), "English 8-B - Molave", font=FONT_65, fill=INK)
    draw.rectangle([px(hx + 170), px(y(y2)), px(hx + 206), px(y(y2 + row_h))], fill=LIGHT, outline=INK, width=1)
    draw.text((px(hx + 174), px(y(y2 + 5))), "Quiz", font=FONT_65, fill=INK)
    draw.rectangle([px(hx + 206), px(y(y2)), px(hx + hw), px(y(y2 + row_h))], outline=INK, width=1)
    draw.text((px(hx + 211), px(y(y2 + 5))), "English - Verb Tenses", font=FONT_65, fill=INK)

    draw.text((px(hx), px(y(hy + 44))), "Form 50-P v3", font=FONT_7, fill=INK)
    draw.text((px(hx + 58), px(y(hy + 45))), "Write each PIN digit in its box, then shade the same number below.", font=FONT_6, fill=GRAY)

    # PIN write boxes and 0-9 strips
    for d in range(5):
        x0 = PIN_X0 + d * PIN_DX
        draw.rectangle([px(x0), px(y(PIN_WRITE_Y)), px(x0 + 16), px(y(PIN_WRITE_Y + 11))], outline=INK, width=1)
    for r in range(10):
        value = 9 - r
        yy = PIN_ROW_Y0 + r * PIN_PITCH
        for d in range(5):
            cx = PIN_X0 + d * PIN_DX + 8
            draw.ellipse([px(cx - PIN_R), px(y(yy - PIN_R)),
                          px(cx + PIN_R), px(y(yy + PIN_R))], outline=INK, width=1)
        draw.text((px(PIN_X0 - 9), px(y(yy - 5))), str(value), font=FONT_6, fill=GRAY)

    # Distinct column bars above item columns, not small squares.
    for c in range(5):
        x0 = ITEM_X0 + c * ITEM_DX
        draw.rectangle([px(x0 + 6), px(y(ITEM_ROW_Y0 - 12)),
                        px(x0 + 6 + 18), px(y(ITEM_ROW_Y0 - 8))], fill=INK)
        for b, letter in enumerate(LETTERS):
            cx = x0 + LETTER_PAD + b * LETTER_DX + ITEM_R
            draw.text((px(cx - 3), px(y(ITEM_ROW_Y0 - 6))), letter, font=FONT_6, fill=GRAY)

    # 50 items: 5 sub-columns x 10 rows.
    for r in range(10):
        yy = ITEM_ROW_Y0 + r * ITEM_PITCH
        for c in range(5):
            item = c * 10 + r
            x0 = ITEM_X0 + c * ITEM_DX
            draw.text((px(x0 - 2), px(y(yy - 5))), str(item + 1), font=FONT_6, fill=GRAY)
            for b in range(4):
                cx = x0 + LETTER_PAD + b * LETTER_DX + ITEM_R
                draw.ellipse([px(cx - ITEM_R), px(y(yy - ITEM_R)),
                              px(cx + ITEM_R), px(y(yy + ITEM_R))], outline=INK, width=1)
                draw.text((px(cx - 2), px(y(yy - 4))), LETTERS[b], font=FONT_6, fill=GRAY)

    # QR bottom-right; 4-module quiet zone is included in QR_IMG.
    page.paste(QR_IMG, (px(QR_X), px(y(QR_Y))))
    draw.text((px(QR_X), px(y(QR_Y - 8))), "QZ3 v3", font=FONT_6, fill=GRAY)

    # No outer border and no footer text.
    draw.text((px(CONTENT[0]), px(y(CONTENT[3] - 8))), "v3 proof - 10 mm markers, 4 mm quiet zones, 90 pt QR", font=FONT_6, fill=GRAY)


def main():
    page = Image.new("RGB", (px(PAGE_W_PT), px(PAGE_H_PT)), WHITE)
    draw = ImageDraw.Draw(page)

    # Two identical halves per long-bond page.
    draw_half(page, draw, 0, "PIN half-sheet v3")
    draw_half(page, draw, CUT_PT, "PIN half-sheet v3")

    # Single dashed cut line between the halves.
    dashed(draw, CUT_PT, 20, PAGE_W_PT - 20)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    page.save(OUT, "PDF", resolution=DPI)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
