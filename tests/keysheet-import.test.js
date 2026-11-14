import { describe, it, expect } from 'vitest'
import {
  colIndex,
  sharedStringsXmlToList,
  sheetXmlToRows,
  xlsxToRows,
  parseCsv,
  rowsToKeyText,
} from '../src/app/core/engine/keysheet.js'
import { parseKeyText } from '../src/app/core/engine/answerkey.js'

// ── xlsx plumbing ───────────────────────────────────────────────────────────
describe('colIndex', () => {
  it('maps spreadsheet column letters to 0-based indexes', () => {
    expect(colIndex('A1')).toBe(0)
    expect(colIndex('F12')).toBe(5)
    expect(colIndex('AA2')).toBe(26)
    expect(colIndex('')).toBe(null)
  })
})

describe('sharedStringsXmlToList', () => {
  it('collects plain and rich-text strings in order, decoding entities', () => {
    const xml = `<sst count="3"><si><t>What is &lt;X&gt;?</t></si>`
      + `<si><r><t>Rich </t></r><r><t>text</t></r></si>`
      + `<si><t>Caf&#233; &amp; tea</t></si></sst>`
    expect(sharedStringsXmlToList(xml)).toEqual([
      'What is <X>?',
      'Rich text',
      'Café & tea',
    ])
  })
})

describe('sheetXmlToRows', () => {
  it('reads shared, inline and numeric cells into dense rows', () => {
    const sheet = `<worksheet><sheetData>`
      + `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Bold</t></is></c><c r="D1"><v>42</v></c></row>`
      + `<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="b"><v>1</v></c></row>`
      + `</sheetData></worksheet>`
    const rows = sheetXmlToRows(sheet, ['Q1', 'Yes'])
    expect(rows[0]).toEqual(['Q1', 'Bold', '', '42'])
    expect(rows[1]).toEqual(['Yes', 'TRUE'])
  })
})

describe('xlsxToRows', () => {
  it('reads a real workbook zip (sharedStrings + first sheet)', async () => {
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    zip.file('xl/workbook.xml', `<workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`)
    zip.file('xl/_rels/workbook.xml.rels', `<Relationships><Relationship Id="rId1" Type="http://x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`)
    zip.file('xl/sharedStrings.xml', `<sst><si><t>What do plants use for food?</t></si><si><t>Photosynthesis</t></si></sst>`)
    zip.file('xl/worksheets/sheet1.xml', `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row></sheetData></worksheet>`)
    const rows = await xlsxToRows(await zip.generateAsync({ type: 'uint8array' }))
    expect(rows).toEqual([['What do plants use for food?', 'Photosynthesis']])
  })

  it('rejects a zip that has no worksheets', async () => {
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    zip.file('readme.txt', 'not a spreadsheet')
    await expect(xlsxToRows(await zip.generateAsync({ type: 'uint8array' })))
      .rejects.toThrow(/no worksheet/)
  })

  it('rejects data that is not a zip at all', async () => {
    await expect(xlsxToRows(new TextEncoder().encode('hello world, plain text')))
      .rejects.toThrow(/not a readable .xlsx/)
  })
})

// ── CSV ─────────────────────────────────────────────────────────────────────
describe('parseCsv', () => {
  it('sniffs comma, semicolon and tab delimiters', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
    expect(parseCsv('a;b;c')).toEqual([['a', 'b', 'c']])
    expect(parseCsv('a\tb')).toEqual([['a', 'b']])
  })

  it('honours quoted cells with embedded delimiters and quotes', () => {
    expect(parseCsv('"say, hi",2\n"he said ""ok""",3')).toEqual([
      ['say, hi', '2'],
      ['he said "ok"', '3'],
    ])
  })
})

