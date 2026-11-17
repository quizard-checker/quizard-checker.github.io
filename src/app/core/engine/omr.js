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
import {
  SHEET, PIN_SHEET, PIN_ITEMS,
  frameRect, markerCenters, bubbleCenter, qrRect,
  pinFrameRect, pinMarkerCenters, pinItemCenter, pinDigitCenter, pinQrRect,
} from './sheet-spec.js'

export function toGray(data, width, height) {
  const gray = new Float32Array(width * height)
  for (let i = 0, p = 0; p < gray.length; i += 4, p++) {
    gray[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255
  }
  return gray
}

// Bradley/Wellner: pixel is dark when below (1 - t) × mean of its window.
export function threshold(gray, width, height, { t = 0.2, winFrac = 0.045 } = {}) {  const win = Math.max(15, Math.round(Math.min(width, height) * winFrac)) | 1
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

// ── preprocessing: undo the global lift a screen photo (or a dim room) adds ──

// Separable [1,2,1]/4 smoothing, one pass — stills sensor noise before the
// contrast stretch so the stretch doesn't amplify it into false ink.
export function smooth(gray, width, height) {
  const tmp = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      tmp[row + x] = (gray[row + Math.max(0, x - 1)] + 2 * gray[row + x] + gray[row + Math.min(width - 1, x + 1)]) / 4
    }
  }
  for (let y = 0; y < height; y++) {
    const up = Math.max(0, y - 1) * width, mid = y * width, down = Math.min(height - 1, y + 1) * width
    for (let x = 0; x < width; x++) {
      gray[mid + x] = (tmp[up + x] + 2 * tmp[mid + x] + tmp[down + x]) / 4
    }
  }
  return gray
}

// Robust contrast stretch: map the 1st/99th percentile gray levels to 0/1.
// A screen photo arrives with "black" as a grey — the panel's black is
// emissive and the camera exposes for the bright display — so Bradley's fixed
// relative threshold loses its margin and the corner squares read as paper.
// Stretching the observed range back to [0,1] restores the margin the
// thresholds were tuned for, and leaves photos that already span the range
// (paper under decent light) effectively untouched.
export function stretch(gray, width, height) {
  const hist = new Uint32Array(256)
  for (let i = 0; i < gray.length; i++) hist[Math.min(255, (gray[i] * 255) | 0)]++
  const lo = gray.length * 0.01, hi = gray.length * 0.99
  let acc = 0, p1 = 0, p99 = 255
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= lo) { p1 = v; break } }
  acc = 0
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= hi) { p99 = v; break } }
  const span = p99 - p1
  if (span < 12) return gray // no meaningful range — nothing to stretch
  for (let i = 0; i < gray.length; i++) {
    const v = (gray[i] * 255 - p1) / span
    gray[i] = v < 0 ? 0 : v > 1 ? 1 : v
  }
  return gray
}

