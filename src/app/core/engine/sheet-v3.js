// Sheet v3: long-bond page with two PIN half-sheets.
//
// The four anchors are deliberately large (10 mm), with a 4 mm white quiet
// zone. The grid is tight because those anchors and quiet zones occupy the
// page margin, but the geometry is shared by the print proof and the scanner.
// v2 remains untouched in sheet-spec.js; callers select v3 explicitly.

export const PIN_SHEET_V3 = {
  version: 3,
  W: 612,
  H: 936,
  halfH: 468,
  cutY: 468,
  marker: 28.35,          // 10 mm
  quiet: 11.34,           // 4 mm
  markerCenters: [
    { x: 50, y: 50 },
    { x: 562, y: 50 },
    { x: 562, y: 418 },
    { x: 50, y: 418 },
  ],
  content: { x: 80, y: 80, w: 452, h: 308 },
  pinX0: 80,
  pinDx: 18,
  pinWriteY: 136,
  pinRowY0: 162,
  pinPitch: 20,
  pinR: 3.3,
  pinDigits: 5,
  pinRows: 10,
  itemX0: 200,
  itemDx: 46,
  itemRowY0: 170,
  itemPitch: 20,
  letterPad: 8,
  letterGap: 9,
  circleR: 3.3,
  scanRadiusFrac: 0.85,
  qr: { x: 430, y: 258, size: 90 },
  letters: ['A', 'B', 'C', 'D'],
}

function halfOffset(half = 0) {
  return half ? PIN_SHEET_V3.halfH : 0
}

export function pinV3MarkerCenters(half = 0) {
  const dy = halfOffset(half)
  return PIN_SHEET_V3.markerCenters.map(p => ({ x: p.x, y: p.y + dy }))
}

export function pinV3MarkerRects(half = 0) {
  const m = PIN_SHEET_V3.marker
  return pinV3MarkerCenters(half).map(c => ({ x: c.x - m / 2, y: c.y - m / 2, w: m, h: m }))
}

// The page itself is the fallback frame for alignment. v3 has no printed
// border; this is only a coordinate rectangle.
export function pinV3FrameRect(half = 0) {
  return { x: 0, y: halfOffset(half), w: PIN_SHEET_V3.W, h: PIN_SHEET_V3.halfH }
}

export function pinV3QrRect(half = 0) {
  const q = PIN_SHEET_V3.qr
  return { x: q.x, y: q.y + halfOffset(half), size: q.size }
}

export function pinV3ItemCenter(item, letter, half = 0) {
  const col = Math.floor(item / 10)
  const row = item % 10
  return {
    x: PIN_SHEET_V3.itemX0 + col * PIN_SHEET_V3.itemDx
      + PIN_SHEET_V3.letterPad + letter * PIN_SHEET_V3.letterGap + PIN_SHEET_V3.circleR,
    y: PIN_SHEET_V3.itemRowY0 + row * PIN_SHEET_V3.itemPitch + halfOffset(half),
  }
}

export function pinV3DigitCenter(digit, value, half = 0) {
  return {
    x: PIN_SHEET_V3.pinX0 + digit * PIN_SHEET_V3.pinDx + 8,
    y: PIN_SHEET_V3.pinRowY0 + (9 - value) * PIN_SHEET_V3.pinPitch + halfOffset(half),
  }
}

export function pinV3WriteBox(half = 0, digit = 0) {
  return {
    x: PIN_SHEET_V3.pinX0 + digit * PIN_SHEET_V3.pinDx,
    y: PIN_SHEET_V3.pinWriteY + halfOffset(half),
    w: 16,
    h: 11,
  }
}

export function pinV3CutLineY() {
  return PIN_SHEET_V3.cutY
}

export function pinSheetVersion(text) {
  return typeof text === 'string' && text.startsWith('QZ3v3:') ? 3 : 0
}

export function pinV3SheetQrPayload(quizId, quizName) {
  const name = String(quizName || '').trim().slice(0, 48)
  return `QZ3v3:${quizId}${name ? '|' + name : ''}`
}
