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
// A blank sheet carries only the quiz id (QZ1). A sheet printed for a roster
// student carries the student id and name too (QZ2), so scanning attaches the
// student instead of the teacher picking from a list. The scanner resolves by
// id first and name second, so a QZ1 sheet keeps working exactly as before.
export function sheetQrPayload(quizId, student) {
  if (!student) return `QZ1:${quizId}`
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
 * @param {string | null} text raw QR contents
 * @returns {{ quizId: string | null, studentId: string | null,
 *   studentName: string | null, demo?: { classKey: string, quizKey: string,
 *   studentNo: number } } | null}
 *   null for anything that isn't a Quizard sheet code
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
      demo: { classKey, quizKey, studentNo }
    }
  }
  if (text.startsWith('QZ2:')) {
    const first = text.indexOf('|')
    const second = first < 0 ? -1 : text.indexOf('|', first + 1)
    if (first < 0 || second < 0) return null
    const quizId = text.slice(4, first)
    const studentId = text.slice(first + 1, second)
    if (!quizId || !studentId) return null
    return { quizId, studentId, studentName: text.slice(second + 1) || null }
  }
  if (text.startsWith('QZ1:')) return { quizId: text.slice(4), studentId: null, studentName: null }
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
