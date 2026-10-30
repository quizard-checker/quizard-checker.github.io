// Offline bubble-sheet reader (PLAN.md Phase 3). Pure functions over raw
// pixel data — no canvas, no network, no heavy vision library. The scanner
// samples the same sheet-spec.js geometry the printer drew, so a photo only
// needs the four black corner markers to align everything.
//
// Pipeline: grayscale → Bradley adaptive threshold → connected components to
// find the corner markers → homography from marker centroids (PDF space →
// image pixels) → darkness fraction sampled inside each known bubble circle
// → answer per row with ambiguity flags (blank / multi / faint).

import jsQR from 'jsqr'
import { SHEET, frameRect, markerCenters, bubbleCenter } from './sheet-spec.js'

export function toGray(data, width, height) {
  const gray = new Float32Array(width * height)
  for (let i = 0, p = 0; p < gray.length; i += 4, p++) {
    gray[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255
  }
  return gray
}

// Bradley/Wellner: pixel is dark when below (1 - t) × mean of its window.
export function threshold(gray, width, height, { t = 0.2, winFrac = 0.045 } = {}) {
  const win = Math.max(15, Math.round(Math.min(width, height) * winFrac)) | 1
  const integral = new Float64Array((width + 1) * (height + 1))
  for (let y = 0; y < height; y++) {
    let rowSum = 0
    for (let x = 0; x < width; x++) {
      rowSum += gray[y * width + x]
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1] + rowSum
    }
  }
  const r = win >> 1
  const out = new Uint8Array(width * height) // 1 = ink (dark)
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(height - 1, y + r)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(width - 1, x + r)
      const area = (x1 - x0 + 1) * (y1 - y0 + 1)
      const sum = integral[(y1 + 1) * (width + 1) + x1 + 1] - integral[y0 * (width + 1) + x1 + 1]
        - integral[(y1 + 1) * (width + 1) + x0] + integral[y0 * (width + 1) + x0]
      out[y * width + x] = gray[y * width + x] < sum / area * (1 - t) ? 1 : 0
    }
  }
  return out
}

// Connected components (flood fill) over ink pixels; returns blobs large
// enough to matter, with bounding box and solidity.
function blobs(binary, width, height) {
  const visited = new Uint8Array(width * height)
  const out = []
  const stack = new Int32Array(width * height)
  for (let start = 0; start < width * height; start++) {
    if (!binary[start] || visited[start]) continue
    let sp = 0
    stack[sp++] = start
    visited[start] = 1
    let area = 0, minX = width, maxX = 0, minY = height, maxY = 0
    while (sp) {
      const p = stack[--sp]
      const x = p % width, y = (p / width) | 0
      area++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (x > 0 && binary[p - 1] && !visited[p - 1]) { visited[p - 1] = 1; stack[sp++] = p - 1 }
      if (x < width - 1 && binary[p + 1] && !visited[p + 1]) { visited[p + 1] = 1; stack[sp++] = p + 1 }
      if (y > 0 && binary[p - width] && !visited[p - width]) { visited[p - width] = 1; stack[sp++] = p - width }
      if (y < height - 1 && binary[p + width] && !visited[p + width]) { visited[p + width] = 1; stack[sp++] = p + width }
    }
    if (area < 24) continue
    const bw = maxX - minX + 1, bh = maxY - minY + 1
    out.push({ area, minX, maxX, minY, maxY, bw, bh, cx: minX + bw / 2, cy: minY + bh / 2, fill: area / (bw * bh) })
  }
  return out
}

