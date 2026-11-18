import qrModule from 'qrcode-generator'
import {
  SHEET, PIN_SHEET, PIN_ITEMS, bubbleSheetLayout, markerRects, columnX, rowLabelRight,
  bubbleCenter, qrRect, rowPitch, sheetQrPayload, qrCaption,
  pinFrameRect, pinMarkerRects, pinItemCenter, pinRowLabelRight, pinItemColX, pinItemRowY, pinWriteBox, pinDigitCenter,
  pinQrRect, pinSheetQrPayload, pinCutLineY,
} from './sheet-spec.js'
import {
  PIN_SHEET_V3, pinV3MarkerRects, pinV3ItemCenter, pinV3DigitCenter,
  pinV3QrRect, pinV3WriteBox, pinV3SheetQrPayload,
} from './sheet-v3.js'
import { sectionBreakdown } from './reports.js'

export { bubbleSheetLayout } from './sheet-spec.js'

function download(filename, content, mime = 'text/markdown') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

function slug(name) {
  return String(name || 'doc').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'doc'
}

function pdfSafe(s) {
  return String(s || '')
    .replace(/→/g, ' -> ')
    // arrows, dingbats, emoji and variation selectors that the standard PDF
    // fonts cannot render (→ is converted, the rest are dropped)
    .replace(/[\u2190-\u21FF\u2300-\u27BF\uFE0F]|[\uD800-\uDFFF]/g, '')
}

export async function exportClassReportPdf(cls, quiz, sheets, analysis) {
  const pdf = await buildClassReportPdf(cls, quiz, sheets, analysis)
  pdf.save(`quizard-results-${slug(cls.name)}.pdf`)
}

/** Same report as exportClassReportPdf, but returns the document for preview. */
export async function buildClassReportPdf(cls, quiz, sheets, analysis) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = 612, H = 792, M = 48
  let y = 0
  const need = h => { if (y + h > H - M) { pdf.addPage(); y = M } }
  const text = (str, { size = 11, bold = false, color = '#1c2438', gap = 4, indent = 0 } = {}) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal')
    pdf.setFontSize(size)
    pdf.setTextColor(color)
    const lines = pdf.splitTextToSize(pdfSafe(str), W - M * 2 - indent)
    need(lines.length * (size + 3))
    lines.forEach(line => { pdf.text(line, M + indent, y + size); y += size + 3 })
    y += gap
  }

  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor('#17677C')
  pdf.text('Q U I Z A R D   ·   C L A S S   R E S U L T S', M, M + 6)
  y = M + 24
  text(cls.name, { size: 18, bold: true, gap: 2 })
  text(`${quiz.subject}${quiz.title ? ' — ' + quiz.title : ''} · ${sheets.length} sheet${sheets.length === 1 ? '' : 's'} checked`, { size: 10.5, color: '#6b7280', gap: 12 })

  text('Scores', { size: 13, bold: true, gap: 6 })
  const avg = Math.round(sheets.reduce((s, x) => s + x.percent, 0) / (sheets.length || 1))
  text(`Class average: ${avg}%`, { size: 10.5, color: '#6b7280', gap: 8 })
  for (const s of sheets) {
    need(22)
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10.5); pdf.setTextColor('#1c2438')
    pdf.text(pdfSafe(s.studentName), M + 6, y + 10)
    // roster snapshot: number, grade and section travel with the result
    const who = [s.studentNo != null ? `#${s.studentNo}` : '', s.grade, s.section].filter(Boolean).join(' · ')
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor('#9ca3af')
    if (who) pdf.text(pdfSafe(who), M + 6 + pdf.getTextWidth(s.studentName) + 12, y + 10)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10.5); pdf.setTextColor('#1c2438')
    pdf.text(`${s.correct}/${s.total}`, W - M - 90, y + 10)
    pdf.text(`${s.percent}%`, W - M - 34, y + 10)
    y += 16
  }

  const sections = sectionBreakdown(sheets)
  if (sections.length > 1) {
    y += 10
    text('By section', { size: 13, bold: true, gap: 6 })
    for (const g of sections) {
      need(20)
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10.5); pdf.setTextColor('#1c2438')
      pdf.text(pdfSafe(g.section), M + 6, y + 10)
      pdf.setTextColor('#6b7280')
      pdf.text(`${g.count} checked · low ${g.lowest}% · high ${g.highest}%`, M + 120, y + 10)
      pdf.setFont('helvetica', 'bold'); pdf.setTextColor('#1c2438')
      pdf.text(`${g.avg}%`, W - M - 34, y + 10)
      y += 16
    }
  }

  y += 10
  text('Item analysis — questions the class missed most', { size: 13, bold: true, gap: 8 })
  const barW = W - M * 2 - 150
  for (const r of analysis) {
    need(24)
    const q = r.question.length > 42 ? r.question.slice(0, 42) + '…' : r.question
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9.5); pdf.setTextColor('#1c2438')
    pdf.text(`Q${r.n}`, M + 4, y + 9)
    pdf.setFont('helvetica', 'normal')
    pdf.text(pdfSafe(q || `Question ${r.n}`), M + 28, y + 9)
    pdf.setTextColor('#6b7280')
    pdf.text(`${r.missRate}% of ${r.attempted}`, W - M - 96, y + 9)
    pdf.setFillColor('#e9e6f7'); pdf.rect(M + 28, y + 13, barW, 5, 'F')
    pdf.setFillColor('#17677C'); pdf.rect(M + 28, y + 13, barW * r.missRate / 100, 5, 'F')
    y += 22
  }
  if (!analysis.some(r => r.attempted)) text('No attempts recorded yet.', { size: 10, color: '#6b7280' })

  return pdf
}