// The shared front half of both readers: grayscale → smooth → stretch →
// Bradley threshold.
function binarize(data, width, height) {
  return threshold(stretch(smooth(toGray(data, width, height), width, height), width, height), width, height)
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
export function findMarkerQuads(binary, width, height, expectedCenters) {
  const maxSide = Math.max(width, height)
  const all = blobs(binary, width, height)
  const passes = (b, fillMin) => {
    const side = (b.bw + b.bh) / 2
    // 0.4% floor: a half-sheet's 7pt markers are 1.14% of the sheet width, so
    // a sheet framed at ~35% of the frame lands right at 0.4% — the old 0.8%
    // floor rejected far-framed PIN sheets before the quad matcher could even
    // look (the ratio + fill + expected-geometry checks do the real filtering;
    // text blobs die on fill ratio long before this floor matters).
    return side >= maxSide * 0.004 && side <= maxSide * 0.08
      && b.bw / b.bh > 0.45 && b.bw / b.bh < 2.2 && b.fill >= fillMin
  }
  let cand = all.filter(b => passes(b, 0.85))
  if (cand.length < 4) cand = all.filter(b => passes(b, 0.6))
  if (cand.length > 60) cand = [...cand].sort((a, b) => b.fill - a.fill).slice(0, 60)
  if (cand.length < 4) return null

  const m = expectedCenters
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

// Same decode, but keeps jsQR's four QR corners. The marker fallback uses
// these corners as a second alignment source when the printed registration
// squares are clipped by a printer.
export function decodeQrLocated(data, width, height, options) {
  try {
    const res = options ? jsQR(data, width, height, options) : jsQR(data, width, height)
    if (!res || !res.data || !res.location) return null
    const location = res.location
    if (!location.topLeftCorner || !location.topRightCorner
      || !location.bottomRightCorner || !location.bottomLeftCorner) return null
    return { text: res.data, location }
  } catch { return null }
}

// TL, TR, BR, BL in PDF space — the same order jsQR returns a QR location.
export function rectCorners(rect) {
  const { x, y, size } = rect
  return [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ]
}

function locationCorners(location) {
  return [
    location.topLeftCorner,
    location.topRightCorner,
    location.bottomRightCorner,
    location.bottomLeftCorner,
  ]
}

function shiftLocation(location, dx, dy) {
  const shift = p => ({ x: p.x + dx, y: p.y + dy })
  return {
    topLeftCorner: shift(location.topLeftCorner),
    topRightCorner: shift(location.topRightCorner),
    bottomRightCorner: shift(location.bottomRightCorner),
    bottomLeftCorner: shift(location.bottomLeftCorner),
  }
}

function cropRgba(data, width, height, x0, y0, w, h) {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * width + x0) * 4
    out.set(data.subarray(src, src + w * 4), y * w * 4)
  }
  return out
}

// jsQR's full-frame locator sometimes misses a perfectly readable QR in a
// multi-megapixel photo. Tiled decoding gives it smaller, denser crops. The
// location is translated back into full-image coordinates.
export function decodeQrAnywhere(image) {
  const { data, width, height } = image
  const full = decodeQrLocated(data, width, height)
  if (full) return { text: full.text, location: full.location, source: 'full' }

  const tiles = []
  const addTiles = (nx, ny) => {
    const overlap = 0.16
    for (let ty = 0; ty < ny; ty++) {
      for (let tx = 0; tx < nx; tx++) {
        const x0 = Math.max(0, Math.round((tx / nx - overlap / nx) * width))
        const x1 = Math.min(width, Math.round(((tx + 1) / nx + overlap / nx) * width))
        const y0 = Math.max(0, Math.round((ty / ny - overlap / ny) * height))
        const y1 = Math.min(height, Math.round(((ty + 1) / ny + overlap / ny) * height))
        if (x1 - x0 > 160 && y1 - y0 > 160) tiles.push({ x0, y0, w: x1 - x0, h: y1 - y0 })
      }
    }
  }
  addTiles(2, 2)
  addTiles(3, 3)

  for (const t of tiles) {
    const crop = cropRgba(data, width, height, t.x0, t.y0, t.w, t.h)
    const found = decodeQrLocated(crop, t.w, t.h)
    if (found) {
      return {
        text: found.text,
        location: shiftLocation(found.location, t.x0, t.y0),
        source: 'tile',
      }
    }
  }
  return null
}

export function qrAnchorHomography(rect, location) {
  const H = homography(rectCorners(rect), locationCorners(location))
  return H || null
}

// A small QR square gives a noisy projective homography when its corners are
// only approximate; the error is amplified across the rest of the sheet. The
// QR's two edge vectors are much more stable, so use the affine transform they
// imply for the QR-only fallback. Marker alignment still uses the full
// homography whenever the registration squares are available.
function qrAnchorAffine(rect, location) {
  const [tl, tr, br, bl] = locationCorners(location)
  const s = rect.size
  if (!s) return null
  const ux = ((tr.x - tl.x) + (br.x - bl.x)) / (2 * s)
  const uy = ((tr.y - tl.y) + (br.y - bl.y)) / (2 * s)
  const vx = ((bl.x - tl.x) + (br.x - tr.x)) / (2 * s)
  const vy = ((bl.y - tl.y) + (br.y - tr.y)) / (2 * s)
  return [
    ux, vx, tl.x - rect.x * ux - rect.y * vx,
    uy, vy, tl.y - rect.x * uy - rect.y * vy,
    0, 0, 1,
  ]
}

