import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { rowsToText, xlsxToText } from '../src/app/core/engine/xlsx.js'
import { parseClassRows, readClassFile } from '../src/app/core/engine/class-file.js'
import { parseRoster } from '../src/app/core/engine/roster.js'

// Tiny .xlsx builder: a real workbook is a zip with an XML worksheet (and a
// shared-strings table for text cells). This is enough to exercise the reader.
async function makeXlsx(sheetXml, shared = [], extraSheets = {}) {
  const zip = new JSZip()
  if (shared.length) {
    zip.file(
      'xl/sharedStrings.xml',
      `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${
        shared.map(s => `<si><t>${s}</t></si>`).join('')
      }</sst>`
    )
  }
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetXml}</sheetData></worksheet>`
  )
  for (const [name, xml] of Object.entries(extraSheets)) {
    zip.file(
      name,
      `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>${xml}</sheetData></worksheet>`
    )
  }
  return zip.generateAsync({ type: 'arraybuffer' })
}

const row = (r, cells) => `<row r="${r}">${cells}</row>`
const sharedCell = (ref, i) => `<c r="${ref}" t="s"><v>${i}</v></c>`
const numCell = (ref, n) => `<c r="${ref}"><v>${n}</v></c>`
const inlineCell = (ref, text) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`

describe('rowsToText', () => {
  it('joins cells with tabs and drops trailing empties and blank rows', () => {
    expect(rowsToText([
      ['Name', 'Grade', 'Section'],
      ['Juan Dela Cruz', 8, 'Sampaguita'],
      ['', '', ''],
      ['Ana Reyes', '', ''],
    ])).toBe('Name\tGrade\tSection\nJuan Dela Cruz\t8\tSampaguita\nAna Reyes')
  })

  it('collapses whitespace inside a cell', () => {
    expect(rowsToText([['  Maria   Santos ', ' 7 ']])).toBe('Maria Santos\t7')
  })
})

describe('xlsxToText', () => {
  it('reads shared strings, numbers and inline text into roster rows', async () => {
    const shared = ['Name', 'Grade', 'Section', 'Reyes, Juan', 'Liza Fernandez', 'Sampaguita']
    const sheet = [
      row(1, sharedCell('A1', 0) + sharedCell('B1', 1) + sharedCell('C1', 2)),
      row(2, sharedCell('A2', 3) + numCell('B2', 8) + sharedCell('C2', 5)),
      row(3, sharedCell('A3', 4) + inlineCell('B3', '9') + sharedCell('C3', 5)),
    ].join('')

    const text = await xlsxToText(await makeXlsx(sheet, shared))
    expect(text).toBe('Name\tGrade\tSection\nReyes, Juan\t8\tSampaguita\nLiza Fernandez\t9\tSampaguita')

    // The roster parser skips the header and keeps the comma inside the name
    // because the row is tab-separated.
    const { students } = parseRoster(text)
    expect(students).toEqual([
      { name: 'Reyes, Juan', grade: 'Grade 8', section: 'Sampaguita' },
      { name: 'Liza Fernandez', grade: 'Grade 9', section: 'Sampaguita' },
    ])
  })

  it('keeps column gaps so a missing grade does not shift the section', async () => {
    const shared = ['Name', 'Section', 'Ana Reyes', 'Molave']
    const sheet = [
      row(1, sharedCell('A1', 0) + sharedCell('C1', 1)),
      row(2, sharedCell('A2', 2) + sharedCell('C2', 3)),
    ].join('')

    const text = await xlsxToText(await makeXlsx(sheet, shared))
    expect(text).toBe('Name\t\tSection\nAna Reyes\t\tMolave')
    expect(parseRoster(text).students[0]).toEqual({
      name: 'Ana Reyes', grade: '', section: 'Molave',
    })
  })

  it('handles self-closing cells and rich-text shared strings', async () => {
    const sharedXml = '<si><r><t>Maria </t></r><r><t>Santos</t></r></si>'
    const zip = new JSZip()
    zip.file('xl/sharedStrings.xml', `<sst>${sharedXml}</sst>`)
    zip.file(
      'xl/worksheets/sheet1.xml',
      `<worksheet><sheetData>${row(1, '<c r="A1" t="s"><v>0</v></c><c r="B1" s="1"/>')}</sheetData></worksheet>`
    )
    const text = await xlsxToText(await zip.generateAsync({ type: 'arraybuffer' }))
    expect(text).toBe('Maria Santos')
  })

  it('reads the first worksheet when the workbook has more than one', async () => {
    const first = row(1, inlineCell('A1', 'First Sheet'))
    const second = row(1, inlineCell('A1', 'Second Sheet'))
    const text = await xlsxToText(await makeXlsx(first, [], {
      'xl/worksheets/sheet2.xml': second,
    }))
    expect(text).toBe('First Sheet')
  })

  it('rejects a zip with no worksheet', async () => {
    const zip = new JSZip()
    zip.file('docProps/app.xml', '<Properties/>')
    await expect(xlsxToText(await zip.generateAsync({ type: 'arraybuffer' })))
      .rejects.toThrow(/No worksheet/)
  })

  it('rejects an empty worksheet', async () => {
    await expect(xlsxToText(await makeXlsx(''))).rejects.toThrow(/No rows/)
  })
})