// ── Student answer review: the full answer list, one page per student ──
// Every question number from 1 to N with the student's letter — green when it
// was right, red when it was wrong (with the keyed answer after the arrow),
// grey when left blank. The teacher sees exactly which numbers each student
// missed and what the right choice was, all on a single page.
export async function exportReviewPdf(quiz, sheets) {
  const pdf = await buildReviewPdf(quiz, sheets)
  pdf.save(`quizard-review-${slug(quiz.subject + (quiz.title ? ' - ' + quiz.title : ''))}.pdf`)
}

/** Same review as exportReviewPdf, but returns the document for preview. */
export async function buildReviewPdf(quiz, sheets) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = 612, H = 792, M = 48
  const LETTERS = ['A', 'B', 'C', 'D', 'E']
  const COLS = 5
  const colW = (W - M * 2) / COLS
  const cellH = 17
  let y = 0
  const need = h => { if (y + h > H - M) { pdf.addPage(); y = M } }

  sheets.forEach((s, si) => {
    // every student starts on a fresh page
    if (si > 0) pdf.addPage()
    y = M
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor('#17677C')
    pdf.text('Q U I Z A R D   ·   A N S W E R   R E V I E W', M, M + 6)
    y = M + 24
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.setTextColor('#1c2438')
    pdf.text(pdfSafe(s.studentName), M, y + 12)
    const score = `${s.correct}/${s.total} · ${s.percent}%`
    pdf.setFontSize(11)
    pdf.text(score, W - M - pdf.getTextWidth(score), y + 12)
    y += 18
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor('#6b7280')
    const who = [s.studentNo != null ? `#${s.studentNo}` : '', s.grade, s.section].filter(Boolean).join(' · ')
    const meta = [quiz.subject + (quiz.title ? ' — ' + quiz.title : ''), who, new Date(s.createdAt).toLocaleDateString()].filter(Boolean).join(' · ')
    pdf.text(pdfSafe(meta), M, y + 8)
    y += 16
    pdf.setFontSize(8.5); pdf.setTextColor('#9ca3af')
    pdf.text('Green — correct · red — wrong, keyed answer after the arrow · grey — left blank', M, y + 8)
    y += 16

    for (let qi = 0; qi < quiz.items.length; qi++) {
      const it = quiz.items[qi]
      const pick = s.answers ? s.answers[qi] : undefined
      const hasPick = pick != null && pick >= 0
      const right = hasPick && pick === it.answerIndex
      if (qi % COLS === 0) need(cellH)
      const x = M + (qi % COLS) * colW
      const n = it.n || qi + 1
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor('#9ca3af')
      pdf.text(`${n}.`, x, y + 10)
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11)
      pdf.setTextColor(!hasPick ? '#9ca3af' : right ? '#15803d' : '#b91c1c')
      pdf.text(hasPick ? LETTERS[pick] : '—', x + 22, y + 10)
      if (!right && it.answerIndex != null && it.answerIndex >= 0) {
        // the miss shows its correction: the keyed letter, in green
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor('#15803d')
        pdf.text(`-> ${LETTERS[it.answerIndex]}`, x + 40, y + 10)
      }
      if (qi % COLS === COLS - 1 || qi === quiz.items.length - 1) y += cellH
    }
  })
  return pdf
}