export function qrLocationCenter(location) {
  const pts = locationCorners(location)
  return {
    x: (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4,
    y: (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4,
  }
}

export function qrLocationSide(location) {
  const pts = locationCorners(location)
  const side = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
  return (side(pts[0], pts[1]) + side(pts[1], pts[2]) + side(pts[2], pts[3]) + side(pts[3], pts[0])) / 4
}

function qrAnchorAlignment(rect, location) {
  if (!location || !rect?.size) return null
  const H = qrAnchorAffine(rect, location)
  if (!H) return null
  return {
    H,
    quad: locationCorners(location),
    scale: qrLocationSide(location) / rect.size,
    rot: 0,
    frameScore: 0,
    qrScore: 0,
    score: 0,
    qrAnchor: true,
  }
}

function quadTouchesEdge(quad, width, height, frac = 0.02) {
  if (!quad?.length) return false
  const margin = Math.max(8, Math.round(Math.min(width, height) * frac))
  return quad.some(p => p.x <= margin || p.y <= margin || p.x >= width - margin || p.y >= height - margin)
}

// When the printed corner squares are clipped, the paper's own four edges are
// still there. Map the known half/full page rectangle onto that outline and
// check the predicted QR position against jsQR's actual corners. This is much
// more stable than extrapolating a whole page from the tiny QR square.
export function pageAnchorAlignment(page, quad, rect, location) {
  if (!page?.w || !page?.h || !quad?.length || !location || !rect?.size) return null
  const pagePts = [
    { x: 0, y: 0 }, { x: page.w, y: 0 },
    { x: page.w, y: page.h }, { x: 0, y: page.h },
  ]
  const qr = qrLocationCenter(location)
  const side = qrLocationSide(location)
  const cx = rect.x + rect.size / 2
  const cy = rect.y + rect.size / 2
  let best = null
  for (let r = 0; r < 4; r++) {
    const q = r ? quad.map((_, i) => quad[(i + r) % 4]) : quad.slice()
    const H = homography(pagePts, q)
    if (!H) continue
    const p = applyH(H, cx, cy)
    const err = Math.hypot(p.x - qr.x, p.y - qr.y)
    if (!best || err < best.err) best = { H, quad: q, rot: r, err }
  }
  if (!best || best.err > side * 0.55) return null
  const edge = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
  const sw = (edge(best.quad[0], best.quad[1]) + edge(best.quad[3], best.quad[2])) / (2 * page.w)
  const sh = (edge(best.quad[1], best.quad[2]) + edge(best.quad[0], best.quad[3])) / (2 * page.h)
  return {
    H: best.H,
    quad: best.quad,
    scale: (sw + sh) / 2,
    rot: best.rot,
    frameScore: 0,
    qrScore: 0,
    score: 0,
    qrAnchor: false,
    pageAnchor: true,
    qrError: best.err,
  }
}

// The same idea when the detected quad is the printed frame instead of the
// paper edge. The frame sits inside the page, so mapping page corners to it
// would shift every bubble; mapping the known frame rectangle to the quad
// aligns the grid directly.
function frameAnchorAlignment(frame, quad, rect, location) {
  if (!frame?.w || !quad?.length || !location || !rect?.size) return null
  const framePts = [
    { x: frame.x, y: frame.y },
    { x: frame.x + frame.w, y: frame.y },
    { x: frame.x + frame.w, y: frame.y + frame.h },
    { x: frame.x, y: frame.y + frame.h },
  ]
  const qr = qrLocationCenter(location)
  const side = qrLocationSide(location)
  const cx = rect.x + rect.size / 2
  const cy = rect.y + rect.size / 2
  let best = null
  for (let r = 0; r < 4; r++) {
    const q = r ? quad.map((_, i) => quad[(i + r) % 4]) : quad.slice()
    const H = homography(framePts, q)
    if (!H) continue
    const p = applyH(H, cx, cy)
    const err = Math.hypot(p.x - qr.x, p.y - qr.y)
    if (!best || err < best.err) best = { H, quad: q, rot: r, err }
  }
  if (!best || best.err > side * 0.55) return null
  const edge = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
  const sw = (edge(best.quad[0], best.quad[1]) + edge(best.quad[3], best.quad[2])) / (2 * frame.w)
  const sh = (edge(best.quad[1], best.quad[2]) + edge(best.quad[0], best.quad[3])) / (2 * frame.h)
  return {
    H: best.H,
    quad: best.quad,
    scale: (sw + sh) / 2,
    rot: best.rot,
    frameScore: 0,
    qrScore: 0,
    score: 0,
    qrAnchor: false,
    pageAnchor: false,
    frameAnchor: true,
    qrError: best.err,
  }
}

// The page/frame quad can be slightly off in scale or translation. The QR is
// a precise landmark inside it, so adjust the base homography with a similarity
// that puts the QR exactly where jsQR found it. This keeps the paper's
// perspective while correcting the accumulated print/camera error.
function correctWithQr(base, rect, location) {
  if (!base?.H || !location || !rect?.size) return base
  const cx = rect.x + rect.size / 2
  const cy = rect.y + rect.size / 2
  const pc = applyH(base.H, cx, cy)
  const p0 = applyH(base.H, rect.x, rect.y)
  const p1 = applyH(base.H, rect.x + rect.size, rect.y)
  const predSide = Math.hypot(p1.x - p0.x, p1.y - p0.y)
  const actSide = qrLocationSide(location)
  const s = predSide > 0 ? actSide / predSide : 1
  if (!Number.isFinite(s) || s <= 0) return base
  const actual = qrLocationCenter(location)
  const tx = actual.x - s * pc.x
  const ty = actual.y - s * pc.y
  const H = base.H.slice()
  H[0] *= s; H[1] *= s; H[2] = H[2] * s + tx
  H[3] *= s; H[4] *= s; H[5] = H[5] * s + ty
  return { ...base, H, scale: (base.scale || 1) * s, qrCorrected: true }
}

// Prefer the marker quad when it agrees with the QR's actual location. A
// paper-edge/shadow quad can look like four markers; when it does, it maps the
// known QR rect to the wrong part of the image. The QR corners are a second,
// independent alignment source for prints whose corner squares were clipped.
function resolveAlignment(aligned, rect, location, width, height, page = null, frame = null) {
  const anchor = qrAnchorAlignment(rect, location)
  const pageAnchor = pageAnchorAlignment(page, aligned?.quad, rect, location)
  const frameAnchor = frameAnchorAlignment(frame, aligned?.quad, rect, location)
  const base = pageAnchor || frameAnchor
  const corrected = base ? correctWithQr(base, rect, location) : null
  const extrapolated = corrected || [pageAnchor, frameAnchor]
    .filter(Boolean)
    .sort((a, b) => a.qrError - b.qrError)[0] || null
  if (!aligned || !aligned.H) return extrapolated || anchor
  if (!anchor) return { ...aligned, qrAnchor: false, pageAnchor: false, frameAnchor: false }
  const actual = qrLocationCenter(location)
  const mapped = applyH(aligned.H, rect.x + rect.size / 2, rect.y + rect.size / 2)
  const off = Math.hypot(mapped.x - actual.x, mapped.y - actual.y)
  const side = qrLocationSide(location)
  if (off > side * 0.35) {
    if (extrapolated) {
      return {
        ...extrapolated,
        markerRot: aligned.rot,
        markerFrameScore: aligned.frameScore,
        markerQrScore: aligned.qrScore,
      }
    }
    return {
      ...anchor,
      markerRot: aligned.rot,
      markerFrameScore: aligned.frameScore,
      markerQrScore: aligned.qrScore,
    }
  }
  return { ...aligned, qrAnchor: false, pageAnchor: false, frameAnchor: false }
}

// Rectify just the printed QR square, using the corner-marker homography.
// The full-frame decode asks jsQR to find a 76–80pt code in a multi-megapixel
// photo; once the markers are found we know exactly where the code is, so a
// small warped crop gives jsQR a clean, module-sized image instead. Both sheet
// geometries are tried because the QR rect is fixed per sheet type.
function warpQr(data, width, height, H, rect, outSize = 480) {
  const pad = rect.size * 0.16
  const span = rect.size + pad * 2
  const out = new Uint8ClampedArray(outSize * outSize * 4)
  for (let y = 0; y < outSize; y++) {
    for (let x = 0; x < outSize; x++) {
      const o = (y * outSize + x) * 4
      const p = applyH(H,
        rect.x - pad + ((x + 0.5) / outSize) * span,
        rect.y - pad + ((y + 0.5) / outSize) * span)
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)
        || p.x < 0 || p.y < 0 || p.x >= width - 1 || p.y >= height - 1) {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 255
        continue
      }
      const sx = p.x - 0.5, sy = p.y - 0.5
      const ix = Math.floor(sx), iy = Math.floor(sy)
      const fx = sx - ix, fy = sy - iy
      const i00 = (iy * width + ix) * 4
      const i01 = i00 + 4
      const i10 = i00 + width * 4
      const i11 = i10 + 4
      for (let c = 0; c < 4; c++) {
        const top = data[i00 + c] * (1 - fx) + data[i01 + c] * fx
        const bot = data[i10 + c] * (1 - fx) + data[i11 + c] * fx
        out[o + c] = top * (1 - fy) + bot * fy
      }
    }
  }
  return { data: out, width: outSize, height: outSize }
}

