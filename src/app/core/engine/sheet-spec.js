// Single source of truth for the printable bubble-sheet geometry (PLAN.md
// Phase 3). The PDF exporter draws from these constants and the OMR scanner
// samples from them, so print and scan can never drift apart. Units are PDF
// points on a Letter page (612 x 792 pt).

export const SHEET = {
  W: 612, H: 792, M: 44,
  frameW: 368,
  frameY: 138,   // frame top — below the header + write-in fields
  headerH: 26,   // frame height = rows * rowPitch(count) + headerH
  gridDy: 20,    // grid top inside the frame
  circleR: 7,
  bubbleGap: 13, // gap between circles
  // The A–D letter printed inside each circle. Its ink lands exactly where the
  // scanner samples, so it raises the ink floor of every bubble equally — the
  // BLANK and MULTI thresholds only survive because that floor stays small.
  // `letterR` is the worst-case ink radius (the synthetic scan test draws a
  // solid patch this size); `letterCap` is Helvetica's cap height, used to
  // centre the letter on the bubble.
  letterR: 1.5, letterCap: 4.7,
  // Fraction of circleR the scanner samples inside, so the label-ink budget
  // below can be reasoned about (and tested) without duplicating the number.
  scanRadiusFrac: 0.85,
  colPad: 20,    // frame edge -> column origin
  rowLabelPad: 43, // column origin -> left edge of the first bubble
  rowLabelGap: 7,  // right edge of the row number -> first bubble
  pitch: 22,     // max row pitch (shrinks for 50-item sheets, see rowPitch)
  letters: ['A', 'B', 'C', 'D'],
  // The four alignment squares the scanner's homography is built from. They
  // are parked in the page margins, outside the printed box, so the answer
  // area holds nothing but the grid and the QR.
  marker: 10, markerGap: 24,
  // QR clearance: the code must never touch the bubble columns or the marker
  // squares, or thresholding merges them into one blob (scan bug). It lives in
  // the frame's bottom band, under the right-hand column — the band is
  // reserved in frameRect so the columns always end above it. qrPadY holds the
  // code clear of the frame's bottom edge so the student's name fits under it
  // (qrCaption) while the code keeps its own 8pt quiet zone.
  qrSize: 76, qrPadX: 28, qrPadY: 20,
  qrBand: 106, // bottom band = QR + its caption line + clearance
}

// The frame is centered on the page — balanced margins like a proper OMR form.
export function frameX() {
  return Math.round((SHEET.W - SHEET.frameW) / 2)
}

// The frame is a FIXED full-page box for every item count — unused rows stay
// blank inside it, exactly like real OMR forms. The QR band at the frame's
// bottom-right stays clear of the columns because the pitch shrinks first.
export const FRAME_H = 600

// Row pitch shrinks for tall sheets so the columns never enter the QR band.
export function rowPitch(count) {
  const rows = bubbleSheetLayout(count).rows
  const avail = FRAME_H - SHEET.gridDy - SHEET.qrBand - 10
  return Math.min(SHEET.pitch, Math.floor((avail / rows) * 10) / 10)
}

export function bubbleSheetLayout(count) {
  const single = count <= 8
  const columns = single
    ? [{ start: 1, count }]
    : [
        { start: 1, count: Math.ceil(count / 2) },
        { start: Math.ceil(count / 2) + 1, count: Math.floor(count / 2) }
      ]
  return {
    single,
    columns,
    rows: Math.max(...columns.map(c => c.count)),
    letters: SHEET.letters
  }
}

export function frameRect() {
  return { x: frameX(), y: SHEET.frameY, w: SHEET.frameW, h: FRAME_H }
}

// Top-left corners of the four alignment squares, in reading order
// TL, TR, BR, BL. They sit in the page margins, clear of the frame.
export function markerRects(count) {
  const f = frameRect()
  const m = SHEET.marker, g = SHEET.markerGap
  return [
    { x: f.x - g - m, y: f.y },
    { x: f.x + f.w + g, y: f.y },
    { x: f.x + f.w + g, y: f.y + f.h - m },
    { x: f.x - g - m, y: f.y + f.h - m },
  ]
}

// Marker centroids in reading order TL, TR, BR, BL — the scanner's four known
// PDF-space points for the homography.
export function markerCenters(count) {
  const c = SHEET.marker / 2
  return markerRects(count).map(r => ({ x: r.x + c, y: r.y + c }))
}

export function columnX(count, colIndex) {
  const f = frameRect()
  const { single } = bubbleSheetLayout(count)
  return f.x + SHEET.colPad + colIndex * ((f.w - SHEET.colPad * 2) / (single ? 1 : 2))
}

