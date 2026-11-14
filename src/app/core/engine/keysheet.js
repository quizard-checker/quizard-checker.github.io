// Spreadsheet → answer key import for the Create page. A teacher keeps the
// key in Excel with one question per row, in (her words) "6 columns including
// the choices and the answer":
//
//   | question | choice A | choice B | choice C | choice D | answer |
//
// module shape: read the sheet into plain rows (CSV text or real .xlsx via
// jszip), then lay the rows out as key text the existing parseKeyText already
// understands — full MCQ blocks when choices exist, "question → answer" lines
// when a row has no usable choices. Handles the forgiving end of the spectrum:
// header rows, missing middle choices (letters keep their positions), answers
// written as a letter ("B"), as the choice's text ("Nucleus"), or as
// "B. Nucleus".
import JSZip from 'jszip'

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function xmlDecode(s) {
  return String(s || '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => XML_ENTITIES[n])
}

// Column reference "AF12" → 0-based column index (A=0).
export function colIndex(ref) {
  const letters = /^([A-Za-z]+)/.exec(String(ref || ''))
  if (!letters) return null
  let n = 0
  for (const ch of letters[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

// One sharedStrings.xml → the ordered string table; <si> items concatenate
// their rich-text <t> runs.
export function sharedStringsXmlToList(xml) {
  const list = []
  const sis = xml.match(/<si\b[^>]*>[\s\S]*?<\/si>/g) || []
  for (const si of sis) {
    let s = ''
    for (const m of si.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) s += m[1]
    list.push(xmlDecode(s))
  }
  return list
}

// One worksheet's XML → dense rows of cell strings. t="s" indexes the shared
// table, inline strings carry their own <t>, everything else reads <v> raw.
export function sheetXmlToRows(sheetXml, shared) {
  const rows = []
  for (const rm of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = []
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]
      const body = cm[2] || ''
      const idx = colIndex(/r="([^"]*)"/.exec(attrs)?.[1])
      if (idx == null) continue
      const t = /t="([^"]*)"/.exec(attrs)?.[1] || ''
      let val = ''
      if (t === 's') {
        const v = parseInt(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '', 10)
        val = Number.isInteger(v) ? (shared[v] ?? '') : ''
      } else if (t === 'inlineStr') {
        for (const m of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) val += m[1]
        val = xmlDecode(val)
      } else if (t === 'b') {
        val = /<v>\s*1\s*<\/v>/.test(body) ? 'TRUE' : 'FALSE'
      } else {
        val = xmlDecode(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1]?.trim() ?? '')
      }
      cells[idx] = String(val).trim()
    }
    rows.push(Array.from({ length: cells.length }, (_, i) => cells[i] || ''))
  }
  return rows
}