// Dark fraction inside the known QR rectangle. The printed frame is a
// rectangle, so a 180°-rotated marker mapping can pass the frame check too;
// the QR is not symmetric, and the wrong mapping lands on the sparse opposite
// corner. This is what tells a sideways/upside-down sheet which way is up.
function qrInkScore(binary, width, height, H, qr) {
  const N = 18
  let dark = 0, total = 0
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const p = applyH(H, qr.x + ((x + 0.5) / N) * qr.size, qr.y + ((y + 0.5) / N) * qr.size)
      const px = Math.round(p.x), py = Math.round(p.y)
      if (px < 0 || py < 0 || px >= width || py >= height) continue
      total++
      if (binary[py * width + px]) dark++
    }
  }
  return total ? dark / total : 0
}

// A sheet can be photographed sideways. findMarkerQuads returns the four
// corners in clockwise image order starting at the top-left-most one, which is
// not necessarily the sheet's own top-left when the paper is rotated. Try all
// four cyclic assignments; keep the one matching the printed frame, then use
// the dense QR rectangle to break the frame's 180° symmetry. When a QR was
// already decoded, the frame line is only a bonus: real prints often render
// its 1–2pt rule faint enough to fail thresholding, and the marker geometry
// plus the QR identity are already enough to align the sheet.
function alignWithFrame(binary, width, height, centers, frame, window = 3, qr = null, minFrame = 0.6) {
  const quad = findMarkerQuads(binary, width, height, centers)
  if (!quad) return null
  let best = null
  for (let r = 0; r < 4; r++) {
    const q = r ? quad.map((_, i) => quad[(i + r) % 4]) : quad
    const H = homography(centers, q)
    if (!H) continue
    const frameScore = frameInkScore(binary, width, height, H, frame, window)
    if (frameScore < minFrame) continue
    const qrScore = qr ? qrInkScore(binary, width, height, H, qr) : 0
    const score = frameScore + qrScore
    if (!best || score > best.score) best = { H, quad: q, score, frameScore, qrScore, rot: r }
  }
  return best || { H: null, quad, score: 0, frameScore: 0, qrScore: 0, rot: -1 }
}

