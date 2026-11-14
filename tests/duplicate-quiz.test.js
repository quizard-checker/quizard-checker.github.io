import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'

// storage.js touches localStorage only inside its functions; give node a stub.
const mem = new Map()
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
  clear: () => mem.clear(),
}

import {
  clearAllData, createAccount, duplicateQuiz, getQuiz, listQuizzes, listSheets,
  saveQuiz, saveSheet, setActiveAccount,
} from '../src/app/core/engine/storage.js'

const CLASS_A = { id: 'cls-a', name: 'Science 7-A' }
const CLASS_B = { id: 'cls-b', name: 'Science 7-B' }

function sampleQuiz(extra = {}) {
  return {
    subject: 'Science',
    title: 'Cell Basics',
    source: 'key',
    keyOnly: false,
    classId: CLASS_A.id,
    className: CLASS_A.name,
    items: [
      { n: 1, question: 'What controls the cell?', options: ['Nucleus', 'Wall', 'Leaf', 'Root'], answerIndex: 0 },
      { n: 2, question: 'Powerhouse?', options: ['Nucleus', 'Mitochondrion', 'Ribosome', 'Vacuole'], answerIndex: 1 },
    ],
    ...extra,
  }
}

describe('duplicateQuiz', () => {
  let account

  beforeEach(async () => {
    await clearAllData()
    account = await createAccount({ name: 'Copy tester', color: '#6366f1' })
    setActiveAccount(account.id)
  })

  it('creates an independent copy in the target section', async () => {
    const original = await saveQuiz(sampleQuiz())
    const copy = await duplicateQuiz(original, CLASS_B)

    expect(copy.id).toBeTruthy()
    expect(copy.id).not.toBe(original.id)
    expect(copy.classId).toBe(CLASS_B.id)
    expect(copy.className).toBe(CLASS_B.name)
    expect(copy.subject).toBe('Science')
    expect(copy.title).toBe('Cell Basics')
    expect(copy.source).toBe('key')
    expect(copy.keyOnly).toBe(false)
    expect(copy.items).toEqual(original.items)
    expect(copy.createdAt).toBeGreaterThanOrEqual(original.createdAt)

    // the original is untouched
    const reloaded = await getQuiz(original.id)
    expect(reloaded.classId).toBe(CLASS_A.id)
    expect(reloaded.className).toBe(CLASS_A.name)
    expect(reloaded.items).toEqual(original.items)

    const ids = (await listQuizzes()).map(q => q.id).sort()
    expect(ids).toEqual([original.id, copy.id].sort())
  })

  it('does not share the items array with the original', async () => {
    const original = await saveQuiz(sampleQuiz())
    const copy = await duplicateQuiz(original, CLASS_B)
    copy.items[0].options.push('Extra option')
    const reloaded = await getQuiz(original.id)
    expect(reloaded.items[0].options).toHaveLength(4)
  })

  it('drops demo flags so the copy is not swept away by Remove demo', async () => {
    const demo = await saveQuiz(sampleQuiz({ demo: true, demoKey: 'demo-quiz-1' }))
    const copy = await duplicateQuiz(demo, CLASS_B)
    expect(copy.demo).toBeUndefined()
    expect(copy.demoKey).toBeUndefined()
  })

  it('leaves scanned sheets with the original; the copy starts empty', async () => {
    const original = await saveQuiz(sampleQuiz())
    await saveSheet({
      classId: CLASS_A.id, className: CLASS_A.name, quizId: original.id,
      studentNo: 1, studentName: 'Ana Reyes', answers: [0, 1], flags: [],
      correct: 2, total: 2, percent: 100,
    })
    const copy = await duplicateQuiz(original, CLASS_B)
    expect(await listSheets({ quizId: original.id })).toHaveLength(1)
    expect(await listSheets({ quizId: copy.id })).toHaveLength(0)
    expect(await listSheets({ classId: CLASS_B.id })).toHaveLength(0)
  })

  it('returns null when the quiz or target section is missing', async () => {
    const original = await saveQuiz(sampleQuiz())
    expect(await duplicateQuiz(null, CLASS_B)).toBe(null)
    expect(await duplicateQuiz(original, null)).toBe(null)
  })
})