// ── Teacher app exports (PLAN.md Phase 2): quiz paper, teacher key, bubble sheets ──
// Geometry lives in sheet-spec.js — the Phase 3 scanner samples the same
// constants, so the printed sheet and the scanner agree by construction.

function bubbleQr(pdf, text, x, y, size, level = 'M') {
  // qrcode-generator is CJS; esbuild interop gives us the factory
  const qrFactory = qrModule.default || qrModule
  // Student names are user text (José, Ñoño, emoji). The default encoder is
  // latin-1 (charCode & 0xff), which produces bytes that are invalid UTF-8 —
  // and the scanner's jsQR decodes byte mode as UTF-8, so those QRs silently
  // fail to decode at scan time. Encode as real UTF-8 instead.
  if (qrFactory.stringToBytesFuncs && qrFactory.stringToBytesFuncs['UTF-8']) {
    qrFactory.stringToBytes = qrFactory.stringToBytesFuncs['UTF-8']
  }
  const qr = qrFactory(0, level)
  qr.addData(text)
  qr.make()
  const cells = qr.getModuleCount()
  const cell = size / cells
  pdf.setFillColor('#0b0820')
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      if (qr.isDark(r, c)) pdf.rect(x + c * cell, y + r * cell, cell + 0.2, cell + 0.2, 'F')
    }
  }
}

// The scannable answer sheet. One clean bordered box holding nothing but the
// numbered bubble grid, the student-number strip and the QR; a compact header
// lockup above and write-in rules below. Every coordinate comes from
// sheet-spec.js, which the Phase 3 scanner also samples, so what is printed is
// what is read back.
/**
 * @typedef {'letter' | 'a4' | 'long'} PaperSize
 */
const PAPER = { letter: [612, 792], a4: [595, 842], long: [612, 936] }

function sheetHeader(pdf, quiz, student) {
  const right = SHEET.W - SHEET.M

  // left lockup: purple roundel + wordmark + tagline
  pdf.setFillColor('#17677C'); pdf.circle(SHEET.M + 11, 30, 11, 'F')
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13); pdf.setTextColor('#ffffff')
  pdf.text('Q', SHEET.M + 11, 34.5, { align: 'center' })
  pdf.setFontSize(15); pdf.setTextColor('#1c2438')
  pdf.text('Q U I Z A R D', SHEET.M + 30, 34)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6); pdf.setTextColor('#9ca3af')
  pdf.text('P R I N T A B L E   A N S W E R   S H E E T S', SHEET.M + 31, 44)

  // quiz title, plus the one instruction that matters (dropped if it crowds)
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12.5); pdf.setTextColor('#1c2438')
  const title = pdfSafe(quiz.subject + (quiz.title ? ' — ' + quiz.title : ''))
  pdf.text(title, SHEET.M, 66)
  const hint = 'Shade ONE circle per row fully with pen or pencil.'
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5)
  const room = SHEET.W - SHEET.M * 2 - pdf.getTextWidth(title) - 20
  if (room > pdf.getTextWidth(hint)) {
    pdf.setTextColor('#6b7280')
    pdf.text(hint, right, 66, { align: 'right' })
  }

  // write-in fields at the top, under the title: who + when + where
  const rule = (label, x, w, y) => {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9.5); pdf.setTextColor('#1c2438')
    pdf.text(label, x, y)
    pdf.setDrawColor('#9ca3af'); pdf.setLineWidth(0.7)
    pdf.line(x + pdf.getTextWidth(label) + 6, y + 2.5, x + w, y + 2.5)
  }
  rule('Student Name:', SHEET.M, 300, 92)
  if (student?.name) {
    // roster sheets print the name on the rule, so the stack can be verified
    // by eye before any scanning happens
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor('#1c2438')
    const nameX = SHEET.M + pdf.getTextWidth('Student Name:') + 12
    const cap = 300 - (nameX - SHEET.M) - 4
    let nm = String(student.name)
    if (pdf.getTextWidth(nm) > cap) {
      while (nm.length > 4 && pdf.getTextWidth(nm + '…') > cap) nm = nm.slice(0, -1)
      nm += '…'
    }
    pdf.text(nm, nameX, 92)
  }
  rule('Date:', 360, 110, 92)
  rule('Grade & Section:', SHEET.M, 240, 114)
}

