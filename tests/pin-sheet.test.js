import { describe, it, expect } from 'vitest'
import {
  PIN_SHEET, PIN_ITEMS, pinFrameRect, pinMarkerRects, pinMarkerCenters, pinItemCenter,
  pinDigitCenter, pinWriteBox, pinQrRect, pinSheetQrPayload, parseSheetQr, pinCutLineY,
} from '../src/app/core/engine/sheet-spec.js'
import { readPinSheet, scoreSheet } from '../src/app/core/engine/omr.js'
import { renderPinHalf, OUT_W, OUT_H } from './helpers/pin-render.js'

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

describe('PIN half-sheet geometry', () => {
  it('places both frames inside the long page around the cut line', () => {
    const top = pinFrameRect(0)
    const bottom = pinFrameRect(1)
    expect(top.y).toBeGreaterThan(0)
    expect(top.y + top.h).toBeLessThan(pinCutLineY())
    expect(bottom.y).toBeGreaterThan(pinCutLineY())
    expect(bottom.y + bottom.h).toBeLessThan(PIN_SHEET.H)
    expect(pinCutLineY()).toBe(PIN_SHEET.H / 2)
  })

  it('keeps every marker outside its frame but inside the page', () => {
    for (const half of [0, 1]) {
      const f = pinFrameRect(half)
      for (const m of pinMarkerRects(half)) {
        expect(m.x).toBeGreaterThanOrEqual(0)
        expect(m.x + m.w).toBeLessThanOrEqual(PIN_SHEET.W)
        expect(m.y).toBeGreaterThanOrEqual(0)
        expect(m.y + m.h).toBeLessThanOrEqual(PIN_SHEET.H)
        // outside the frame horizontally (beside its corners)
        expect(m.x + m.w <= f.x || m.x >= f.x + f.w).toBe(true)
      }
    }
  })

  it('keeps the QR inside the frame and clear of every bubble and digit', () => {
    const f = pinFrameRect(0)
    const q = pinQrRect(0)
    expect(q.x).toBeGreaterThan(f.x)
    expect(q.x + q.size).toBeLessThan(f.x + f.w)
    expect(q.y + q.size).toBeLessThan(f.y + f.h)
    for (let i = 0; i < PIN_ITEMS; i++) {
      for (let b = 0; b < 4; b++) {
        // ≥ half the QR size of clear space: far beyond the ~6.4pt quiet zone
        expect(dist(pinItemCenter(i, b), { x: q.x, y: q.y })).toBeGreaterThan(q.size * 0.5)
        expect(dist(pinItemCenter(i, b), { x: q.x + q.size, y: q.y + q.size })).toBeGreaterThan(q.size * 0.5)
      }
    }
    for (let d = 0; d < 5; d++) {
      for (let v = 0; v < 10; v++) {
        expect(dist(pinDigitCenter(d, v), { x: q.x, y: q.y })).toBeGreaterThan(q.size * 0.8)
      }
    }
  })

  it('lays the 50 items out as five sub-columns of ten (ZipGrade numbering)', () => {
    for (let c = 0; c < 5; c++) {
      for (let r = 0; r < 10; r++) {
        const item = c * 10 + r
        // the row of a sub-column is its own — no wrapping across columns
        const a = pinItemCenter(item, 0)
        if (r < 9) {
          const b = pinItemCenter(item + 1, 0)
          expect(dist(a, b)).toBeGreaterThan(PIN_SHEET.circleR * 2)
        }
        // every bubble inside the frame
        for (let b2 = 0; b2 < 4; b2++) {
          const p = pinItemCenter(item, b2)
          const f = pinFrameRect(0)
          expect(p.x).toBeGreaterThan(f.x + 4)
          expect(p.x).toBeLessThan(f.x + f.w - 4)
          expect(p.y).toBeGreaterThan(f.y + 4)
          expect(p.y).toBeLessThan(f.y + f.h - 4)
        }
      }
    }
    // adjacent sub-columns never touch
    for (let c = 0; c < 4; c++) {
      const d = dist(pinItemCenter(c * 10 + 3, 3), pinItemCenter((c + 1) * 10, 0))
      expect(d).toBeGreaterThan(PIN_SHEET.circleR * 2)
    }
  })

  it('keeps the digit strips below the write boxes and clear of the item bubbles', () => {
    for (let d = 0; d < 5; d++) {
      const box = pinWriteBox(0, d)
      const first = pinDigitCenter(d, 9) // value 9 is the top row
      const last = pinDigitCenter(d, 0) // value 0 is the bottom row
      expect(first.y).toBeGreaterThan(box.y + box.h)
      // the digit strips share rows with the item grid, but sit far to the left
      const itemA = pinItemCenter(0, 0)
      expect(dist(last, itemA)).toBeGreaterThan(PIN_SHEET.pinR + PIN_SHEET.circleR + 10)
    }
  })

  it('keeps both item columns inside the frame', () => {
    const f = pinFrameRect(0)
    for (let i = 0; i < PIN_ITEMS; i++) {
      for (let b = 0; b < 4; b++) {
        const c = pinItemCenter(i, b)
        expect(c.x).toBeGreaterThan(f.x + 4)
        expect(c.x).toBeLessThan(f.x + f.w - 4)
        expect(c.y).toBeGreaterThan(f.y + 4)
        expect(c.y).toBeLessThan(f.y + f.h - 4)
      }
    }
  })
})

describe('QZ3 payload', () => {
  it('round-trips through parseSheetQr as a pin sheet', () => {
    const parsed = parseSheetQr(pinSheetQrPayload('quiz-123'))
    expect(parsed).toEqual({ quizId: 'quiz-123', studentId: null, studentName: null, quizName: null, pinSheet: true })
  })

  it('rejects malformed QZ3 codes', () => {
    expect(parseSheetQr('QZ3:')).toBe(null)
    expect(parseSheetQr('QZ3')).toBe(null)
    expect(parseSheetQr('not a sheet')).toBe(null)
  })
})

