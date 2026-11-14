// Shared synthetic renderer for PIN half-sheets (node-only, no canvas).
// Draws the exact sheet-spec PIN geometry into raw RGBA pixels so tests can
// push a printed half-sheet through readPinSheet without a camera.
import qrModule from 'qrcode-generator'
import {
  PIN_SHEET, PIN_ITEMS, pinFrameRect, pinMarkerRects, pinItemCenter, pinWriteBox, pinDigitCenter, pinQrRect,
} from '../../src/app/core/engine/sheet-spec.js'

// render resolution: pixels per PDF point (a 1600px-wide phone grab ≈ 2.6)
export const SCALE = 3
export const OUT_W = PIN_SHEET.W * SCALE + 120
export const OUT_H = (PIN_SHEET.H / 2) * SCALE + 120

export function renderPinHalf({ half = 0, answers = [], pin = '', extra = [], qrPayload = '', rotateDeg = 0, noise = 0, scale = SCALE, pad = 60 } = {}) {
  // a real photo shows desk around the paper — pad so rotated corners don't clip
  const S = scale
  const W = PIN_SHEET.W * S + pad * 2
  const H = (PIN_SHEET.H / 2) * S + pad * 2
  const img = new Uint8ClampedArray(W * H * 4).fill(255)
  const offY = (half === 1 ? -(PIN_SHEET.H / 2) * S : 0) + pad
  const offX = pad
  const ink = (x, y, v) => {
    x = Math.round(x); y = Math.round(y)
    if (x < 0 || y < 0 || x >= W || y >= H) return
    const i = (y * W + x) * 4
    img[i] = img[i + 1] = img[i + 2] = v; img[i + 3] = 255
  }
  const disk = (cx, cy, r, v) => {
    const R = r * S
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy <= R * R) ink(cx * S + dx + offX, cy * S + dy + offY, v)
    }
  }
  const ring = (cx, cy, r, v) => {
    const R = r * S
    const steps = Math.max(24, Math.round(R * 6))
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2
      ink(cx * S + Math.cos(a) * R + offX, cy * S + Math.sin(a) * R + offY, v)
    }
  }
  const hline = (x0, x1, y, v, thick = 1) => {
    const R = Math.max(1, Math.round(thick * S / 2))
    for (let x = Math.round(x0 * S); x <= Math.round(x1 * S); x++) {
      for (let dy = -R; dy <= R; dy++) ink(x + offX, y * S + dy + offY, v)
    }
  }
  const vline = (x, y0, y1, v, thick = 1) => {
    const R = Math.max(1, Math.round(thick * S / 2))
    for (let y = Math.round(y0 * S); y <= Math.round(y1 * S); y++) {
      for (let dx = -R; dx <= R; dx++) ink(x * S + dx + offX, y + offY, v)
    }
  }
  const boxOutline = (x, y, w, h, v) => {
    hline(x, x + w, y, v, 0.3); hline(x, x + w, y + h, v, 0.3)
    vline(x, y, y + h, v, 0.3); vline(x + w, y, y + h, v, 0.3)
  }

  const f = pinFrameRect(half)
  boxOutline(f.x, f.y, f.w, f.h, 0)
  for (const m of pinMarkerRects(half)) {
    // solid square, filled pixel-for-pixel — the blob filter needs fill ≥ 0.85
    for (let yy = Math.round(m.y * S); yy < Math.round((m.y + m.h) * S); yy++) {
      for (let xx = Math.round(m.x * S); xx < Math.round((m.x + m.h) * S); xx++) ink(xx + offX, yy + offY, 0)
    }
  }

  // item bubbles: ring + printed letter patch inside, plus the shaded answer
  for (let i = 0; i < PIN_ITEMS; i++) {
    for (let b = 0; b < 4; b++) {
      const c = pinItemCenter(i, b, half)
      ring(c.x, c.y, PIN_SHEET.circleR, 0)
      disk(c.x, c.y, PIN_SHEET.letterR, 0)
    }
    if (answers[i] != null && answers[i] >= 0) {
      const c = pinItemCenter(i, answers[i], half)
      disk(c.x, c.y, PIN_SHEET.circleR * 0.9, 0)
    }
    // answers[i] may be an array of two letters -> double-shaded (MULTI)
    if (Array.isArray(answers[i])) {
      for (const b of answers[i]) {
        const c = pinItemCenter(i, b, half)
        disk(c.x, c.y, PIN_SHEET.circleR * 0.9, 0)
      }
    }
  }

  // the QR: a real scannable QZ3 code, drawn exactly like the printer draws it
  if (qrPayload) {
    const factory = qrModule.default || qrModule
    const qr = factory(0, 'M')
    qr.addData(qrPayload); qr.make()
    const cells = qr.getModuleCount()
    const rect = pinQrRect(half)
    const cell = rect.size / cells
    const w = Math.ceil(cell * S) + 1, h = Math.ceil(cell * S) + 1
    for (let r = 0; r < cells; r++) for (let c = 0; c < cells; c++) {
      if (qr.isDark(r, c)) {
        const x0 = Math.round((rect.x + c * cell) * S) + offX
        const y0 = Math.round((rect.y + r * cell) * S) + offY
        for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) ink(x0 + dx, y0 + dy, 0)
      }
    }
  }
  // PIN write boxes + 0–9 digit bubbles, with the shaded digits for `pin`
  for (let d = 0; d < PIN_SHEET.pinDigits; d++) {
    const box = pinWriteBox(half, d)
    boxOutline(box.x, box.y, box.w, box.h, 0)
    const digit = Number(pin[d] ?? NaN)
    for (let v = 0; v < PIN_SHEET.pinRows; v++) {
      const c = pinDigitCenter(d, v, half)
      ring(c.x, c.y, PIN_SHEET.pinR, 0)
      if (v === digit) disk(c.x, c.y, PIN_SHEET.pinR * 0.85, 0)
      if (extra.some(([ed, ev]) => ed === d && ev === v)) disk(c.x, c.y, PIN_SHEET.pinR * 0.85, 0)
    }
  }

  let out = img
  if (rotateDeg) {
    const rad = (rotateDeg * Math.PI) / 180
    const rotated = new Uint8ClampedArray(out.length)
    const cx = W / 2, cy = H / 2
    const cos = Math.cos(-rad), sin = Math.sin(-rad)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = x - cx, dy = y - cy
      const sx = Math.round(cos * dx - sin * dy + cx)
      const sy = Math.round(sin * dx + cos * dy + cy)
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue
      const d = (y * W + x) * 4, s = (sy * W + sx) * 4
      rotated[d] = out[s]; rotated[d + 1] = out[s + 1]; rotated[d + 2] = out[s + 2]; rotated[d + 3] = out[s + 3]
    }
    out = rotated
  }
  if (noise) {
    let a = 99 >>> 0
    const rnd = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
    for (let i = 0; i < out.length; i += 4) {
      if (rnd() < noise) { const v = rnd() < 0.5 ? 0 : 255; out[i] = out[i + 1] = out[i + 2] = v }
    }
  }
  return out
}