/**
 * Locate a sheet without needing its QR. Used by the live loop so a sheet with
 * all four corners visible can trigger a capture even when the code is too
 * small for the preview decoder. Returns null unless the printed frame also
 * lines up, which rejects random square-ish blobs.
 * @param {{ data: Uint8ClampedArray, width: number, height: number }} image RGBA
 * @returns {{ kind: 'letter'|'pin', quad: { x: number, y: number }[], edge: boolean } | null}
 */
export function detectSheet(image, minFrame = 0.6) {
  const { data, width, height } = image
  const binary = binarize(data, width, height)
  const sheets = [
    { kind: 'letter', centers: markerCenters(0), frame: frameRect(), qr: qrRect(0) },
    { kind: 'pin', centers: pinMarkerCenters(0), frame: pinFrameRect(0), qr: pinQrRect(0) },
  ]
  const margin = Math.max(8, Math.round(Math.min(width, height) * 0.02))
  let best = null
  for (const sheet of sheets) {
    const aligned = alignWithFrame(binary, width, height, sheet.centers, sheet.frame, 3, sheet.qr, minFrame)
    if (!aligned || !aligned.H) continue
    if (!best || aligned.score > best.score) best = { ...sheet, ...aligned }
  }
  if (!best) return null
  const edge = best.quad.some(p =>
    p.x < margin || p.y < margin || p.x > width - margin || p.y > height - margin)
  return { kind: best.kind, quad: best.quad, edge }
}

