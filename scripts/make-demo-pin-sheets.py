# Generate the bundled demo PIN half-sheets (50 items, QZD2 demo payload).
# Draws the ZipGrade-style layout on canvas from src/app/core/engine/sheet-spec.js
# geometry — the same constants the PDF printer and the OMR scanner read — so
# the PNGs stay scannable forever. Run with the local server up (npm run local).
#
#   py -3.11 scripts/make-demo-pin-sheets.py
#
import base64
import json
import re
import shutil
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT
DATA = REPO / 'src/app/core/engine/demo-data.js'
OUT_DIRS = [REPO / 'public/demo', ROOT / 'site/assets/demo']
BASE = 'http://127.0.0.1:4310'
QRJS = REPO / 'node_modules/qrcode-generator/dist/qrcode.js'
SCALE = 3.5

SHEET = """
const S = %(scale)s
const INK = '#0b0820', GRAY = '#6b7280', DARK = '#1c2438', EDGE = '#374151', CELL = '#d1d5db'
window.renderSheet = async (profile) => {
  const P = window.SPEC.PIN_SHEET, spec = window.SPEC
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(612 * S); canvas.height = Math.round(936 * S)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  const px = v => v * S
  const line = (x0, y0, x1, y1, w, color) => {
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, px(w))
    ctx.beginPath(); ctx.moveTo(px(x0), px(y0)); ctx.lineTo(px(x1), px(y1)); ctx.stroke()
  }
  const rect = (x, y, w, h, st) => {
    if (st.fill) { ctx.fillStyle = st.fill; ctx.fillRect(px(x), px(y), px(w), px(h)) }
    if (st.stroke) { ctx.strokeStyle = st.stroke; ctx.lineWidth = Math.max(1, px(st.lw || 0.7)); ctx.strokeRect(px(x), px(y), px(w), px(h)) }
  }
  const text = (t, x, y, size, color, align = 'left', italic = false, bold = false) => {
    ctx.fillStyle = color
    ctx.font = (italic ? 'italic ' : '') + (bold ? 'bold ' : '') + Math.round(px(size)) + 'px Arial'
    ctx.textAlign = align; ctx.textBaseline = 'alphabetic'
    ctx.fillText(t, px(x), px(y))
  }
  const disk = (cx, cy, r, color) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(px(cx), px(cy), px(r), 0, Math.PI * 2); ctx.fill()
  }
  const ring = (cx, cy, r, color, w = 0.9) => {
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, px(w))
    ctx.beginPath(); ctx.arc(px(cx), px(cy), px(r), 0, Math.PI * 2); ctx.stroke()
  }

  // no cut line is baked into the demo half-sheets: the crop keeps only the
  // half itself, so 2-up print layouts (and the docs images) aren't handed a
  // stray 'cut here' line that duplicates the printer's own cut guide
  const cut = spec.pinCutLineY()

  for (const half of [0, 1]) {
    const f = spec.pinFrameRect(half)
    ctx.fillStyle = INK
    for (const m of spec.pinMarkerRects(half)) ctx.fillRect(px(m.x), px(m.y), px(m.w), px(m.h))

    // boxed header table (ZipGrade-style): gray label cells + write-in blanks
    const hx = f.x + 8, hy = f.y + 8, rowH = P.headerRowH, lw = P.labelW, hw = f.w - 16
    const labelCell = (x, y, t) => { rect(x, y, lw, rowH, { fill: CELL, stroke: EDGE, lw: 0.7 }); text(t, x + 4, y + rowH / 2 + 2.3, 6.5, DARK, 'left', false, true) }
    const blankCell = (x, y, w, printed) => { rect(x, y, w, rowH, { stroke: EDGE, lw: 0.7 }); if (printed) text(printed, x + 4, y + rowH / 2 + 2.6, 7, DARK) }
    const r1 = hy, r2 = hy + rowH
    labelCell(hx, r1, 'Name'); blankCell(hx + lw, r1, 300); labelCell(hx + lw + 300, r1, 'Date'); blankCell(hx + lw + 300 + lw, r1, hw - lw * 3 - 300 - 6)
    labelCell(hx, r2, 'Class'); blankCell(hx + lw, r2, 300, profile.className); labelCell(hx + lw + 300, r2, 'Quiz'); blankCell(hx + lw + 300 + lw, r2, hw - lw * 3 - 300 - 6, profile.quizLabel)
    text('Form 50-P', hx, r2 + rowH + 10, 6.5, DARK, 'left', false, true)
    text('Write each PIN digit in its box, then shade the same number below it.', hx + 40, r2 + rowH + 10, 6, GRAY)

    // filled-in name + date, pen-style
    text(profile.student, hx + lw + 8, r1 + rowH - 5.5, 10, '#24457a', 'left', true)
    text('Nov. 14, 2026', hx + lw + 300 + lw + 8, r1 + rowH - 5.5, 9, '#24457a', 'left', true)

    // PIN write boxes with the digits written in
    for (let d = 0; d < P.pinDigits; d++) {
      const b = spec.pinWriteBox(half, d)
      rect(b.x, b.y, b.w, b.h, { stroke: INK, lw: 0.9 })
      text(profile.pin[d], b.x + b.w / 2, b.y + b.h - 3.2, 8, '#24457a', 'center', true)
    }

    // column headers: 5pt black square + A B C D over every sub-column
    for (let c = 0; c < 5; c++) {
      ctx.fillStyle = INK
      ctx.fillRect(px(spec.pinItemColX(half, c) - 1), px(f.y + P.rowY0 - 20), px(5), px(5))
      for (let b = 0; b < P.letters.length; b++) {
        const bc = spec.pinItemCenter(c * 10, b, half)
        text(P.letters[b], bc.x, f.y + P.rowY0 - 12 + P.letterCap / 2, 6.5, DARK, 'center', false, true)
      }
    }

    // 10 rows: PIN digit strips (9 top … 0 bottom) + item bubbles
    for (let r = 0; r < P.rows; r++) {
      const value = 9 - r
      for (let d = 0; d < P.pinDigits; d++) {
        const c = spec.pinDigitCenter(d, value, half)
        ring(c.x, c.y, P.pinR, INK)
        if (d === 0) text(String(value), c.x - P.pinR - 3, c.y + 1.6, 4.8, GRAY, 'right')
      }
      for (let c = 0; c < 5; c++) {
        const item = c * 10 + r
        text(String(item + 1), spec.pinRowLabelRight(half, c), spec.pinItemRowY(half, r) + 2, 6, GRAY, 'right')
        for (let b = 0; b < P.letters.length; b++) {
          const bc = spec.pinItemCenter(item, b, half)
          ring(bc.x, bc.y, P.circleR, INK)
          text(P.letters[b], bc.x, bc.y + P.letterCap / 2, 6, GRAY, 'center')
        }
      }
    }

    // shaded answers ('double' = two letters shaded -> MULTI flag)
    for (let i = 0; i < 50; i++) {
      const a = profile.answers[i]
      if (a === 'double') {
        const c1 = spec.pinItemCenter(i, profile.key[i], half)
        const c2 = spec.pinItemCenter(i, (profile.key[i] + 1) %% 4, half)
        disk(c1.x, c1.y, P.circleR * 0.9, INK); disk(c2.x, c2.y, P.circleR * 0.9, INK)
      } else if (a != null && a >= 0) {
        const c = spec.pinItemCenter(i, a, half)
        disk(c.x, c.y, P.circleR * 0.9, INK)
      }
    }
    // shaded PIN strips
    for (let d = 0; d < 5; d++) {
      const c = spec.pinDigitCenter(d, Number(profile.pin[d]), half)
      disk(c.x, c.y, P.pinR * 0.85, INK)
    }

    // QR (stable QZD2 demo payload) + footer
    const qr = spec.pinQrRect(half)
    const q = window.qrcode(0, 'M'); q.addData(profile.payload); q.make()
    const cells = q.getModuleCount(), cell = qr.size / cells
    ctx.fillStyle = '#fff'; ctx.fillRect(px(qr.x) - px(4), px(qr.y) - px(4), px(qr.size) + px(8), px(qr.size) + px(8))
    ctx.fillStyle = '#000'
    const wpx = Math.ceil(px(cell))
    for (let rr = 0; rr < cells; rr++) for (let cc = 0; cc < cells; cc++) {
      if (q.isDark(rr, cc)) ctx.fillRect(Math.round(px(qr.x + cc * cell)), Math.round(px(qr.y + rr * cell)), wpx, wpx)
    }
  }

  // crop to the half this student "cut"
  const cy0 = profile.half === 0 ? 0 : Math.round(px(cut - 6))
  const ch = profile.half === 0 ? Math.round(px(cut + 6)) : canvas.height - cy0
  const out = document.createElement('canvas')
  out.width = canvas.width; out.height = ch
  out.getContext('2d').drawImage(canvas, 0, cy0, canvas.width, ch, 0, 0, canvas.width, ch)
  return out.toDataURL('image/png')
}
""" % {'scale': SCALE}

