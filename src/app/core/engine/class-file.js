// Class file import for Add class / Edit roster.
//
// The downloadable Excel template mirrors the Add class sheet:
//
//   Class name      8 - Sampaguita
//   School year     2026-2027
//   Grade           8
//   Section         Sampaguita
//   Subject         Science
//
//   Student name
//   Juan Dela Cruz
//
// readClassFile() returns the class fields separately from the student rows,
// so Add class can autofill every input. A plain roster sheet with a Name row
// (the older format) still works and leaves the class fields untouched.

import { rowsToText, xlsxToRows } from './xlsx.js'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const META_LABELS = {
  'class name': 'name',
  'school year': 'schoolYear',
  grade: 'grade',
  section: 'section',
  subject: 'subject',
}
const STUDENT_HEADER = /^(student\s*name|student|full\s*name|name)$/i

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim()

/**
 * Spreadsheet rows → class fields + tab-separated roster text.
 * @param {string[][]} rows
 * @returns {{ meta: { name?: string, schoolYear?: string, grade?: string, section?: string, subject?: string }, studentsText: string, studentCount: number, template: boolean }}
 */
export function parseClassRows(rows) {
  const grid = (rows || []).map(row => (row || []).map(clean))
  const meta = {}
  const consumed = new Set()
  let headerIndex = -1
  let template = false

  for (let i = 0; i < grid.length; i++) {
    const cells = grid[i]
    const first = clean(cells[0]).toLowerCase()

    if (STUDENT_HEADER.test(cells[0])) {
      if (headerIndex < 0) headerIndex = i
      continue
    }

    // One-row layout: "Class name | School year | Grade | Section | Subject"
    // followed by a row of values.
    const mapped = cells.map(cell => META_LABELS[cell.toLowerCase()]).filter(Boolean)
    if (mapped.length >= 2) {
      const values = grid[i + 1] || []
      for (let c = 0; c < cells.length; c++) {
        const key = META_LABELS[clean(cells[c]).toLowerCase()]
        if (key && values[c]) meta[key] = values[c]
      }
      consumed.add(i)
      consumed.add(i + 1)
      template = true
      continue
    }

    // Template layout: label in column A, value in column B.
    const key = META_LABELS[first]
    if (key && cells[1]) {
      meta[key] = cells[1]
      consumed.add(i)
      template = true
    }
  }

  let lines = []
  if (headerIndex >= 0) {
    // The class template already has grade/section at the top, so its student
    // rows are names only. A legacy roster sheet without class fields keeps
    // any per-student columns it came with.
    const nameOnly = Object.keys(meta).length > 0
    for (let i = headerIndex + 1; i < grid.length; i++) {
      if (consumed.has(i)) continue
      const cells = grid[i]
      if (!cells[0]) continue
      const rest = nameOnly ? [] : cells.slice(1, 3).filter(Boolean)
      lines.push([cells[0], ...rest].join('\t'))
    }
  } else if (!template) {
    // No labelled template: keep the old roster-sheet behaviour, which lets
    // parseRoster() skip the header row.
    lines = rowsToText(rows).split('\n').filter(Boolean)
  }

  const studentsText = lines.join('\n')
  return {
    meta,
    studentsText,
    studentCount: studentsText ? studentsText.split('\n').length : 0,
    template: template || headerIndex >= 0,
  }
}

/**
 * Read an uploaded class sheet. TXT files are deliberately rejected so the
 * app has one documented format; .xlsx gets the full autofill, CSV stays a
 * roster-only convenience.
 * @param {File} file
 */
export async function readClassFile(file) {
  const name = String(file?.name || '')
  if (/\.txt$/i.test(name) || file?.type === 'text/plain') {
    throw new Error('TXT files are no longer supported — upload the Excel template or a CSV.')
  }
  if (/\.xls$/i.test(name)) {
    throw new Error('Old .xls files are not supported — save it as .xlsx or .csv first')
  }
  if (/\.xlsx$/i.test(name) || file?.type === XLSX_MIME) {
    const result = parseClassRows(await xlsxToRows(await file.arrayBuffer()))
    if (!result.studentsText.trim()) {
      throw new Error(`No students found in ${name || 'that spreadsheet'} — keep the Student name row.`)
    }
    return result
  }
  if (/\.csv$/i.test(name) || file?.type === 'text/csv') {
    const text = await file.text()
    if (!text.trim()) throw new Error(`No student names found in ${name || 'that file'}`)
    return { meta: {}, studentsText: text, studentCount: text.split('\n').filter(Boolean).length, template: false }
  }
  throw new Error('Upload an Excel (.xlsx) or CSV file.')
}