// ── rows → key text ─────────────────────────────────────────────────────────
describe('rowsToKeyText', () => {
  it('turns 6-column rows into complete MCQ blocks', () => {
    const rows = [
      ['Question', 'Choice A', 'Choice B', 'Choice C', 'Choice D', 'Answer'],
      ['What do plants use for food?', 'Oxygen', 'Carbon dioxide', 'Photosynthesis', 'Water', 'C'],
      ['Which gas do humans exhale most?', 'Oxygen', 'Carbon dioxide', 'Nitrogen', 'Helium', 'B. Carbon dioxide'],
    ]
    const out = rowsToKeyText(rows)
    expect(out.count).toBe(2)
    expect(out.skipped).toBe(0)
    const parsed = parseKeyText(out.text)
    expect(parsed.format).toBe('mcq')
    expect(parsed.items[0].question).toBe('What do plants use for food?')
    expect(parsed.items[0].options).toEqual(['Oxygen', 'Carbon dioxide', 'Photosynthesis', 'Water'])
    expect(parsed.items[0].answerIndex).toBe(2)
    expect(parsed.items[1].answerIndex).toBe(1)
  })

  it('accepts the answer written as the choice text', () => {
    const rows = [['What is 2+2?', 'Three', 'Four', 'Five', 'Six', 'Four']]
    const parsed = parseKeyText(rowsToKeyText(rows).text)
    expect(parsed.items[0].answerIndex).toBe(1)
  })

  it('keeps the correct answer when a middle choice is blank', () => {
    const rows = [['Q?', 'Alpha', '', 'Gamma', 'Delta', 'D']]
    const out = rowsToKeyText(rows)
    expect(out.count).toBe(1)
    const parsed = parseKeyText(out.text)
    // the blank B cell is dropped, but the star must still land on "Delta"
    expect(parsed.items[0].options).toEqual(['Alpha', 'Gamma', 'Delta'])
    expect(parsed.items[0].answerIndex).toBeGreaterThanOrEqual(0)
    expect(parsed.items[0].options[parsed.items[0].answerIndex]).toBe('Delta')
  })

  it('falls back to question → answer line when there are no choices', () => {
    const rows = [['What is the powerhouse of the cell?', '', '', '', '', 'Mitochondrion']]
    const parsed = parseKeyText(rowsToKeyText(rows).text)
    expect(parsed.format).toBe('qa')
    expect(parsed.items[0]).toMatchObject({ question: 'What is the powerhouse of the cell?', answer: 'Mitochondrion' })
  })

  it('keeps the old paper letter for a single-choice row ("B. Nucleus")', () => {
    const rows = [['What controls the cell?', 'Nucleus', 'B. Nucleus']]
    const parsed = parseKeyText(rowsToKeyText(rows).text)
    expect(parsed.format).toBe('keyed')
    expect(parsed.items[0]).toMatchObject({ answerLetter: 'B', answer: 'Nucleus' })
  })

  it('keeps a question|letter row as a scoring-grid entry, not a drop', () => {
    const rows = [['What controls the cell?', 'B']]
    const out = rowsToKeyText(rows)
    expect(out.count).toBe(1)
    expect(out.skipped).toBe(0)
    const parsed = parseKeyText(out.text)
    expect(parsed.format).toBe('qa')
    expect(parsed.items[0]).toMatchObject({ question: 'What controls the cell?', answer: 'B' })
  })

  it('reads a two-column number|letter sheet as a plain letter key', () => {
    const rows = [['No', 'Answer'], ['1', 'A'], ['2', 'B'], ['3', 'C'], ['4', 'A']]
    const out = rowsToKeyText(rows)
    expect(out.count).toBe(4)
    expect(out.skipped).toBe(0)
    expect(out.text).toBe('1.A 2.B 3.C 4.A')
    const parsed = parseKeyText(out.text)
    expect(parsed.format).toBe('letters')
    expect(parsed.items.map(i => i.answer)).toEqual(['A', 'B', 'C', 'A'])
  })

  it('skips rows without an answer and counts them', () => {
    const rows = [
      ['Q one?', 'A1', 'B1', 'C1', 'D1', ''],
      ['Q two?', 'A2', 'B2', 'C2', 'D2', 'A'],
    ]
    const out = rowsToKeyText(rows)
    expect(out.count).toBe(1)
    expect(out.skipped).toBe(1)
  })

  it('drops a leading header row but keeps later data rows', () => {
    const rows = [
      ['No.', 'Question', 'Choice A', 'Choice B', 'Choice C', 'Answer'],
      ['1', 'Capital of France?', 'London', 'Paris', 'Rome', 'B'],
      ['2', '2+2?', '3', '4', '5', '4'],
    ]
    const out = rowsToKeyText(rows)
    expect(out.count).toBe(2)
    const parsed = parseKeyText(out.text)
    expect(parsed.items[0].question).toBe('Capital of France?')
    expect(parsed.items[0].options[parsed.items[0].answerIndex]).toBe('Paris')
    expect(parsed.items[1].options[parsed.items[1].answerIndex]).toBe('4')
  })

  it('strips numbering the teacher already typed into the question cell', () => {
    const rows = [['1. What is X?', 'a1', 'b1', 'c1', 'd1', 'B']]
    const parsed = parseKeyText(rowsToKeyText(rows).text)
    expect(parsed.items[0].question).toBe('What is X?')
  })

  it('treats an answer that matches no choice as skipped', () => {
    const rows = [['Q?', 'a1', 'b1', 'c1', 'd1', 'Argentina']]
    const out = rowsToKeyText(rows)
    expect(out.count).toBe(0)
    expect(out.skipped).toBe(1)
  })
})

// ── end-to-end with the real key parser ─────────────────────────────────────
describe('imported text drives parseKeyText formats', () => {
  it('a full 6-column sheet parses as mcq ready for match-my-format', () => {
    const rows = [
      ['Question', 'A', 'B', 'C', 'D', 'Key'],
      ['The sun rises in the…', 'west', 'east', 'north', 'south', 'B'],
    ]
    const parsed = parseKeyText(rowsToKeyText(rows).text)
    expect(parsed.format).toBe('mcq')
    expect(parsed.items[0]).toMatchObject({ question: 'The sun rises in the…', answerIndex: 1 })
  })
})
