import { describe, it, expect, vi } from 'vitest'
import { readSheet, scoreSheet, FLAG, toGray, threshold, homography, applyH } from '../src/app/core/engine/omr.js'
import { SHEET, frameRect, markerRects, markerCenters, bubbleCenter, bubbleSheetLayout, idDigitCenter } from '../src/app/core/engine/sheet-spec.js'
import { applyScreenDefects } from '../src/app/core/engine/sheet-synth.js'

// These render millions of pixels and then run the whole CV pipeline, so a
// single case can exceed the 5s default once the workers compete for CPU.
vi.setConfig({ testTimeout: 30000 })

// Synthetic sheet renderer: draws the exact sheet-spec geometry into a raw
// RGBA pixel buffer — the same thing the PDF printer puts on paper, so the
// round trip (print → shade → scan → score) is exercised end to end without
// a camera. rect/disk/ring take PDF points and scale internally. Supports
// rotation, scale, and imperfect (dithered "pencil") shading.
function renderSheet({ count = 10, answers = [], marks = {}, scale = 2.2, rotateDeg = 0, noise = 0 } = {}) {
  const W = Math.round(SHEET.W * scale), H = Math.round(SHEET.H * scale)
  const img = new Uint8ClampedArray(W * H * 4).fill(255)
  const setPx = (x, y, v) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    const i = (y * W + x) * 4
    img[i] = img[i + 1] = img[i + 2] = v
  }
  const rect = (x0, y0, w, h, v) => { for (let y = Math.round(y0 * scale); y < (y0 + h) * scale; y++) for (let x = Math.round(x0 * scale); x < (x0 + w) * scale; x++) setPx(x, y, v) }
  const disk = (cx, cy, r, v, dither = false) => {
    for (let y = Math.floor((cy - r) * scale); y <= (cy + r) * scale; y++) {
      for (let x = Math.floor((cx - r) * scale); x <= (cx + r) * scale; x++) {
        if (Math.hypot(x / scale - cx, y / scale - cy) > r) continue
        if (dither && (x + y) % 2 === 0) continue // ~50% coverage: pencil texture
        setPx(x, y, v)
      }
    }
  }
  const ring = (cx, cy, r, v) => {
    for (let a = 0; a < 360; a += 1.5) {
      const x = (cx + r * Math.cos(a * Math.PI / 180)) * scale
      const y = (cy + r * Math.sin(a * Math.PI / 180)) * scale
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) setPx(Math.round(x + dx), Math.round(y + dy), v)
    }
  }

  // frame + corner markers (rect takes unscaled PDF points)
  const f = frameRect(count)
  const s = 1.6
  rect(f.x, f.y - s / 2, f.w, s, 0)
  rect(f.x, f.y + f.h - s / 2, f.w, s, 0)
  rect(f.x - s / 2, f.y, s, f.h, 0)
  rect(f.x + f.w - s / 2, f.y, s, f.h, 0)
  const centers = markerCenters(count)
  for (const m of markerRects(count)) rect(m.x, m.y, SHEET.marker, SHEET.marker, 0)

  // bubbles: outline every row, print the A–D label inside, fill the shaded ones.
  // The label patch matters — real sheets print a letter at the exact point the
  // scanner samples, so every bubble carries the same extra ink floor.
  for (let i = 0; i < count; i++) {
    for (let b = 0; b < 4; b++) {
      const c = bubbleCenter(count, i, b)
      ring(c.x, c.y, SHEET.circleR, 0)
      disk(c.x, c.y, SHEET.letterR, 0)
      if (answers[i] === b) disk(c.x, c.y, SHEET.circleR * 0.8, 0, !!marks.soft)
    }
  }

  // optional extra marks (double shading)
  if (marks.multi) for (const [i, b] of marks.multi) {
    const c = bubbleCenter(count, i, b)
    disk(c.x, c.y, SHEET.circleR * 0.8, 0, !!marks.soft)
  }

  // rotate about the page center (nearest neighbor)
  const rad = rotateDeg * Math.PI / 180
  const out = new Uint8ClampedArray(W * H * 4).fill(255)
  if (rotateDeg) {
    const cx = W / 2, cy = H / 2
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x - cx, dy = y - cy
        const sx = Math.round(cx + dx * Math.cos(-rad) - dy * Math.sin(-rad))
        const sy = Math.round(cy + dx * Math.sin(-rad) + dy * Math.cos(-rad))
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue
        const si = (sy * W + sx) * 4, di = (y * W + x) * 4
        out[di] = img[si]; out[di + 1] = img[si + 1]; out[di + 2] = img[si + 2]; out[di + 3] = 255
      }
    }
  }
  const data = rotateDeg ? out : img
  if (noise) {
    for (let i = 0; i < data.length; i += 4) {
      const n = (Math.random() - 0.5) * noise
      data[i] = Math.max(0, Math.min(255, data[i] + n)); data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n)); data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n))
    }
  }
  return { data, width: W, height: H }
}