// A real .xlsx (it's a zip of XML sheets) → rows of its first worksheet.
// .xls (the old binary format) is rejected by the caller with a clear
// message — the teacher re-saves as .xlsx or exports CSV.
export async function xlsxToRows(data) {
  let zip
  try {
    zip = await JSZip.loadAsync(data)
  } catch {
    throw new Error('That file is not a readable .xlsx — re-save it from Excel as .xlsx, or export CSV')
  }
  const sharedFile = zip.file('xl/sharedStrings.xml')
  const shared = sharedStringsXmlToList(sharedFile ? await sharedFile.async('string') : '')
  // first worksheet: follow workbook.xml + rels when present, else sheet1
  let sheetPath = 'xl/worksheets/sheet1.xml'
  const wbFile = zip.file('xl/workbook.xml')
  const relsFile = zip.file('xl/_rels/workbook.xml.rels')
  if (wbFile && relsFile) {
    const firstRid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(await wbFile.async('string'))?.[1]
    if (firstRid) {
      const rels = await relsFile.async('string')
      const target = new RegExp(`[^>]*Id="${firstRid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1]
      if (target) sheetPath = 'xl/' + target.replace(/^\/?(xl\/)?/, '').replace(/^\//, '')
    }
  }
  const sheetFile = zip.file(sheetPath)
  if (!sheetFile) throw new Error('That .xlsx has no worksheet — re-save it from Excel')
  return sheetXmlToRows(await sheetFile.async('string'), shared)
}

// Delimiter-agnostic CSV: sniff , ; or tab, honour double-quoted cells.
export function parseCsv(text) {
  const raw = String(text || '')
  const counts = { ',': 0, ';': 0, '\t': 0 }
  for (const ch of raw) if (ch in counts) counts[ch]++
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (quoted) {
      if (ch === '"') {
        if (raw[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += ch
    } else if (ch === '"') {
      quoted = true
    } else if (ch === delim) {
      row.push(cell); cell = ''
    } else if (ch === '\n') {
      row.push(cell); rows.push(row); row = []; cell = ''
    } else if (ch !== '\r') {
      cell += ch
    }
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

// ── rows → key text ─────────────────────────────────────────────────────────
const HEADER_WORDS = /^(questions?|answer|answers|answer\s*key|key|sagot|correct\s*answer|no\.?|items?)$/i
const LEADING_NUMBER = /^\d{1,3}\s*[.):\-–—]\s*/
const CHOICE_PREFIX = /^\*?\(?([A-Da-d])[\).]\s+/

// A header row says its own names: "Question | Choice A | … | Answer". A data
// row never has two of those words, nor — once three cells deep — mostly
// single A–D letters. Two-word headers like "No | Answer" count too.
function isHeaderRow(cells) {
  const words = cells.map(c => String(c || '').trim()).filter(Boolean)
  if (!words.length) return false
  const singles = words.filter(w => /^[A-Da-d]$/.test(w)).length
  const named = words.filter(w => HEADER_WORDS.test(w) || /^(choice|option)\s*[a-d1-4]?$/i.test(w)).length
  return named >= 2 || (words.length >= 3 && singles >= 3)
}

function stripChoicePrefix(cell) {
  const s = String(cell || '').trim()
  const m = CHOICE_PREFIX.exec(s)
  return (m ? s.slice(m[0].length) : s).replace(/\s+/g, ' ')
}

function resolveAnswerLetter(ans, choices) {
  const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
  const raw = String(ans || '').trim()
  if (/^[A-Da-d]$/.test(raw)) return raw.toUpperCase()
  // the letter-prefixed form ("B. Nucleus", "(B) Nucleus") pins the letter —
  // trusted when the tail text agrees with (or is irrelevant to) the choices
  const lm = /^\*?\(?([A-Da-d])\)?\s*[.):\-–—]\s*(.+)$/.exec(raw)
  if (lm) {
    const tail = norm(lm[2])
    const known = choices.some(c => norm(c))
    if (!tail || !known || choices.some(c => norm(c) === tail)) return lm[1].toUpperCase()
  }
  const text = norm(raw)
  if (!text) return null
  const exact = choices.findIndex(c => norm(c) === text)
  if (exact >= 0) return 'ABCD'[exact]
  const partial = choices.findIndex(c => norm(c) && (norm(c).startsWith(text) || text.startsWith(norm(c))))
  return partial >= 0 ? 'ABCD'[partial] : null
}

// The first data row after a header drops a leading "No." column, so
// "No. | Question | A | B | C | Answer" lines up like the plain 6-column form.
// A two-column "No | Answer" sheet has no question column to line up.
function hasNumberColumn(header) {
  return header.length >= 4
    && /^(no\.?|#|number|\d+\s*\.?)$/i.test(String(header?.[0] || '').trim())
    && String(header?.[1] || '').trim().length > 0
}

/**
 * Rows → text parseKeyText understands: one MCQ block per 6-column row
 * (correct choice starred), "question → answer" for choice-less rows, the
 * keyed "1. B. Nucleus" shape when the answer carries the old paper's letter.
 * @returns {{ text: string, count: number, skipped: number }}
 */
export function rowsToKeyText(rows) {
  const out = []
  let n = 0
  let skipped = 0
  const clean = (rows || [])
    .map(r => r.map(c => String(c == null ? '' : c).trim()))
    .filter(r => r.some(c => c))
  let dropNumberCol = false
  if (clean.length && isHeaderRow(clean[0])) {
    dropNumberCol = hasNumberColumn(clean[0])
    clean.shift()
    if (dropNumberCol) clean.forEach(r => r.shift())
  }
  // the classic two-column key — "1|A", "2|D", … — is a plain letter key;
  // emit it in the compact "1.A 2.D" shape parseKeyText reads directly
  const letterRows = clean.filter(r => r.length === 2
    && /^[A-Da-d]$/.test(r[1]) && /^\d{1,3}$/.test(r[0]))
  if (clean.length && letterRows.length === clean.length) {
    const line = letterRows.map(r => `${parseInt(r[0], 10)}.${r[1].toUpperCase()}`).join(' ')
    return { text: line, count: letterRows.length, skipped: 0 }
  }
  for (const filled of clean) {
    const question = (filled[0] || '').replace(LEADING_NUMBER, '').trim()
    const answer = filled[filled.length - 1] || ''
    // position slots keep their A–D letters even when a middle choice is blank
    const cols = filled.length > 2
      ? filled.slice(1, filled.length - 1).map(stripChoicePrefix)
      : []
    const usable = cols.filter(Boolean).length
    if (!question || !answer) { skipped++; continue }
    const letter = resolveAnswerLetter(answer, cols)
    if (usable >= 2 && letter) {
      const at = 'ABCD'.indexOf(letter)
      if (!cols[at]) { skipped++; continue } // the letter points at a blank cell
      n++
      out.push(`${n}. ${question}`)
      cols.forEach((c, i) => {
        if (c) out.push(`${i === at ? '*' : ''}${'ABCD'[i]}. ${c}`)
      })
    } else if (letter) {
      // the answer names its letter ("B. Nucleus", or matches the one choice
      // given) → keep the keyed shape instead of burying the letter in text
      const tail = /^\*?\(?[A-Da-d]\)?\s*[.):\-–—]\s*(.+)$/.exec(answer)?.[1] || ''
      const text = cols['ABCD'.indexOf(letter)] || tail.replace(/\s+/g, ' ').trim()
      if (text) { n++; out.push(`${n}. ${letter}. ${text}`) }
      else if (!usable) {
        // a bare letter next to its question — the anchor engine treats this
        // as a scoring-grid row, so the question/answer line is the right shape
        n++
        out.push(`${n}. ${question} → ${letter}`)
      } else skipped++ // a letter past the row's choices is a contradiction
    } else if (usable < 2) {
      // no usable choices → the question/answer line a teacher would paste
      n++
      out.push(`${n}. ${question} → ${answer}`)
    } else {
      // choices exist but the answer names none of them — likely a typo
      skipped++
    }
  }
  return { text: out.join('\n'), count: n, skipped }
}