/**
 * Second-chance QR read: find the corner squares, build the sheet homography,
 * then decode a high-resolution crop of the known QR rectangle. Use only
 * after a full-frame decode fails — it costs one extra marker pass. Tries all
 * four corner assignments because the sheet may be sideways.
 * @param {{ data: Uint8ClampedArray, width: number, height: number }} image RGBA
 * @returns {string | null}
 */
export function decodeQrFromSheet(image) {
  const { data, width, height } = image
  const binary = binarize(data, width, height)
  const sheets = [
    { centers: markerCenters(0), qr: qrRect(0) },
    { centers: pinMarkerCenters(0), qr: pinQrRect(0) },
  ]
  for (const sheet of sheets) {
    const quad = findMarkerQuads(binary, width, height, sheet.centers)
    if (!quad) continue
    for (let r = 0; r < 4; r++) {
      const q = r ? quad.map((_, i) => quad[(i + r) % 4]) : quad
      const H = homography(sheet.centers, q)
      if (!H) continue
      const crop = warpQr(data, width, height, H, sheet.qr)
      const text = decodeQr(crop.data, crop.width, crop.height)
      if (text) return text
    }
  }
  return null
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
 * @param {string | null} [qrText] QR already decoded from the frame / live view
 * @param {string | null} [qrSource] diagnostic source label
 * @param {any | null} [qrLocation] jsQR corners for QR-only alignment
 * @returns {SheetRead | SheetReadFail}
 */
export function readSheet(image, itemCount, qrText = null, qrSource = null, qrLocation = null) {
  const { data, width, height } = image
  const qr = qrText || decodeQr(data, width, height)
  const diagBase = {
    width, height, itemCount, qr,
    qrSource: qrSource || (qrText ? 'provided' : qr ? 'frame' : 'none'),
  }
  const binary = binarize(data, width, height)
  const pdfMarkers = markerCenters(itemCount)
  const aligned = alignWithFrame(binary, width, height, pdfMarkers, frameRect(), 3, qr ? qrRect(itemCount) : null, qr ? 0 : 0.6)
  const resolved = resolveAlignment(aligned, qrRect(itemCount), qrLocation, width, height, { w: SHEET.W, h: SHEET.H }, frameRect())
  if (!resolved) return { ok: false, reason: 'markers', qr, diag: { ...diagBase, reason: 'markers' } }
  if (!resolved.H) {
    return {
      ok: false, reason: 'frame', qr,
      diag: {
        ...diagBase, reason: 'frame', rot: resolved.rot ?? -1,
        frameScore: resolved.frameScore ?? 0, qrScore: resolved.qrScore ?? 0,
        quad: resolved.quad,
      },
    }
  }
  const H = resolved.H
  const quad = resolved.quad

  // pixels-per-point from the marker spread, or from the QR square when the
  // markers were clipped and the QR anchored the sheet instead.
  const pdfSpan = Math.hypot(pdfMarkers[1].x - pdfMarkers[0].x, pdfMarkers[1].y - pdfMarkers[0].y)
  const pxSpan = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y)
  const scale = (resolved.qrAnchor || resolved.pageAnchor) ? resolved.scale : pxSpan / pdfSpan
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
  return {
    ok: true, answers, flags, fills, qr, markers: quad, scale,
    diag: {
      ...diagBase,
      rot: resolved.rot ?? -1, qrAnchor: !!resolved.qrAnchor, pageAnchor: !!resolved.pageAnchor, frameAnchor: !!resolved.frameAnchor,
      frameScore: resolved.frameScore ?? 0, qrScore: resolved.qrScore ?? 0, score: resolved.score ?? 0,
      quad, scale, rPx,
      thresholds: { blank: 0.30, multi: 0.12, faint: 0.55 },
      answers, flags, fills,
    },
  }
}

