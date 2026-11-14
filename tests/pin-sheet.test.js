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
    expect(parsed).toEqual({ quizId: 'quiz-123', studentId: null, studentName: null, pinSheet: true })
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
})