// Center of one answer bubble. item is 0-based, letter 0..3 (A–D).
export function bubbleCenter(count, item, letter) {
  const f = frameRect()
  const layout = bubbleSheetLayout(count)
  let col = 0
  let row = item
  for (const c of layout.columns) { if (row < c.count) break; row -= c.count; col++ }
  const x = columnX(count, col) + SHEET.rowLabelPad + letter * (SHEET.circleR * 2 + SHEET.bubbleGap) + SHEET.circleR
  const y = f.y + SHEET.gridDy + row * rowPitch(count)
  return { x, y }
}

// Right edge of a row's number label, so callers can right-align it just left
// of the first bubble.
export function rowLabelRight(count, colIndex) {
  return columnX(count, colIndex) + SHEET.rowLabelPad - SHEET.rowLabelGap
}

export function qrRect(count) {
  const f = frameRect()
  return {
    x: f.x + f.w - SHEET.qrPadX - SHEET.qrSize,
    y: f.y + f.h - SHEET.qrPadY - SHEET.qrSize,
    size: SHEET.qrSize,
  }
}

// The student's roster number and name, printed small in the band under the QR.
// Same fact the code carries, in plain sight: a printed stack can be sorted and
// handed out from the bottom of the page alone, without unfolding the header.
// Right-aligned flush with the code so the two read as one block.
export function qrCaption(count) {
  const f = frameRect()
  const q = qrRect(count)
  return {
    right: q.x + q.size,
    baseline: f.y + f.h - SHEET.letterCap - 2.5,
    maxWidth: q.x + q.size - (f.x + 6),
  }
}

// ── Sheet QR payload (shared by the printer and the scanner) ──
// A blank sheet carries the quiz id and, room permitting, the quiz name (QZ1).
// A sheet printed for a roster student carries the student id and name too
// (QZ2), so scanning attaches the student instead of the teacher picking from
// a list — roster codes stay nameless on the quiz side to keep their module
// count down. The scanner resolves by id first and name second, so codes
// printed before quiz names existed keep working exactly as before.