// Ink fraction along the printed frame's four edges (sampled via H).
function frameInkScore(binary, width, height, H, frame, window = 2) {
  const f = frame
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
    for (let dy = -window; dy <= window && !hit; dy++) {
      for (let dx = -window; dx <= window && !hit; dx++) {
        const px = Math.round(p.x + dx), py = Math.round(p.y + dy)
        if (px < 0 || py < 0 || px >= width || py >= height) continue
        if (binary[py * width + px]) hit = true
      }
    }
    total++
    if (hit) dark++
  }
  return total ? dark / total : 0
}

// A frame counts as aligned when most of its perimeter lands on ink. The
// ratio is exposed separately so detectSheet can prefer the sheet geometry
// whose frame fits best instead of the first one that barely passes.
/** Score detected answers against a saved quiz's items. */
export function scoreSheet(answers, items) {
  let correct = 0, attempted = 0
  for (let i = 0; i < items.length; i++) {
    if (answers[i] >= 0) attempted++
    if (answers[i] === items[i].answerIndex) correct++
  }
  return { correct, attempted, total: items.length, percent: items.length ? Math.round((correct / items.length) * 100) : 0 }
}

/**
 * Read a generic PIN half-sheet (QZ3): the same OMR pipeline as readSheet but
 * against the fixed 50-item PIN geometry, plus the 5-digit PIN read from the
 * shaded 0–9 digit strips. Both printed halves are identical, so the top-half
 * geometry describes either half — the marker homography maps a bottom-half
 * photo onto the same local coordinates.
 *
 * @param {{ data: Uint8ClampedArray, width: number, height: number }} image RGBA
 * @returns {{ ok: true, answers: number[], flags: string[], fills: number[][],
 *   pin: string | null, pinDigits: number[], pinFlags: string[],
 *   qr: string | null, markers: { x: number, y: number }[], scale: number }
 *   | { ok: false, reason: 'markers'|'frame', qr: string | null }}
 * @param {string | null} [qrText] QR already decoded from the frame / live view
 * @param {string | null} [qrSource] diagnostic source label
 * @param {any | null} [qrLocation] jsQR corners for QR-only alignment
 */
