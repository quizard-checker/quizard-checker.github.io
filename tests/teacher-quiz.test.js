import { describe, it, expect } from 'vitest'
import { generateTeacherQuiz, clampCount } from '../src/app/core/engine/teacher-quiz.js'

describe('clampCount', () => {
  it('clamps into 1..50 and defaults garbage to 10', () => {
    expect(clampCount(0)).toBe(10)
    expect(clampCount(-5)).toBe(1)
    expect(clampCount(99)).toBe(50)
    expect(clampCount('abc')).toBe(10)
  })
})

describe('generateTeacherQuiz — anchored to the teacher key', () => {
  const complete = (n, question, options, answerIndex) => ({
    n, question, options, answerIndex, answer: options[answerIndex],
  })

  it('uses entries with question + options verbatim', async () => {
    const items = await generateTeacherQuiz({
      mode: 'key', count: 10,
      keyItems: [complete(1, 'What is 2+2?', ['3', '4', '5', '6'], 1)],
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ n: 1, question: 'What is 2+2?', answerIndex: 1, keyOrigin: 'teacher' })
    expect(items[0].keyAnswer).toBe('4')
  })

  it('turns letters-only entries into a scoring grid, questions blank', async () => {
    const items = await generateTeacherQuiz({
      mode: 'key', count: 10,
      keyItems: [
        { n: 1, answer: 'B' }, { n: 2, answer: 'D' },
      ],
    })
    expect(items).toHaveLength(2)
    expect(items[0].question).toBe('')
    expect(items[0].options).toEqual(['', '', '', ''])
    expect(items[0].answerIndex).toBe(1)
    expect(items[1].answerIndex).toBe(3)
  })

  it('keeps the question on lettered entries that carry one', async () => {
    const items = await generateTeacherQuiz({
      mode: 'key', count: 10,
      keyItems: [{ n: 1, question: 'What controls the cell?', answerLetter: 'A', answer: 'Nucleus' }],
    })
    expect(items[0].question).toBe('What controls the cell?')
    expect(items[0].answerIndex).toBe(0)
  })

  it('lands answer-text entries as placeholders for manual completion', async () => {
    const items = await generateTeacherQuiz({
      mode: 'key', count: 10,
      keyItems: [{ n: 1, question: 'What is the powerhouse of the cell?', answer: 'Mitochondrion' }],
    })
    expect(items[0].question).toBe('What is the powerhouse of the cell?')
    expect(items[0].options).toEqual(['', '', '', ''])
    expect(items[0].answerIndex).toBe(-1)
  })

  it('orders rows by key entry and slices to the requested count', async () => {
    const items = await generateTeacherQuiz({
      mode: 'key', count: 3,
      keyItems: [
        { n: 1, answer: 'A' }, { n: 2, answer: 'B' }, { n: 3, answer: 'C' },
        { n: 4, answer: 'D' }, { n: 5, answer: 'A' },
      ],
    })
    expect(items.map(i => i.answerIndex)).toEqual([0, 1, 2])
  })

  it('refuses a whole-letter answer outside A–D', async () => {
    await expect(generateTeacherQuiz({
      mode: 'key', count: 10, keyItems: [{ n: 1, answer: 'E' }],
    })).rejects.toMatchObject({ code: 'letter_out_of_range' })
  })

  it('throws a classified error when the key is empty', async () => {
    await expect(generateTeacherQuiz({ mode: 'key', count: 10, keyItems: [] }))
      .rejects.toMatchObject({ code: 'no_key' })
  })

  it('refuses the removed AI modes explicitly', async () => {
    await expect(generateTeacherQuiz({ mode: 'ai', text: 'lesson', count: 10 }))
      .rejects.toMatchObject({ code: 'mode_removed' })
    await expect(generateTeacherQuiz({ mode: 'format', count: 10 }))
      .rejects.toMatchObject({ code: 'mode_removed' })
  })
})