// The four corner markers: solid dark squares whose positions form a
// rectangle of known size (from sheet-spec). Strategy: collect solid-ish
// square blobs, then find the best quadruple fitting the expected rectangle
// — anywhere in the image, any rotation. (A fixed per-corner-quadrant search
// fails on short sheets, which live entirely in the page's top half.)
export function findMarkerQuads(binary, width, height, itemCount) {
  const maxSide = Math.max(width, height)
  const all = blobs(binary, width, height)
  const passes = (b, fillMin) => {
    const side = (b.bw + b.bh) / 2
    return side >= maxSide * 0.008 && side <= maxSide * 0.08
      && b.bw / b.bh > 0.45 && b.bw / b.bh < 2.2 && b.fill >= fillMin
  }
  let cand = all.filter(b => passes(b, 0.85))
  if (cand.length < 4) cand = all.filter(b => passes(b, 0.6))
  if (cand.length > 60) cand = [...cand].sort((a, b) => b.fill - a.fill).slice(0, 60)
  if (cand.length < 4) return null

  const m = markerCenters(itemCount)
  const wSpan = Math.hypot(m[1].x - m[0].x, m[1].y - m[0].y)
  const hSpan = Math.hypot(m[3].x - m[0].x, m[3].y - m[0].y)

  const near = (p, tol) => {
    let best = null, bd = tol
    for (const b of cand) {
      const d = Math.hypot(b.cx - p.x, b.cy - p.y)
      if (d < bd) { bd = d; best = b }
    }
    return best
  }

  let best = null
  const consider = (P, Q, ratio) => {
    const d = Math.hypot(Q.cx - P.cx, Q.cy - P.cy)
    if (d < maxSide * 0.1) return // degenerate pair
    const hh = d * ratio
    const vx = (Q.cx - P.cx) / d, vy = (Q.cy - P.cy) / d
    const tol = d * 0.08
    for (const sign of [1, -1]) {
      const px = -vy * sign, py = vx * sign
      const C = near({ x: Q.cx + px * hh, y: Q.cy + py * hh }, tol)
      if (!C) continue
      const D = near({ x: P.cx + px * hh, y: P.cy + py * hh }, tol)
      if (!D) continue
      const err = Math.hypot(C.cx - (Q.cx + px * hh), C.cy - (Q.cy + py * hh))
        + Math.hypot(D.cx - (P.cx + px * hh), D.cy - (P.cy + py * hh))
      if (!best || err < best.err) best = { err, cyc: [P, Q, C, D] }
    }
  }

  for (let i = 0; i < cand.length; i++) {
    for (let j = i + 1; j < cand.length; j++) {
      consider(cand[i], cand[j], hSpan / wSpan) // pair is a top/bottom edge
      consider(cand[i], cand[j], wSpan / hSpan) // pair is a side edge
    }
  }
  if (!best) return null
  return normalizeQuad(best.cyc)
}

// Bring a found 4-cycle to TL,TR,BR,BL reading order: make it clockwise
// (y-down), then rotate so the TL-most corner leads.
function normalizeQuad(cyc) {
  // inputs may be blobs (cx/cy) or points (x/y) — normalize to x/y first
  const pts = cyc.map(p => ({ x: p.cx ?? p.x, y: p.cy ?? p.y }))
  const cross = (pts[1].x - pts[0].x) * (pts[2].y - pts[1].y) - (pts[1].y - pts[0].y) * (pts[2].x - pts[1].x)
  const q = cross < 0 ? [pts[0], pts[3], pts[2], pts[1]] : pts
  let k = 0
  for (let i = 1; i < 4; i++) if (q[i].x + q[i].y < q[k].x + q[k].y) k = i
  return [q[k], q[(k + 1) % 4], q[(k + 2) % 4], q[(k + 3) % 4]]
}

// Solve the 3×3 homography mapping 4 source points to 4 destination points
// (DLT with the last element fixed at 1). Returns null when singular.
export function homography(src, dst) {
  const A = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = [src[i].x, src[i].y]
    const [u, v] = [dst[i].x, dst[i].y]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  for (let col = 0; col < 8; col++) {
    let piv = col
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r
    if (Math.abs(A[piv][col]) < 1e-9) return null
    ;[A[col], A[piv]] = [A[piv], A[col]]
    for (let r = 0; r < 8; r++) {
      if (r === col) continue
      const f = A[r][col] / A[col][col]
      for (let c = col; c < 9; c++) A[r][c] -= f * A[col][c]
    }
  }
  const h = []
  for (let i = 0; i < 8; i++) h.push(A[i][8] / A[i][i])
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]
}

export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + 1
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w }
}

export function decodeQr(data, width, height, options) {
  try {
    const res = options ? jsQR(data, width, height, options) : jsQR(data, width, height)
    return res && res.data ? res.data : null
  } catch { return null }
}

// Dark-pixel fraction inside a disk of radius r at PDF-space point (x, y).
function inkFraction(binary, width, height, H, x, y, rPx) {
  const c = applyH(H, x, y)
  let dark = 0, total = 0
  const step = Math.max(1, Math.round(rPx / 4))
  for (let dy = -rPx; dy <= rPx; dy += step) {
    for (let dx = -rPx; dx <= rPx; dx += step) {
      if (dx * dx + dy * dy > rPx * rPx) continue
      const px = Math.round(c.x + dx), py = Math.round(c.y + dy)
      if (px < 0 || py < 0 || px >= width || py >= height) continue
      total++
      if (binary[py * width + px]) dark++
    }
  }
  return total ? dark / total : 0
}