describe('homography', () => {
  it('maps points through a scaled translate', () => {
    const H = homography([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }], [{ x: 10, y: 20 }, { x: 210, y: 20 }, { x: 210, y: 120 }, { x: 10, y: 120 }])
    const p = applyH(H, 50, 25)
    expect(p.x).toBeCloseTo(110, 5)
    expect(p.y).toBeCloseTo(70, 5)
  })
})

describe('readSheet — synthetic sheets', () => {
  it('reads a clean straight sheet correctly', () => {
    const answers = [0, 2, 1, 3, 0, 2, 1, 3, 0, 2]
    const img = renderSheet({ count: 10, answers })
    const res = readSheet(img, 10)
    expect(res.ok).toBe(true)
    expect(res.answers).toEqual(answers)
    expect(res.flags.every(f => f === FLAG.OK)).toBe(true)
  })

  it('survives rotation and noise', () => {
    const answers = [1, 3, 2, 0, 1, 3, 2, 0, 1, 3]
    const img = renderSheet({ count: 10, answers, rotateDeg: 3.5, noise: 14 })
    const res = readSheet(img, 10)
    expect(res.ok).toBe(true)
    expect(res.answers).toEqual(answers)
  })

  // A sheet shown on a laptop screen and photographed: the screen's black is
  // emissive (ink arrives as grey), the sensor adds moiré waves the size of
  // the printed features, and the panel's refresh rolls bands across the shot.
  // This is the "works on paper, fails on the screen" case.
  it('reads a sheet photographed off a laptop screen (glow, moiré, refresh bands)', () => {
    const answers = [1, 3, 2, 0, 1, 3, 2, 0, 1, 3]
    const img = renderSheet({ count: 10, answers, rotateDeg: 2, noise: 6 })
    applyScreenDefects(img, { seed: 7 })
    const res = readSheet(img, 10)
    expect(res.ok, `reason: ${res?.reason}`).toBe(true)
    expect(res.answers).toEqual(answers)
  })

  it('handles a two-column 50-item sheet', () => {
    const answers = Array.from({ length: 50 }, (_, i) => i % 4)
    const img = renderSheet({ count: 50, answers, scale: 1.6 })
    const res = readSheet(img, 50)
    expect(res.ok).toBe(true)
    expect(res.answers).toEqual(answers)
  })

  it('flags blank rows', () => {
    const answers = [0, 2, -1, 3, 0, 2, 1, 3, 0, 2] // index 2 unshaded
    const img = renderSheet({ count: 10, answers, marks: { 2: { skip: true } } })
    const res = readSheet(img, 10)
    expect(res.ok).toBe(true)
    expect(res.flags[2]).toBe(FLAG.BLANK)
    expect(res.answers[2]).toBe(-1)
  })

  it('flags double-shaded rows as multi', () => {
    const img = renderSheet({ count: 10, answers: [0, 2, 1, 3, 0, 2, 1, 3, 0, 2], marks: { multi: [[2, 0], [2, 3]] } })
    // rows 0 and 3 got an extra shade → they should read as multi
    const res = readSheet(img, 10)
    expect(res.ok).toBe(true)
    expect([FLAG.MULTI, FLAG.MULTI].some(f => res.flags.includes(f))).toBe(true)
  })

  it('reads faint pencil marks (soft gray fill)', () => {
    const answers = [3, 1, 0, 2, 3, 1, 0, 2, 3, 1]
    const img = renderSheet({ count: 10, answers, marks: { soft: true } })
    const res = readSheet(img, 10)
    expect(res.ok).toBe(true)
    const bad = res.flags.filter(f => f === FLAG.BLANK || f === FLAG.MULTI).length
    expect(bad).toBe(0)
    expect(res.answers).toEqual(answers)
  })


  it('fails gracefully when the markers are missing', () => {
    const img = renderSheet({ count: 10, answers: [0, 1, 2, 3, 0, 1, 2, 3, 0, 1] })
    // erase the top-left marker
    const c = markerCenters(10)[0]
    const scale = 2.2
    for (let y = (c.y - 8) * scale; y < (c.y + 8) * scale; y++) {
      for (let x = (c.x - 8) * scale; x < (c.x + 8) * scale; x++) {
        const i = (Math.round(y) * img.width + Math.round(x)) * 4
        if (img.data[i] !== undefined) { img.data[i] = img.data[i + 1] = img.data[i + 2] = 255 }
      }
    }
    const res = readSheet(img, 10)
    // rejected either at marker detection or at frame verification
    expect(res.ok).toBe(false)
    expect(['markers', 'frame']).toContain(res.reason)
  })
})

describe('scoreSheet', () => {
  it('scores against the quiz key and ignores blanks', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ answerIndex: i % 4 }))
    const answers = items.map((it, i) => (i % 3 === 0 ? it.answerIndex : (it.answerIndex + 1) % 4))
    answers[4] = -1
    const s = scoreSheet(answers, items)
    expect(s.correct).toBe(4)
    expect(s.total).toBe(10)
    expect(s.percent).toBe(40)
    expect(s.attempted).toBe(9)
  })
})