// Builds the bubble-sheet document (preview renders this; export saves it).
// Sheets are printed per roster student — exactly one page per student on the
// class, never blanks — because the QR on each sheet is what tells the scanner
// whose paper it is.
export async function buildBubbleSheetsPdf(quiz, students, size = 'letter') {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: PAPER[size] || PAPER.letter })
  const count = quiz.items.length
  const roster = Array.isArray(students) ? students : []
  const pages = Math.max(1, roster.length)

  for (let copy = 0; copy < pages; copy++) {
    if (copy > 0) pdf.addPage()
    const student = roster[copy] || null

    sheetHeader(pdf, quiz, student)

    // No printed border: the corner squares and QR are the scanner anchors.
    // A heavy border also prints faint or clipped on real paper and is no
    // longer required for alignment.

    // alignment squares, parked in the page margins so the sheet stays clean
    pdf.setFillColor('#0b0820')
    for (const m of markerRects(count)) pdf.rect(m.x, m.y, SHEET.marker, SHEET.marker, 'F')

    // QR: identifies the quiz — name and all, so a phone camera shows
    // "English — Verb Tenses" instead of an opaque id — and the student when
    // printed for a roster. A name makes the payload long, so roster sheets
    // drop to level L — fewer modules keeps the cell size large enough to
    // scan from a phone photo.
    const qr = qrRect(count)
    const quizLabel = quiz.subject + (quiz.title ? ' — ' + quiz.title : '')
    bubbleQr(pdf, sheetQrPayload(quiz.id, student, quizLabel), qr.x, qr.y, qr.size, student ? 'L' : 'M')

    // the roster number and name in plain sight under the code, so a printed
    // stack can be sorted and handed out from the bottom of the page alone
    if (student?.name) {
      const cap = qrCaption(count)
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor('#6b7280')
      let who = [student.no != null ? '#' + student.no : '', student.name].filter(Boolean).join(' ')
      if (pdf.getTextWidth(who) > cap.maxWidth) {
        while (who.length > 4 && pdf.getTextWidth(who + '…') > cap.maxWidth) who = who.slice(0, -1)
        who += '…'
      }
      pdf.text(who, cap.right, cap.baseline, { align: 'right' })
    }

    // bubble grid: small grey numerals right-aligned against four circles
    const layout = bubbleSheetLayout(count)
    let idx = 0
    layout.columns.forEach((col, ci) => {
      for (let r = 0; r < col.count; r++) {
        const qy = bubbleCenter(count, idx, 0).y
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor('#6b7280')
        pdf.text(String(col.start + r), rowLabelRight(count, ci), qy + 2.6, { align: 'right' })
        pdf.setDrawColor('#0b0820'); pdf.setLineWidth(1.1)
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5); pdf.setTextColor('#6b7280')
        for (let b = 0; b < SHEET.letters.length; b++) {
          const bc = bubbleCenter(count, idx, b)
          pdf.circle(bc.x, bc.y, SHEET.circleR, 'S')
          // letter centred on the cap height so it reads as part of the bubble
          pdf.text(SHEET.letters[b], bc.x, bc.y + SHEET.letterCap / 2, { align: 'center' })
        }
        idx++
      }
    })

  }

  return pdf
}

export async function exportBubbleSheets(quiz, students, size = 'letter') {
  const pdf = await buildBubbleSheetsPdf(quiz, students, size)
  pdf.save(`quizard-bubble-sheets-${slug(quiz.subject || quiz.title)}.pdf`)
}