# ── the four demo sheets ──────────────────────────────────────────────────────
# answers[i]: 0-3 shaded letter, -1 blank, 'double' double-shaded (MULTI)
PROFILES = [
    dict(file='pin-sheet-ivan.png', student='Ivan Ramos', pin='48213', half=0,
         wrong=[],
         blank=[], double=[]),
    dict(file='pin-sheet-joy.png', student='Joy Aquino', pin='73590', half=0,
         wrong=[12, 36],
         blank=[], double=[]),
    dict(file='pin-sheet-kat.png', student='Kat Bautista', pin='26481', half=1,
         wrong=[], blank=[],
         double=[23]),
    dict(file='pin-sheet-leo.png', student='Leo Mendoza', pin='91537', half=1,
         wrong=[14, 21, 45], blank=[7, 28], double=[40]),
]
CLASS_NAME = 'English 8-B — Molave'
QUIZ_LABEL = 'English — Verb Tenses'

# ── read the answer key straight out of demo-data.js ─────────────────────────
snap = json.loads(DATA.read_text(encoding='utf8').split('export const DEMO_SNAPSHOT = ', 1)[1])
key = [it['answerIndex'] for it in next(q for q in snap['quizzes'] if q['id'] == 'demo-quiz-2')['items']]
assert len(key) == 50, len(key)

