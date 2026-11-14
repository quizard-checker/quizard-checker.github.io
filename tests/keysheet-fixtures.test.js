import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { xlsxToRows, parseCsv, rowsToKeyText } from '../src/app/core/engine/keysheet.js'
import { parseKeyText } from '../src/app/core/engine/answerkey.js'
import { generateTeacherQuiz } from '../src/app/core/engine/teacher-quiz.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const fixture = name => join(HERE, 'fixtures', name)

async function importFixture(name) {
  const buf = readFileSync(fixture(name))
  const rows = name.endsWith('.xlsx')
    ? await xlsxToRows(new Uint8Array(buf))
    : parseCsv(buf.toString('utf8'))
  return rowsToKeyText(rows)
}

// These fixtures are real files a teacher might hand over, run through the
// exact import → parse → build pipeline the Create page uses.
describe('spreadsheet fixtures through the import pipeline', () => {
  it('science-6col.xlsx: 6 complete MCQs, answers land on the right text', async () => {
    const out = await importFixture('science-6col.xlsx')
    expect(out.count).toBe(6)
    expect(out.skipped).toBe(0)
    const parsed = parseKeyText(out.text)
    expect(parsed.format).toBe('mcq')
    const answers = parsed.items.map(i => `${i.question} => ${i.options[i.answerIndex]}`)
    expect(answers).toEqual([
      'What do plants use for food? => Photosynthesis',
      'Which gas do humans exhale most? => Carbon dioxide',
      'What is the powerhouse of the cell? => Mitochondrion',
      'Which organ pumps blood? => Heart',
      'What is H2O? => Water',
      'Which planet is closest to the sun? => Mercury',
    ])
    expect(parsed.items.every(i => i.options.length === 4)).toBe(true)
  })

  it('science-6col.xlsx: the anchor builder takes it verbatim, no AI call', async () => {
    const parsed = parseKeyText((await importFixture('science-6col.xlsx')).text)
    const items = await generateTeacherQuiz({ mode: 'key', keyItems: parsed.items, count: 6, subject: 'Science' })
    expect(items).toHaveLength(6)
    expect(items[0]).toMatchObject({ question: 'What do plants use for food?', answerIndex: 2 })
    expect(items[1].options[items[1].answerIndex]).toBe('Carbon dioxide')
  })

  it('numbered.xlsx: a leading "No." column is not mistaken for the question', async () => {
    const out = await importFixture('numbered.xlsx')
    expect(out.count).toBe(3)
    const parsed = parseKeyText(out.text)
    expect(parsed.items.map(i => i.question)).toEqual([
      'Capital of France?',
      'Capital of Japan?',
      '2 + 2 = ?',
    ])
    expect(parsed.items.map(i => i.options[i.answerIndex])).toEqual(['Paris', 'Tokyo', '4'])
    const items = await generateTeacherQuiz({ mode: 'key', keyItems: parsed.items, count: 3, subject: 'Geography' })
    expect(items[1].options[items[1].answerIndex]).toBe('Tokyo')
  })

  it('letters.csv: a No|Answer sheet becomes a plain letter key', async () => {
    const out = await importFixture('letters.csv')
    expect(out.count).toBe(10)
    const parsed = parseKeyText(out.text)
    expect(parsed.format).toBe('letters')
    expect(parsed.items.map(i => i.answer).join('')).toBe('ABCADBCABC')
    const items = await generateTeacherQuiz({ mode: 'key', keyItems: parsed.items, count: 10, subject: 'Any' })
    expect(items.map(i => i.answerIndex).join('')).toBe('0120312012')
  })

  it('qa.csv: a two-column question/answer sheet keeps quoted commas', async () => {
    const out = await importFixture('qa.csv')
    expect(out.count).toBe(3)
    const parsed = parseKeyText(out.text)
    expect(parsed.format).toBe('qa')
    expect(parsed.items.map(i => `${i.question} => ${i.answer}`)).toEqual([
      'What is the largest organ, in the human body? => Skin',
      'What do plants need to make food? => Sunlight',
      'How many bones does an adult have? => 206',
    ])
  })

  it('messy.xlsx: bad rows are skipped, not silently mis-scored', async () => {
    const out = await importFixture('messy.xlsx')
    expect(out.count).toBe(1)
    expect(out.skipped).toBe(3)
    const parsed = parseKeyText(out.text)
    expect(parsed.items[0].question).toBe('Blank choice, answer D')
    expect(parsed.items[0].options[parsed.items[0].answerIndex]).toBe('Delta')
  })
})