// ── Generic PIN half-sheets (ZipGrade-style) ────────────────────────────────
// Two identical generic sheets per Long page, cut in half. The QR carries only
// the quiz id; each student is identified by the 5-digit PIN they write and
// shade on their half. Fixed 50-item grid — one printed form serves any quiz.

function drawPinHalf(pdf, quiz, half, className, qrPayload) {
  const f = pinFrameRect(half)
  const P = PIN_SHEET

  // corner alignment squares — the scanner's homography is built from these.
  // No printed border: it is optional with a QR and often prints faint/clipped.
  pdf.setFillColor('#0b0820')
  for (const m of pinMarkerRects(half)) pdf.rect(m.x, m.y, m.w, m.h, 'F')

  // boxed header table (ZipGrade-style): gray label cells, printed Class/Quiz
  const hx = f.x + 8, hy = f.y + 8, rowH = P.headerRowH, lw = P.labelW, hw = f.w - 16
  const labelCell = (x, y, text) => {
    pdf.setFillColor('#d1d5db'); pdf.rect(x, y, lw, rowH, 'FD')
    pdf.setDrawColor('#374151'); pdf.setLineWidth(0.7); pdf.rect(x, y, lw, rowH, 'S')
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor('#1c2438')
    pdf.text(text, x + 4, y + rowH / 2 + 2.3)
  }
  const blankCell = (x, y, w, printed) => {
    pdf.setDrawColor('#374151'); pdf.setLineWidth(0.7); pdf.rect(x, y, w, rowH, 'S')
    if (printed) {
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7); pdf.setTextColor('#1c2438')
      let t = pdfSafe(printed)
      const cap = w - 8
      while (pdf.getTextWidth(t) > cap && t.length > 4) t = t.slice(0, -1)
      pdf.text(t, x + 4, y + rowH / 2 + 2.6)
    }
  }
  const r1 = hy, r2 = hy + rowH
  labelCell(hx, r1, 'Name'); blankCell(hx + lw, r1, 300); labelCell(hx + lw + 300, r1, 'Date'); blankCell(hx + lw + 300 + lw, r1, hw - lw * 3 - 300 - 6)
  labelCell(hx, r2, 'Subject'); blankCell(hx + lw, r2, 300, quiz.subject); labelCell(hx + lw + 300, r2, 'Quiz'); blankCell(hx + lw + 300 + lw, r2, hw - lw * 3 - 300 - 6, quiz.title)

  // form label + the pin instruction
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor('#1c2438')
  pdf.text('Form 50-P', hx, r2 + rowH + 10)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6); pdf.setTextColor('#6b7280')
  pdf.text('Write each PIN digit in its box, then shade the same number below it.', hx + 40, r2 + rowH + 10)

  // column headers: PIN write boxes above the digit strips, black square +
  // A B C D letters above every item sub-column (ZipGrade look)
  for (let d = 0; d < P.pinDigits; d++) {
    const box = pinWriteBox(half, d)
    pdf.setDrawColor('#0b0820'); pdf.setLineWidth(0.9)
    pdf.rect(box.x, box.y, box.w, box.h, 'S')
  }
  for (let c = 0; c < 5; c++) {
    const sq = 5
    pdf.setFillColor('#0b0820')
    pdf.rect(pinItemColX(half, c) - 1, f.y + P.rowY0 - 20, sq, sq, 'F')
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor('#1c2438')
    for (let b = 0; b < P.letters.length; b++) {
      const bc = pinItemCenter(c * 10, b, half)
      pdf.text(P.letters[b], bc.x, f.y + P.rowY0 - 12 + P.letterCap / 2, { align: 'center' })
    }
  }

  // 10 rows: PIN digit bubbles (9 at the top, 0 at the bottom) + item bubbles
  pdf.setDrawColor('#0b0820'); pdf.setLineWidth(0.9)
  for (let r = 0; r < P.rows; r++) {
    const value = 9 - r
    for (let d = 0; d < P.pinDigits; d++) {
      const c = pinDigitCenter(d, value, half)
      pdf.circle(c.x, c.y, P.pinR, 'S')
      if (d === 0) {
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(4.8); pdf.setTextColor('#6b7280')
        pdf.text(String(value), c.x - P.pinR - 3, c.y + 1.6, { align: 'right' })
      }
    }
    for (let c = 0; c < 5; c++) {
      const item = c * 10 + r
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6); pdf.setTextColor('#6b7280')
      pdf.text(String(item + 1), pinRowLabelRight(half, c), pinItemRowY(half, r) + 2, { align: 'right' })
      for (let b = 0; b < P.letters.length; b++) {
        const bc = pinItemCenter(item, b, half)
        pdf.circle(bc.x, bc.y, P.circleR, 'S')
        pdf.text(P.letters[b], bc.x, bc.y + P.letterCap / 2, { align: 'center' })
      }
    }
  }

  // Footer band below the grid: non-scanned helper + teacher score box. It
  // stays below the last bubble row (y=312) and left of the QR (x=500), so the
  // printed OMR geometry and the code's quiet zone are untouched.
  const footY = f.y + 322, footH = 116
  pdf.setDrawColor('#9ca3af'); pdf.setLineWidth(0.6)
  pdf.rect(f.x + 8, footY, 250, footH, 'S')
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor('#1c2438')
  pdf.text('How to shade', f.x + 14, footY + 12)
  pdf.setDrawColor('#0b0820'); pdf.setLineWidth(0.9)
  pdf.circle(f.x + 20, footY + 27, 4.6, 'S')
  pdf.setFillColor('#0b0820')
  pdf.circle(f.x + 20, footY + 27, 4.1, 'F')
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5); pdf.setTextColor('#1c2438')
  pdf.text('Shade one letter per item.', f.x + 30, footY + 30)
  pdf.setTextColor('#6b7280')
  pdf.text('Erase changes completely.', f.x + 14, footY + 48)
  pdf.setFontSize(6)
  pdf.text('Keep the QR and corner marks clear.', f.x + 14, footY + 64)
  pdf.setFontSize(6.5)
  pdf.text('One answer per item.', f.x + 14, footY + 80)

  pdf.setDrawColor('#9ca3af'); pdf.setLineWidth(0.6)
  pdf.rect(f.x + 266, footY, 204, footH, 'S')
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor('#1c2438')
  pdf.text('For teacher use', f.x + 272, footY + 12)
  pdf.setFont('helvetica', 'normal')
  pdf.text('Score: ______ / 50', f.x + 272, footY + 30)
  pdf.text('Percentage: ______ %', f.x + 272, footY + 46)
  pdf.text('Checked by: __________', f.x + 272, footY + 62)
  pdf.setTextColor('#6b7280')
  pdf.text('Remarks: _____________', f.x + 272, footY + 78)
  pdf.text('Date: ________________', f.x + 272, footY + 94)

  // QR bottom-right: quiz identity only (QZ3) — the PIN names the student
  const qr = pinQrRect(half)
  bubbleQr(pdf, qrPayload || pinSheetQrPayload(quiz.id, quiz.subject + (quiz.title ? ' — ' + quiz.title : '')), qr.x, qr.y, qr.size, 'M')
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6); pdf.setTextColor('#374151')

}