for prof in PROFILES:
    answers = list(key)
    # vary the wrong letters so the sheets don't look machine-stamped
    for n, i in enumerate(prof['wrong']):
        answers[i] = (key[i] + (1 + n % 3)) % 4
    for i in prof['blank']:
        answers[i] = -1
    for i in prof['double']:
        answers[i] = 'double'  # two shaded letters -> scanner MULTI flag -> wrong
    prof['answers'] = answers
    prof['key'] = key
    prof['className'] = CLASS_NAME
    prof['quizLabel'] = QUIZ_LABEL
    prof['payload'] = 'QZD2:demo-cls-eng:demo-quiz-2'
    correct = sum(1 for i in range(50) if answers[i] == key[i])
    # scanned reality: a double-shaded item reads as MULTI and scores wrong
    scanned = sum(1 for i in range(50) if isinstance(answers[i], int) and answers[i] == key[i])
    flags = []
    if prof['blank']: flags.append('BLANK')
    if prof['double']: flags.append('MULTI')
    prof['expected'] = {'correct': scanned, 'total': 50,
                        'percent': round(scanned / 50 * 100), 'flags': flags}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 800, 'height': 600}, bypass_csp=True)
    page.goto(BASE + '/')
    page.add_script_tag(path=str(QRJS))
    # the server SPA-falls back unknown paths, so /src/*.js can't be imported —
    # inject the module source itself (sheet-spec has no imports) + a window hook
    spec_src = (REPO / 'src/app/core/engine/sheet-spec.js').read_text(encoding='utf8')
    spec_src += """
window.SPEC = { PIN_SHEET, PIN_ITEMS, pinFrameRect, pinMarkerRects, pinItemCenter,
  pinItemColX, pinItemRowY, pinRowLabelRight, pinWriteBox, pinDigitCenter,
  pinQrRect, pinCutLineY, demoPinSheetQrPayload }
"""
    page.add_script_tag(content=spec_src, type='module')
    page.wait_for_function('window.SPEC && window.SPEC.PIN_SHEET && window.qrcode')
    page.add_script_tag(content=SHEET.replace('%%', '%'))
    for prof in PROFILES:
        dataurl = page.evaluate('p => window.renderSheet(p)', prof)
        png = base64.b64decode(dataurl.split(',', 1)[1])
        for out_dir in OUT_DIRS:
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / prof['file']).write_bytes(png)
        exp = prof['expected']
        print(prof['file'], prof['student'], f"{exp['correct']}/50 {exp['percent']}%", '+'.join(exp['flags']) or 'no flags', f'{len(png)} bytes')
    browser.close()

# retire the old letter-geometry demo sheets
for out_dir in OUT_DIRS:
    for old in out_dir.glob('answered-sheet*.png'):
        old.unlink()
        print('removed', old)
print('done')