// The quiz name rides along for humans: pointing a phone camera at the code
// shows "English — Verb Tenses" instead of an opaque id. Pipes are swapped
// out like student names, and the 24-char cap keeps the fixed-size QR at a
// scannable module count (guarded by the capacity tests below).
function cleanQuizName(quizName) {
  return String(quizName || '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim().slice(0, 24)
}

export function sheetQrPayload(quizId, student, quizName) {
  if (!student) {
    const named = cleanQuizName(quizName)
    return `QZ1:${quizId}${named ? '|' + named : ''}`
  }
  const name = String(student.name || '').replace(/\|/g, '/').slice(0, 40)
  return `QZ2:${quizId}|${student.id}|${name}`
}

/**
 * The bundled demo sheet uses stable snapshot keys (`demo-cls-eng`,
 * `demo-quiz-2`) and a roster number instead of the per-account storage ids.
 * That lets one printed demo sheet link to the demo data on any device.
 */
export function demoSheetQrPayload(classKey, quizKey, studentNo) {
  return `QZD1:${classKey}:${quizKey}:${studentNo}`
}

/**
 * The bundled demo PIN half-sheet: the quiz comes from stable snapshot keys
 * (like QZD1) but there is no roster number — the student is whoever shaded
 * the 5-digit PIN, matched inside the demo class.
 */
export function demoPinSheetQrPayload(classKey, quizKey) {
  return `QZD2:${classKey}:${quizKey}`
}

/**
 * @param {string | null} text raw QR contents
 * @returns {{ quizId: string | null, studentId: string | null,
 *   studentName: string | null, quizName: string | null,
 *   demo?: { classKey: string, quizKey: string,
 *   studentNo: number | null }, pinSheet?: boolean } | null}
 *   null for anything that isn't a Quizard sheet code. `pinSheet` marks a
 *   generic QZ3 half-sheet whose student comes from the shaded 5-digit PIN.
 *   `quizName` is the human-readable quiz name newer codes carry (null for
 *   codes printed before names were added, and for demo codes).
 */
export function parseSheetQr(text) {
  if (typeof text !== 'string' || !text) return null
  if (text.startsWith('QZD1:')) {
    const parts = text.slice(5).split(':')
    if (parts.length !== 3) return null
    const [classKey, quizKey, noText] = parts
    const studentNo = Number(noText)
    if (!classKey || !quizKey || !Number.isInteger(studentNo) || studentNo < 1 || studentNo > 999) return null
    return {
      quizId: null,
      studentId: null,
      studentName: null,
      quizName: null,
      demo: { classKey, quizKey, studentNo }
    }
  }
  if (text.startsWith('QZD2:')) {
    // demo PIN half-sheet: quiz via stable demo keys, student via the shaded PIN
    const parts = text.slice(5).split(':')
    if (parts.length !== 2) return null
    const [classKey, quizKey] = parts
    if (!classKey || !quizKey) return null
    return {
      quizId: null,
      studentId: null,
      studentName: null,
      quizName: null,
      demo: { classKey, quizKey, studentNo: null },
      pinSheet: true
    }
  }
  if (text.startsWith('QZ2:')) {
    const first = text.indexOf('|')
    const second = first < 0 ? -1 : text.indexOf('|', first + 1)
    if (first < 0 || second < 0) return null
    const quizId = text.slice(4, first)
    const studentId = text.slice(first + 1, second)
    if (!quizId || !studentId) return null
    return { quizId, studentId, studentName: text.slice(second + 1) || null, quizName: null }
  }
  if (text.startsWith('QZ1:')) {
    // the quiz name, when present, trails the id after the first pipe
    const bar = text.indexOf('|')
    const quizId = bar < 0 ? text.slice(4) : text.slice(4, bar)
    const quizName = bar < 0 ? null : (text.slice(bar + 1) || null)
    return { quizId, studentId: null, studentName: null, quizName }
  }
  if (text.startsWith('QZ3v3:')) {
    const rest = text.slice(7)
    const bar = rest.indexOf('|')
    const quizId = bar < 0 ? rest : rest.slice(0, bar)
    if (!quizId) return null
    const quizName = bar < 0 ? null : (rest.slice(bar + 1) || null)
    return { quizId, studentId: null, studentName: null, quizName, pinSheet: true, pinSheetVersion: 3 }
  }
  if (text.startsWith('QZ3:')) {
    const bar = text.indexOf('|')
    const quizId = bar < 0 ? text.slice(4) : text.slice(4, bar)
    if (!quizId) return null
    // generic PIN half-sheet: the student is identified by the shaded 5-digit
    // PIN, not by anything in the QR
    const quizName = bar < 0 ? null : (text.slice(bar + 1) || null)
    return { quizId, studentId: null, studentName: null, quizName, pinSheet: true }
  }
  return null
}

/**
 * Resolve a roster-printed sheet's student claim against the device roster.
 * The id is the authoritative match. The name is the fallback for a roster
 * re-created on this device (restore or re-import, so the ids differ): a name
 * unique school-wide resolves on its own, a name shared across classes only
 * resolves inside the class being checked, and an ambiguous name otherwise
 * stays unmatched rather than score the wrong student's paper.
 *
 * @template {{ id: string, name: string, classId: string }} T
 * @param {T[]} roster every known student
 * @param {{ studentId: string | null, studentName: string | null } | null} claim parsed QR claim
 * @param {string | null} [sessionClassId] class being checked
 * @returns {T | null}
 */
export function resolveSheetStudent(roster, claim, sessionClassId = null) {
  if (!claim?.studentId || !Array.isArray(roster)) return null
  const byId = roster.find(r => r.id === claim.studentId)
  if (byId) return byId
  const want = claim.studentName?.trim().toLowerCase()
  if (!want) return null
  const same = roster.filter(r => r.name.trim().toLowerCase() === want)
  if (!same.length) return null
  if (same.length === 1) return same[0]
  return same.find(r => r.classId === sessionClassId) || null
}

// ── Generic PIN half-sheets (ZipGrade-style) ────────────────────────────────
// Two identical generic sheets on one Long (8.5×13) page, cut in half. The QR
// carries only the quiz id (QZ3) — the student identifies themselves by
// writing + shading their 5-digit PIN, which the scanner reads and matches to
// the roster. Fixed 50-item grid (2 columns × 25 rows, A–D): one printed form
// serves every quiz up to the engine's 50-item cap; unused rows just stay
// blank and scoring reads the first N answers.

export const PIN_ITEMS = 50

export const PIN_SHEET = {
  W: 612, H: 936,          // long bond paper, two 468pt halves
  marginX: 20,
  frameW: 572, frameH: 452,
  frameTop: [8, 476],      // top half y, bottom half y (cut line at 468)
  // boxed header table, ZipGrade-style: gray label cells + write-in blanks
  headerY: 14, headerRowH: 20, labelW: 42,
  // 10 rows shared by the PIN grid and the item sub-columns
  rowY0: 96, pitch: 24, rows: 10,
  // the 5-digit PIN: 5 write boxes above 5 vertical 0-9 digit strips
  // (row 0 is 9, the highest value — ZipGrade reads 9 down to 0)
  pinX0: 34, pinDx: 21, pinR: 4.6,
  pinDigits: 5, pinRows: 10,
  pinBoxY: 66, pinBoxW: 17, pinBoxH: 12,
  pinLabelY: 58,
  // 5 item sub-columns of 10 (items 1-10, 11-20, ... 41-50)
  itemX0: 150, itemDx: 88, labelPad: 14, labelGap: 5, letterGap: 12.8, circleR: 4.6,
  letters: ['A', 'B', 'C', 'D'],
  letterR: 1.2, letterCap: 4.0,
  scanRadiusFrac: 0.85,
  marker: 7, markerGap: 6,
  // QR sized for distance: the half-sheet's grid ends ~57pt above the frame
  // bottom, so an 80pt code (13% of the sheet width — beyond the Letter
  // sheet's 12.4%) fits clear of every bubble and still reads from across a
  // room. Small codes fall under jsQR's ~2px-per-module floor once a
  // far-framed sheet — or one shown on a laptop screen — hits the preview
  // decode; 80pt keeps the readable floor at ~30% of the camera frame.
  qrSize: 80, qrPadX: 12, qrPadY: 6,
  cutY: 468,
}

export function pinFrameRect(half = 0) {
  return { x: PIN_SHEET.marginX, y: PIN_SHEET.frameTop[half ? 1 : 0], w: PIN_SHEET.frameW, h: PIN_SHEET.frameH }
}

// Markers sit beside the frame's corners, in the page margins (reading order
// TL, TR, BR, BL). Both halves print identical content, so the scanner can
// always use the top-half geometry — a bottom-half photo maps to the same
// local coordinates through the marker homography.
export function pinMarkerRects(half = 0) {
  const f = pinFrameRect(half)
  const m = PIN_SHEET.marker, g = PIN_SHEET.markerGap
  return [
    { x: f.x - g - m, y: f.y, w: m, h: m },
    { x: f.x + f.w + g, y: f.y, w: m, h: m },
    { x: f.x + f.w + g, y: f.y + f.h - m, w: m, h: m },
    { x: f.x - g - m, y: f.y + f.h - m, w: m, h: m },
  ]
}

export function pinMarkerCenters(half = 0) {
  const c = PIN_SHEET.marker / 2
  return pinMarkerRects(half).map(r => ({ x: r.x + c, y: r.y + c }))
}

// Center of one answer bubble. item is 0-based (0..49): sub-column floor(item
// / 10), row item % 10 — ZipGrade numbering 1-10, 11-20, ... 41-50.
export function pinItemCenter(item, letter, half = 0) {
  const col = Math.floor(item / 10)
  const row = item % 10
  const x = pinItemColX(half, col) + PIN_SHEET.labelPad + letter * PIN_SHEET.letterGap + PIN_SHEET.circleR
  const y = pinItemRowY(half, row)
  return { x, y }
}

export function pinItemColX(half = 0, col = 0) {
  const f = pinFrameRect(half)
  return f.x + PIN_SHEET.itemX0 + col * PIN_SHEET.itemDx
}

export function pinItemRowY(half = 0, row = 0) {
  const f = pinFrameRect(half)
  return f.y + PIN_SHEET.rowY0 + row * PIN_SHEET.pitch
}

export function pinRowLabelRight(half = 0, col = 0) {
  return pinItemColX(half, col) + PIN_SHEET.labelPad - PIN_SHEET.labelGap
}

// Write-in box for PIN digit  (0..4) and the bubble for digit value
//  (0..9) — value 9 is the TOP row, 0 the bottom (ZipGrade order).
export function pinWriteBox(half = 0, digit = 0) {
  const f = pinFrameRect(half)
  return {
    x: f.x + PIN_SHEET.pinX0 + digit * PIN_SHEET.pinDx,
    y: f.y + PIN_SHEET.pinBoxY,
    w: PIN_SHEET.pinBoxW,
    h: PIN_SHEET.pinBoxH,
  }
}

export function pinDigitCenter(digit, value, half = 0) {
  const x = pinWriteBox(half, digit).x + PIN_SHEET.pinBoxW / 2
  const y = pinItemRowY(half, 9 - value)
  return { x, y }
}

export function pinQrRect(half = 0) {
  const f = pinFrameRect(half)
  return {
    x: f.x + f.w - PIN_SHEET.qrPadX - PIN_SHEET.qrSize,
    y: f.y + f.h - PIN_SHEET.qrPadY - PIN_SHEET.qrSize,
    size: PIN_SHEET.qrSize,
  }
}

export function pinCutLineY() {
  return PIN_SHEET.cutY
}

/** Generic PIN sheet QR: quiz identity (and name) only — the student comes from the shaded PIN. */
export function pinSheetQrPayload(quizId, quizName) {
  const named = cleanQuizName(quizName)
  return `QZ3:${quizId}${named ? '|' + named : ''}`
}
