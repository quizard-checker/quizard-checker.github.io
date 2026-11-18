import { describe, expect, it } from 'vitest'
import { parseKeyText } from '../src/app/core/engine/answerkey.js'
import { validateKey } from '../src/app/core/engine/key-validate.js'

const MCQ = `1. What is 2 + 2?
A. 3
B. 4
C. 5
D. 6
Answer: B`

describe('validateKey — strict multiple choice', () => {
  it('accepts a complete A–D multiple-choice key', () => {
    const checked = validateKey(parseKeyText(MCQ), 'mcq', MCQ)
    expect(checked.ok).toBe(true)
  })

  it('rejects random prose', () => {
    const text = 'hello world'
    const checked = validateKey(parseKeyText(text), 'mcq', text)
    expect(checked.ok).toBe(false)
    expect(checked.message).toContain('not a multiple-choice key')
  })

  it('rejects a question with no answer', () => {
    const text = MCQ.replace('\nAnswer: B', '')
    expect(validateKey(parseKeyText(text), 'mcq', text).ok).toBe(false)
  })

  it('rejects a question with only three choices', () => {
    const text = `1. Pick one
A. One
B. Two
C. Three
Answer: A`
    expect(validateKey(parseKeyText(text), 'mcq', text).ok).toBe(false)
  })

  it('rejects answer E and a fifth choice', () => {
    const answerE = MCQ.replace('Answer: B', 'Answer: E')
    expect(validateKey(parseKeyText(answerE), 'mcq', answerE).ok).toBe(false)

    const five = MCQ.replace('D. 6', 'D. 6\nE. 7')
    expect(validateKey(parseKeyText(five), 'mcq', five).ok).toBe(false)
  })

  it('accepts letters and answers only in their explicit modes', () => {
    const letters = '1.A 2.B 3.C 4.D'
    expect(validateKey(parseKeyText(letters), 'letters', letters).ok).toBe(true)
    expect(validateKey(parseKeyText(letters), 'mcq', letters).ok).toBe(false)

    const answers = '1. Photosynthesis\n2. Water and air'
    expect(validateKey(parseKeyText(answers), 'answers', answers).ok).toBe(true)
    expect(validateKey(parseKeyText(answers), 'mcq', answers).ok).toBe(false)

    const qa = '1. What do plants use for food? → Photosynthesis'
    expect(validateKey(parseKeyText(qa), 'answers', qa).ok).toBe(true)
    expect(validateKey(parseKeyText(qa), 'mcq', qa).ok).toBe(false)
  })
})