describe('readPinSheet on synthetic photos', () => {
  const key = Array.from({ length: 50 }, (_, i) => i % 4)

  it('reads 50 answers and the shaded PIN on a clean sheet', () => {
    const answers = Array.from({ length: 50 }, (_, i) => key[i])
    const img = renderPinHalf({ answers, pin: '04213' })
    const res = readPinSheet({ data: img, width: OUT_W, height: OUT_H })
    expect(res.ok).toBe(true)
    expect(res.pin).toBe('04213')
    expect(res.pinFlags.every(f => f === 'ok')).toBe(true)
    for (let i = 0; i < 50; i++) expect(res.answers[i]).toBe(key[i])
    const scored = scoreSheet(res.answers, key.map(k => ({ answerIndex: k })))
    expect(scored.correct).toBe(50)
    expect(scored.percent).toBe(100)
  })

  it('still reads a rotated, noisy photo (top half)', () => {
    const answers = Array.from({ length: 50 }, (_, i) => (i * 3) % 4)
    const img = renderPinHalf({ answers, pin: '90715', rotateDeg: 2.5, noise: 0.02 })
    const res = readPinSheet({ data: img, width: OUT_W, height: OUT_H })
    expect(res.ok).toBe(true)
    expect(res.pin).toBe('90715')
    let right = 0
    for (let i = 0; i < 50; i++) if (res.answers[i] === answers[i]) right++
    expect(right).toBeGreaterThanOrEqual(48)
  })

  it('reads the bottom half through the same top-half geometry', () => {
    const answers = Array.from({ length: 50 }, (_, i) => (i + 1) % 4)
    const img = renderPinHalf({ half: 1, answers, pin: '55555' })
    const res = readPinSheet({ data: img, width: OUT_W, height: OUT_H })
    expect(res.ok).toBe(true)
    expect(res.pin).toBe('55555')
    for (let i = 0; i < 50; i++) expect(res.answers[i]).toBe(answers[i])
  })

  it('reports an unreadable PIN instead of guessing', () => {
    const img = renderPinHalf({ answers: key, pin: '' }) // nothing shaded
    const res = readPinSheet({ data: img, width: OUT_W, height: OUT_H })
    expect(res.ok).toBe(true)
    expect(res.pin).toBe(null)
    expect(res.pinDigits.every(v => v === -1)).toBe(true)
    expect(res.pinFlags.every(f => f === 'blank')).toBe(true)
  })

  it('flags a double-shaded digit as multi', () => {
    const img = renderPinHalf({ answers: key, pin: '', extra: [[0, 3], [0, 7]] })
    const res = readPinSheet({ data: img, width: OUT_W, height: OUT_H })
    expect(res.ok).toBe(true)
    expect(res.pin).toBe(null)
    expect(res.pinFlags[0]).toBe('multi')
  })

  // A half-sheet framed at ~48% of a 720p camera frame (a laptop screen across
  // the desk): the 7pt markers sit under the old 0.8%-of-frame side floor and
  // the pre-2.4.2 46pt QR fell under jsQR's module floor. Both must read now.
  it('scans a far-framed sheet — markers, QR and PIN all read at distance', () => {
    const answers = Array.from({ length: 50 }, (_, i) => key[i])
    // render at 2x then box-average down to 1x — a cheap stand-in for the
    // optical smoothing a real camera frame has (hard-edged raw pixels at
    // 2.5px/module defeat jsQR in a way a camera never sees)
    const S = 2, PAD = 8
    const img = renderPinHalf({ answers, pin: '48213', qrPayload: pinSheetQrPayload('quiz-x'), scale: S, pad: PAD })
    const w = Math.round(612 * S + PAD * 2), h = Math.round(468 * S + PAD * 2)
    const dw = Math.round(w / 2), dh = Math.round(h / 2)
    const small = new Uint8ClampedArray(dw * dh * 4)
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0
      for (const [dy, dx] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
        const si = ((y * 2 + dy) * w + (x * 2 + dx)) * 4
        r += img[si]; g += img[si + 1]; b += img[si + 2]
      }
      const di = (y * dw + x) * 4
      small[di] = r / 4; small[di + 1] = g / 4; small[di + 2] = b / 4; small[di + 3] = 255
    }
    const VW = 1280, VH = 720
    const frame = new Uint8ClampedArray(VW * VH * 4)
    for (let i = 0; i < VW * VH; i++) { frame[i * 4] = frame[i * 4 + 1] = frame[i * 4 + 2] = 185; frame[i * 4 + 3] = 255 }
    const x0 = Math.round((VW - dw) / 2), y0 = Math.round((VH - dh) / 2)
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      const si = (y * dw + x) * 4, di = ((y0 + y) * VW + (x0 + x)) * 4
      frame[di] = small[si]; frame[di + 1] = small[si + 1]; frame[di + 2] = small[si + 2]
    }
    // the marker floor is the gate being tested: sheet ~48% -> marker ~7px,
    // under the old 10.2px (0.8%) floor, over the current 0.4% one
    expect(PIN_SHEET.marker).toBeLessThan(VW * 0.008)
    expect(PIN_SHEET.marker).toBeGreaterThanOrEqual(VW * 0.004)
    const res = readPinSheet({ data: frame, width: VW, height: VH })
    expect(res.ok).toBe(true)
    expect(res.qr).toBe('QZ3:quiz-x')
    expect(res.pin).toBe('48213')
    for (let i = 0; i < 50; i++) expect(res.answers[i]).toBe(key[i])
  })
})
