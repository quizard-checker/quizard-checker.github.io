import { describe, expect, it } from 'vitest'
import { normalizeQuizItems } from '../src/app/core/engine/quiz-items.js'

const item = (over = {}) => ({
  n: 1,
  question: 'What is 2 + 2?',
  options: ['3', '4', '5', '6'],
  answerIndex: 1,
  ...over,
})

describe('normalizeQuizItems — A–D only', () => {
  it('trims a fifth choice to the four printed bubbles', () => {
    const [out] = normalizeQuizItems([item({ options: ['A', 'B', 'C', 'D', 'E'] })])
    expect(out.options).toEqual(['A', 'B', 'C', 'D'])
  })

  it('marks an out-of-range answer as incomplete instead of shifting it', () => {
    expect(normalizeQuizItems([item({ answerIndex: 4 })])[0].answerIndex).toBe(-1)
    expect(normalizeQuizItems([item({ answerIndex: '2' })])[0].answerIndex).toBe(2)
  })

  it('pads short option lists and clears missing choices', () => {
    const [out] = normalizeQuizItems([item({ options: ['A', null], answerIndex: 3 })])
    expect(out.options).toEqual(['A', '', '', ''])
  })

  it('keeps a normal four-option item unchanged, including other fields', () => {
    const input = item({ n: 7, keyAnswer: '4', keyOrigin: 'teacher' })
    const [out] = normalizeQuizItems([input])
    expect(out).toEqual(input)
  })

  it('handles a missing or non-array item list safely', () => {
    expect(normalizeQuizItems()).toEqual([])
    expect(normalizeQuizItems(null)).toEqual([])
    expect(normalizeQuizItems([null])[0]).toEqual({
      options: ['', '', '', ''],
      answerIndex: -1,
    })
  })
})