export async function buildPinSheetsPdf(quiz, students, size = 'long', className = '', qrPayload = '') {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: PAPER[size] || PAPER.long })
  const roster = Array.isArray(students) ? students : []
  const pages = Math.max(1, Math.ceil(roster.length / 2))

  for (let copy = 0; copy < pages; copy++) {
    if (copy > 0) pdf.addPage()

    // dashed cut line between the two halves
    pdf.setDrawColor('#9ca3af'); pdf.setLineWidth(0.8)
    pdf.setLineDashPattern([6, 5], 0)
    pdf.line(10, pinCutLineY(), PIN_SHEET.W - 10, pinCutLineY())
    pdf.setLineDashPattern([], 0)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5); pdf.setTextColor('#9ca3af')
    pdf.text('cut here', PIN_SHEET.W - 12, pinCutLineY() - 4, { align: 'right' })

    drawPinHalf(pdf, quiz, 0, className, qrPayload)
    drawPinHalf(pdf, quiz, 1, className, qrPayload)
  }

  return pdf
}

function drawPinHalfV3(pdf, quiz, half, className, qrPayload) {
  const P = PIN_SHEET_V3
  const dy = half ? P.halfH : 0
  const y = v => v + dy
  const contentX = P.content.x
  const contentW = P.content.w
  const rowH = 18
  const labelW = 36

  // 10 mm anchors, no printed border.
  pdf.setFillColor('#0b0820')
  for (const m of pinV3MarkerRects(half)) pdf.rect(m.x, m.y, m.w, m.h, 'F')

  const labelCell = (x, ry, text) => {
    pdf.setFillColor('#d1d5db'); pdf.rect(x, y(ry), labelW, rowH, 'FD')
    pdf.setDrawColor('#374151'); pdf.setLineWidth(0.7); pdf.rect(x, y(ry), labelW, rowH, 'S')
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor('#1c2438')
    pdf.text(text, x + 4, y(ry + rowH / 2 + 2.3))
  }
  const blankCell = (x, ry, w, printed) => {
    pdf.setDrawColor('#374151'); pdf.setLineWidth(0.7); pdf.rect(x, y(ry), w, rowH, 'S')
    if (printed) {
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7); pdf.setTextColor('#1c2438')
      let t = pdfSafe(printed)
      const cap = w - 8
      while (pdf.getTextWidth(t) > cap && t.length > 4) t = t.slice(0, -1)
      pdf.text(t, x + 4, y(ry + rowH / 2 + 2.6))
    }
  }

  const hx = contentX, hy = P.content.y
  labelCell(hx, hy, 'Name'); blankCell(hx + labelW, hy, contentW - labelW, '')
  labelCell(hx, hy + rowH, 'Subject'); blankCell(hx + labelW, hy + rowH, 128, quiz.subject)
  labelCell(hx + labelW + 128, hy + rowH, 'Quiz'); blankCell(hx + labelW + 164, hy + rowH, contentW - labelW - 164, quiz.title)

  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7); pdf.setTextColor('#1c2438')
  pdf.text('Form 50-P v3', hx, y(hy + 44))
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6); pdf.setTextColor('#6b7280')
  pdf.text('Write each PIN digit in its box, then shade the same number below.', hx + 58, y(hy + 45))

  // PIN write boxes and digit strips
  pdf.setDrawColor('#0b0820'); pdf.setLineWidth(0.9)
  for (let d = 0; d < P.pinDigits; d++) {
    const b = pinV3WriteBox(half, d)
    pdf.rect(b.x, b.y, b.w, b.h, 'S')
  }
  for (let r = 0; r < P.pinRows; r++) {
    const value = 9 - r
    for (let d = 0; d < P.pinDigits; d++) {
      const c = pinV3DigitCenter(d, value, half)
      pdf.circle(c.x, c.y, P.pinR, 'S')
      if (d === 0) {
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(5); pdf.setTextColor('#6b7280')
        pdf.text(String(value), c.x - P.pinR - 3, c.y + 1.6, { align: 'right' })
      }
    }
  }

  // Distinct horizontal bars above item columns; no extra square anchors.
  pdf.setFillColor('#0b0820')
  for (let c = 0; c < 5; c++) {
    pdf.rect(P.itemX0 + c * P.itemDx + 6, y(P.itemRowY0 - 12), 18, 4, 'F')
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor('#1c2438')
    for (let b = 0; b < 4; b++) {
      const bc = pinV3ItemCenter(c * 10, b, half)
      pdf.text(P.letters[b], bc.x, y(P.itemRowY0 - 6), { align: 'center' })
    }
  }

  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 5; c++) {
      const item = c * 10 + r
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(5.5); pdf.setTextColor('#6b7280')
      pdf.text(String(item + 1), P.itemX0 + c * P.itemDx - 2, y(P.itemRowY0 + r * P.itemPitch - 5), { align: 'right' })
      for (let b = 0; b < 4; b++) {
        const bc = pinV3ItemCenter(item, b, half)
        pdf.setDrawColor('#0b0820'); pdf.setLineWidth(0.8)
        pdf.circle(bc.x, bc.y, P.circleR, 'S')
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(5.5); pdf.setTextColor('#6b7280')
        pdf.text(P.letters[b], bc.x, bc.y + 1.8, { align: 'center' })
      }
    }
  }

  const qr = pinV3QrRect(half)
  bubbleQr(pdf, qrPayload || pinV3SheetQrPayload(quiz.id, quiz.subject + (quiz.title ? ' — ' + quiz.title : '')), qr.x, qr.y, qr.size, 'M')
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6); pdf.setTextColor('#6b7280')
  pdf.text('QZ3 v3', qr.x, qr.y - 4)
}