export function readPinSheet(image, qrText = null, qrSource = null, qrLocation = null) {
  const { data, width, height } = image
  const qr = qrText || decodeQr(data, width, height)
  const diagBase = {
    width, height, itemCount: PIN_ITEMS, qr,
    qrSource: qrSource || (qrText ? 'provided' : qr ? 'frame' : 'none'),
  }
  const binary = binarize(data, width, height)
  const expected = pinMarkerCenters(0)
  // The printed frame is optional: four corner squares are enough to map the
  // PIN half-sheet. PIN readability and the low-confidence gate in the UI are
  // the safety net; a faint/missing border must not reject a good print.
  const aligned = alignWithFrame(binary, width, height, expected, pinFrameRect(0), 3, qr ? pinQrRect(0) : null, 0)
  const resolved = resolveAlignment(aligned, pinQrRect(0), qrLocation, width, height, { w: PIN_SHEET.W, h: PIN_SHEET.H / 2 }, pinFrameRect(0))
  if (!resolved) return { ok: false, reason: 'markers', qr, diag: { ...diagBase, reason: 'markers' } }
  if (!resolved.H) {
    return {
      ok: false, reason: 'frame', qr,
      diag: {
        ...diagBase, reason: 'frame', rot: resolved.rot ?? -1,
        frameScore: resolved.frameScore ?? 0, qrScore: resolved.qrScore ?? 0,
        quad: resolved.quad,
      },
    }
  }
  const H = resolved.H
  const quad = resolved.quad

  const pdfSpan = Math.hypot(expected[1].x - expected[0].x, expected[1].y - expected[0].y)
  const pxSpan = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y)
  const scale = (resolved.qrAnchor || resolved.pageAnchor) ? resolved.scale : pxSpan / pdfSpan
  const rPx = Math.max(2, Math.round(PIN_SHEET.circleR * PIN_SHEET.scanRadiusFrac * scale))
  const dPx = Math.max(2, Math.round(PIN_SHEET.pinR * PIN_SHEET.scanRadiusFrac * scale))

  const answers = []
  const flags = []
  const fills = []
  for (let i = 0; i < PIN_ITEMS; i++) {
    const row = []
    for (let b = 0; b < 4; b++) {
      const c = pinItemCenter(i, b)
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

  // the 5-digit PIN: darkest of the 0–9 strip per digit
  const pinDigits = []
  const pinFlags = []
  for (let d = 0; d < PIN_SHEET.pinDigits; d++) {
    const col = []
    for (let v = 0; v < PIN_SHEET.pinRows; v++) {
      const c = pinDigitCenter(d, v)
      col.push(inkFraction(binary, width, height, H, c.x, c.y, dPx))
    }
    const order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].sort((a, b) => col[b] - col[a])
    const top = col[order[0]], second = col[order[1]]
    if (top < 0.30) { pinDigits.push(-1); pinFlags.push(FLAG.BLANK); continue }
    if (top - second < 0.10) { pinDigits.push(-1); pinFlags.push(FLAG.MULTI); continue }
    if (top < 0.50) { pinDigits.push(order[0]); pinFlags.push(FLAG.FAINT); continue }
    pinDigits.push(order[0]); pinFlags.push(FLAG.OK)
  }
  const complete = pinDigits.every(v => v >= 0)
  return {
    ok: true, answers, flags, fills, qr, markers: quad, scale,
    pin: complete ? pinDigits.join('') : null,
    pinDigits, pinFlags,
    diag: {
      ...diagBase,
      rot: resolved.rot ?? -1, qrAnchor: !!resolved.qrAnchor, pageAnchor: !!resolved.pageAnchor, frameAnchor: !!resolved.frameAnchor,
      frameScore: resolved.frameScore ?? 0, qrScore: resolved.qrScore ?? 0, score: resolved.score ?? 0,
      quad, scale, rPx, dPx,
      thresholds: { blank: 0.30, multi: 0.12, faint: 0.55 },
      pinThresholds: { blank: 0.30, multi: 0.10, faint: 0.50 },
      answers, flags, fills,
      pinDigits, pinFlags, pin: complete ? pinDigits.join('') : null,
    },
  }
}