describe('parseClassRows', () => {
  it('reads class fields and the student table from the template layout', () => {
    const result = parseClassRows([
      ['Quizard class template'],
      [],
      ['Class name', '8 - Sampaguita'],
      ['School year', '2026-2027'],
      ['Grade', '8'],
      ['Section', 'Sampaguita'],
      ['Subject', 'Science'],
      [],
      ['Student name', 'Grade', 'Section'],
      ['Juan Dela Cruz', '8', 'Sampaguita'],
      ['Reyes, Miguel', '8', 'Sampaguita'],
    ])
    expect(result.meta).toEqual({
      name: '8 - Sampaguita',
      schoolYear: '2026-2027',
      grade: '8',
      section: 'Sampaguita',
      subject: 'Science',
    })
    expect(result.studentsText).toBe('Juan Dela Cruz\nReyes, Miguel')
    expect(result.studentCount).toBe(2)
    expect(result.template).toBe(true)
  })

  it('reads a one-row class header followed by values', () => {
    const result = parseClassRows([
      ['Class name', 'School year', 'Grade', 'Section', 'Subject'],
      ['7 - Narra', '2026-2027', '7', 'Narra', 'Math'],
      ['Student name', 'Grade', 'Section'],
      ['Ana Reyes', '7', 'Narra'],
    ])
    expect(result.meta.name).toBe('7 - Narra')
    expect(result.meta.subject).toBe('Math')
    expect(result.studentsText).toBe('Ana Reyes')
  })

  it('keeps the old roster-sheet layout when there are no class fields', () => {
    const result = parseClassRows([
      ['Name', 'Grade', 'Section'],
      ['Ana Reyes', '8', 'Sampaguita'],
    ])
    expect(result.meta).toEqual({})
    expect(result.studentsText).toBe('Ana Reyes\t8\tSampaguita')
    expect(result.template).toBe(true)
  })
})

describe('readClassFile', () => {
  const fakeFile = (name, text, buffer) => ({
    name,
    type: '',
    text: async () => text,
    arrayBuffer: async () => buffer,
  })

  it('reads CSV as a roster-only upload', async () => {
    const result = await readClassFile(fakeFile('roster.csv', 'Juan\nMaria'))
    expect(result.meta).toEqual({})
    expect(result.studentsText).toBe('Juan\nMaria')
  })

  it('reads an .xlsx template into class fields and students', async () => {
    const sheet = [
      row(1, inlineCell('A1', 'Class name') + inlineCell('B1', '8 - Sampaguita')),
      row(2, inlineCell('A2', 'School year') + inlineCell('B2', '2026-2027')),
      row(3, inlineCell('A3', 'Grade') + inlineCell('B3', '8')),
      row(4, inlineCell('A4', 'Section') + inlineCell('B4', 'Sampaguita')),
      row(5, inlineCell('A5', 'Subject') + inlineCell('B5', 'Science')),
      row(6, inlineCell('A6', 'Student name') + inlineCell('B6', 'Grade') + inlineCell('C6', 'Section')),
      row(7, inlineCell('A7', 'Juan Dela Cruz') + numCell('B7', 8)),
    ].join('')
    const result = await readClassFile(fakeFile('class.xlsx', 'ignored', await makeXlsx(sheet)))
    expect(result.meta).toEqual({
      name: '8 - Sampaguita',
      schoolYear: '2026-2027',
      grade: '8',
      section: 'Sampaguita',
      subject: 'Science',
    })
    expect(result.studentsText).toBe('Juan Dela Cruz')
  })

  it('reads the real downloadable template', async () => {
    const buffer = await readFile(new URL('../public/templates/quizard-class-template.xlsx', import.meta.url))
    const result = await readClassFile(fakeFile('quizard-class-template.xlsx', 'ignored', buffer))
    expect(result.meta).toEqual({
      schoolYear: '2026-2027',
      grade: '8',
      section: 'Sampaguita',
      subject: 'Science',
    })
    expect(result.studentCount).toBe(3)
    expect(result.studentsText).toBe('Juan Dela Cruz\nMaria Santos\nReyes, Miguel')
  })

  it('rejects legacy .xls with a save-as message', async () => {
    await expect(readClassFile(fakeFile('roster.xls', '')))
      .rejects.toThrow(/save it as \.xlsx or \.csv/)
  })

  it('no longer accepts TXT files', async () => {
    await expect(readClassFile(fakeFile('roster.txt', 'Juan\nMaria')))
      .rejects.toThrow(/TXT files are no longer supported/)
  })

  it('rejects an empty CSV file', async () => {
    await expect(readClassFile(fakeFile('empty.csv', '  \n ')))
      .rejects.toThrow(/No student names found in empty\.csv/)
  })
})