export async function buildPinSheetsV3Pdf(quiz, students, size = 'long', className = '', qrPayload = '') {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: PAPER[size] || PAPER.long })
  const roster = Array.isArray(students) ? students : []
  const pages = Math.max(1, Math.ceil(roster.length / 2))
  for (let copy = 0; copy < pages; copy++) {
    if (copy > 0) pdf.addPage()
    pdf.setDrawColor('#9ca3af'); pdf.setLineWidth(0.8)
    pdf.setLineDashPattern([6, 5], 0)
    pdf.line(10, PIN_SHEET_V3.cutY, PIN_SHEET_V3.W - 10, PIN_SHEET_V3.cutY)
    pdf.setLineDashPattern([], 0)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5); pdf.setTextColor('#9ca3af')
    pdf.text('cut here', PIN_SHEET_V3.W - 12, PIN_SHEET_V3.cutY - 4, { align: 'right' })
    drawPinHalfV3(pdf, quiz, 0, className, qrPayload)
    drawPinHalfV3(pdf, quiz, 1, className, qrPayload)
  }
  return pdf
}

export async function exportPinSheets(quiz, students, size = 'long', version = 'v2') {
  const pdf = version === 'v3'
    ? await buildPinSheetsV3Pdf(quiz, students, size)
    : await buildPinSheetsPdf(quiz, students, size)
  pdf.save(`quizard-pin-sheets-${slug(quiz.subject || quiz.title)}-${version}.pdf`)
}

