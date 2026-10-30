import { describe, it, expect } from 'vitest'
import { resolveDemoSheet, DEMO_SHEET } from '../src/app/core/engine/demo-sheet.js'

const claim = {
  demo: { classKey: 'demo-cls-eng', quizKey: 'demo-quiz-2', studentNo: 1 },
}

const demoClass = {
  id: 'demo-abc-cls-1',
  demoKey: 'demo-cls-eng',
  demo: true,
  name: 'English 8-B',
  students: [
    { id: 'demo-abc-st-1-1', no: 1, name: 'Ivan Ramos' },
    { id: 'demo-abc-st-1-2', no: 2, name: 'Joy Aquino' },
  ],
}

const demoQuiz = {
  id: 'demo-abc-quiz-2',
  demoKey: 'demo-quiz-2',
  demo: true,
  subject: 'English',
  title: 'Verb Tenses',
  items: [],
}

describe('resolveDemoSheet', () => {
  it('matches the current profile’s re-keyed demo records by demoKey', () => {
    const match = resolveDemoSheet(claim, [demoClass], [demoQuiz])
    expect(match?.cls.name).toBe('English 8-B')
    expect(match?.quiz.title).toBe('Verb Tenses')
    expect(match?.student.name).toBe('Ivan Ramos')
  })

  it('falls back to the known class/quiz signature for old demo data', () => {
    const oldClass = { ...demoClass, demoKey: undefined }
    const oldQuiz = { ...demoQuiz, demoKey: undefined }
    const match = resolveDemoSheet(claim, [oldClass], [oldQuiz])
    expect(match?.student.no).toBe(1)
  })

  it('never resolves against a real class or quiz with the same name', () => {
    const realClass = { ...demoClass, demo: false, demoKey: undefined }
    const realQuiz = { ...demoQuiz, demo: false, demoKey: undefined }
    expect(resolveDemoSheet(claim, [realClass], [realQuiz])).toBeNull()
  })

  it('returns null when the demo data is missing or the student is gone', () => {
    expect(resolveDemoSheet(claim, [], [])).toBeNull()
    expect(resolveDemoSheet(claim, [{ ...demoClass, students: [] }], [demoQuiz])).toBeNull()
  })

  it('ignores ordinary non-demo claims', () => {
    expect(resolveDemoSheet({ quizId: 'q', studentId: 's', studentName: 'Ivan Ramos' }, [demoClass], [demoQuiz])).toBeNull()
  })

  it('ships the expected sheet constants', () => {
    expect(DEMO_SHEET).toEqual({
      classKey: 'demo-cls-eng',
      quizKey: 'demo-quiz-2',
      studentNo: 1,
    })
  })
})