export const FLAG = { OK: 'ok', BLANK: 'blank', MULTI: 'multi', FAINT: 'faint' }

/**
 * @typedef {{ ok: true, answers: number[], flags: string[], fills: number[][],
 *   qr: string | null, markers: { x: number, y: number }[], scale: number }} SheetRead
 */
/**
 * @typedef {{ ok: false, reason: 'markers'|'frame', qr: string | null }} SheetReadFail
 */

/**
 * Read a photographed bubble sheet.
 * @param {{ data: Uint8ClampedArray, width: number, height: number }} image RGBA
 * @param {number} itemCount items on the sheet (drives the expected geometry)
 * @returns {SheetRead | SheetReadFail}
 */
export function readSheet(image, itemCount) {
  const { data, width, height } = image
  const qr = decodeQr(data, width, height)
  const gray = toGray(data, width, height)
  const binary = threshold(gray, width, height)
  const quad = findMarkerQuads(binary, width, height, itemCount)
  if (!quad) return { ok: false, reason: 'markers', qr }

  const pdfMarkers = markerCenters(itemCount)
  const H = homography(pdfMarkers, quad)
  if (!H) return { ok: false, reason: 'markers', qr }

  // the printed frame must land on ink — rejects rectangles fitted to
  // bubble rings or other non-frame structures
  if (!frameInk(binary, width, height, H, itemCount)) return { ok: false, reason: 'frame', qr }

  // pixels-per-point from the marker spread
  const pdfSpan = Math.hypot(pdfMarkers[1].x - pdfMarkers[0].x, pdfMarkers[1].y - pdfMarkers[0].y)
  const pxSpan = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y)
  const scale = pxSpan / pdfSpan
  const rPx = Math.max(3, Math.round(SHEET.circleR * SHEET.scanRadiusFrac * scale))

  const answers = []
  const flags = []
  const fills = []
  for (let i = 0; i < itemCount; i++) {
    const row = []
    for (let b = 0; b < 4; b++) {
      const c = bubbleCenter(itemCount, i, b)
      row.push(inkFraction(binary, width, height, H, c.x, c.y, rPx))
    }
    fills.push(row)
    const order = [0, 1, 2, 3].sort((a, b) => row[b] - row[a])
    const top = row[order[0]], second = row[order[1]]
    if (top < 0.30) { answers.push(-1); flags.push(FLAG.BLANK); continue }
    if (top - second < 0.12) { answers.push(-1); flags.push(FLAG.MULTI); continue }
    if (top < 0.55) { answers.push(order[0]); flags.push(FLAG.FAINT); continue }
    answers.push(order[0]); flags.push(FLAG.OK)
  }
  return { ok: true, answers, flags, fills, qr, markers: quad, scale }
}

// Ink fraction along the printed frame's four edges (sampled via H).
function frameInk(binary, width, height, H, itemCount) {
  const f = frameRect()
  const pts = []
  const N = 24
  for (let i = 0; i <= N; i++) {
    const t = i / N
    pts.push([f.x + t * f.w, f.y], [f.x + t * f.w, f.y + f.h], [f.x, f.y + t * f.h], [f.x + f.w, f.y + t * f.h])
  }
  let dark = 0, total = 0
  for (const [x, y] of pts) {
    const p = applyH(H, x, y)
    let hit = false
    for (let dy = -2; dy <= 2 && !hit; dy++) {
      for (let dx = -2; dx <= 2 && !hit; dx++) {
        const px = Math.round(p.x + dx), py = Math.round(p.y + dy)
        if (px < 0 || py < 0 || px >= width || py >= height) continue
        if (binary[py * width + px]) hit = true
      }
    }
    total++
    if (hit) dark++
  }
  return total ? dark / total >= 0.6 : false
}

/** Score detected answers against a saved quiz's items. */
export function scoreSheet(answers, items) {
  let correct = 0, attempted = 0
  for (let i = 0; i < items.length; i++) {
    if (answers[i] >= 0) attempted++
    if (answers[i] === items[i].answerIndex) correct++
  }
  return { correct, attempted, total: items.length, percent: items.length ? Math.round((correct / items.length) * 100) : 0 }
}