export async function buildPinListPdf(cls) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: PAPER.letter })
  const students = [...(cls?.students || [])].sort((a, b) => (a.no || 0) - (b.no || 0))

  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor('#1c2438')
  pdf.text('Student PIN list', 48, 56)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor('#6b7280')
  const meta = [cls?.name, cls?.schoolYear].filter(Boolean).join(' · ')
  pdf.text(pdfSafe(meta), 48, 74)
  pdf.setFontSize(8); pdf.setTextColor('#9ca3af')
  pdf.text('Students write this PIN (and shade its digits) on every PIN answer sheet.', 48, 90)

  const y0 = 116
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor('#1c2438')
  pdf.text('No', 48, y0); pdf.text('Student name', 88, y0); pdf.text('PIN', 420, y0)
  pdf.setDrawColor('#d1d5db'); pdf.setLineWidth(0.7)
  pdf.line(48, y0 + 5, 480, y0 + 5)

  let y = y0 + 20
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10)
  for (const st of students) {
    pdf.setTextColor('#1c2438')
    pdf.text(String(st.no ?? ''), 48, y)
    const name = pdfSafe(st.name)
    pdf.text(name, 88, y)
    pdf.setFont('courier', 'bold')
    pdf.text(st.pin || '—', 420, y)
    pdf.setFont('helvetica', 'normal')
    y += 22
    if (y > 760) { pdf.addPage(); y = 60 }
  }
  if (!students.length) {
    pdf.setFontSize(10); pdf.setTextColor('#6b7280')
    pdf.text('No students on this roster yet.', 48, y)
  }
  return pdf
}

export async function exportPinListPdf(cls) {
  const pdf = await buildPinListPdf(cls)
  const filename = `quizard-pin-list-${slug(cls?.name || '')}.pdf`
  const { Capacitor } = await import('@capacitor/core')
  if (!Capacitor.isNativePlatform()) {
    pdf.save(filename)
    return
  }
  // The Android WebView cannot download a blob: write the PDF to the app
  // cache and open the system share sheet — save to Files, send to a
  // printer, or forward it to the class group chat.
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')
  const dataUri = pdf.output('datauristring')
  const data = dataUri.slice(dataUri.indexOf(',') + 1)
  const file = await Filesystem.writeFile({
    path: filename,
    data,
    directory: Directory.Cache,
    recursive: true,
  })
  await Share.share({
    title: 'PIN list',
    text: filename,
    files: [file.uri],
    dialogTitle: 'Save or print the PIN list',
  })
}
