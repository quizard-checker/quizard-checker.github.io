import { describe, expect, it } from 'vitest'
import { DEMO_SNAPSHOT } from '../src/app/core/engine/demo-data.js'
import { isValidPin } from '../src/app/core/engine/roster.js'

// The bundled demo world must stay consistent with the demo PIN half-sheets
// (scripts/make-demo-pin-sheets.py): a 50-item Verb Tenses quiz and a pinned
// English 8-B roster, so the sheets scan, route and score like real paper.
const eng = DEMO_SNAPSHOT.classes.find(c => c.id === 'demo-cls-eng')
const verbQuiz = DEMO_SNAPSHOT.quizzes.find(q => q.id === 'demo-quiz-2')
const verbKey = DEMO_SNAPSHOT.keys.find(k => k.id === 'demo-key-2')
const engSheets = DEMO_SNAPSHOT.sheets.filter(s => s.classId === 'demo-cls-eng')

describe('demo data: 50-item Verb Tenses world', () => {
  it('keeps the Verb Tenses quiz at the PIN sheet\'s fixed 50 items', () => {
    expect(verbQuiz.items.length).toBe(50)
    for (const [i, item] of verbQuiz.items.entries()) {
      expect(item.n).toBe(i + 1)
      expect(item.question).toBeTruthy()
      expect(item.options.filter(Boolean).length).toBe(4)
      expect(item.answerIndex).toBeGreaterThanOrEqual(0)
      expect(item.answerIndex).toBeLessThanOrEqual(3)
    }
  })

  it('keeps the letters answer key aligned with the quiz key', () => {
    expect(verbKey.items.length).toBe(50)
    const letters = ['A', 'B', 'C', 'D']
    verbKey.items.forEach((k, i) => {
      expect(k.n).toBe(i + 1)
      expect(k.answerLetter).toBe(letters[verbQuiz.items[i].answerIndex])
    })
  })

  it('gives every English 8-B student a unique valid 5-digit PIN', () => {
    const pins = eng.students.map(s => s.pin)
    expect(pins.length).toBe(12)
    for (const pin of pins) expect(isValidPin(pin)).toBe(true)
    expect(new Set(pins).size).toBe(12)
  })

  it('keeps the four demo-sheet students unchecked so scanning moves the card', () => {
    for (const no of [1, 2, 3, 4]) {
      expect(engSheets.find(s => s.studentNo === no)).toBeUndefined()
    }
    // the other eight classmates are already seated
    expect(engSheets.length).toBe(8)
    expect(new Set(engSheets.map(s => s.studentNo).sort())).toEqual(new Set([5, 6, 7, 8, 9, 10, 11, 12]))
  })

  it('keeps every seeded English sheet consistent with the quiz key', () => {
    for (const sheet of engSheets) {
      expect(sheet.answers.length).toBe(50)
      expect(sheet.flags.length).toBe(50)
      const correct = sheet.answers.filter((a, i) => a >= 0 && a === verbQuiz.items[i].answerIndex).length
      expect(sheet.correct).toBe(correct)
      expect(sheet.total).toBe(50)
      expect(sheet.percent).toBe(Math.round((correct / 50) * 100))
    }
  })
})
