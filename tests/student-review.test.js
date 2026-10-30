import { describe, it, expect } from 'vitest'
import { latestStudentSheets, buildStudentReview, reviewSummary, filterReview } from '../src/app/core/engine/student-review.js'

const student = { id: 'st-1', no: 1, name: 'Ivan Ramos' }

const quizzes = [
  {
    id: 'q-eng', subject: 'English', title: 'Verb Tenses',
    items: [
      { n: 1, question: 'She ___ to school every day.', options: ['go', 'goes', 'going', 'gone'], answerIndex: 1 },
      { n: 2, question: 'Yesterday, they ___ a movie.', options: ['watch', 'watches', 'watched', 'watching'], answerIndex: 2 },
      { n: 3, question: 'The sun ___ in the east.', options: ['rise', 'rises', 'rose', 'rising'], answerIndex: 1 },
    ],
  },
  {
    id: 'q-sci', subject: 'Science', title: 'Plate Tectonics',
    items: [
      { n: 1, question: 'Which layer is outermost?', options: ['Crust', 'Mantle', 'Core', 'Magma'], answerIndex: 0 },
    ],
  },
]

const sheets = [
  // Older English attempt — must be ignored in favour of the newer one.
  { id: 'old', quizId: 'q-eng', studentNo: 1, studentName: 'Ivan Ramos', answers: [0, 0, 0], correct: 0, total: 3, percent: 0, createdAt: 1000 },
  { id: 'new', quizId: 'q-eng', studentNo: 1, studentName: 'Ivan Ramos', answers: [1, 0, -1], correct: 1, total: 3, percent: 33, createdAt: 3000 },
  { id: 'sci', quizId: 'q-sci', studentNo: 1, studentName: 'Ivan Ramos', answers: [0], correct: 1, total: 1, percent: 100, createdAt: 2000 },
  // Someone else's sheet.
  { id: 'other', quizId: 'q-eng', studentNo: 2, studentName: 'Joy Aquino', answers: [1, 2, 1], correct: 3, total: 3, percent: 100, createdAt: 4000 },
]

describe('latestStudentSheets', () => {
  it('keeps only this student, one newest sheet per quiz, newest quiz first', () => {
    const rows = latestStudentSheets(sheets, student)
    expect(rows.map(s => s.id)).toEqual(['new', 'sci'])
  })

  it('falls back to the name for sheets saved without a roster number', () => {
    const rows = latestStudentSheets([
      { id: 'x', quizId: 'q-eng', studentNo: null, studentName: 'Ivan Ramos', createdAt: 1 },
    ], student)
    expect(rows.map(s => s.id)).toEqual(['x'])
  })
})

describe('buildStudentReview', () => {
  const records = buildStudentReview(sheets, quizzes, student)

  it('labels each quiz and keeps the newest attempt', () => {
    expect(records.map(r => r.quiz)).toEqual(['English — Verb Tenses', 'Science — Plate Tectonics'])
    expect(records[0].percent).toBe(33)
  })

  it('resolves every question to the pick, the key and all choices', () => {
    const [eng] = records
    expect(eng.rows).toHaveLength(3)
    expect(eng.rows[0]).toMatchObject({
      n: 1, question: 'She ___ to school every day.',
      options: ['go', 'goes', 'going', 'gone'],
      pick: 'B', key: 'B', right: true, blank: false,
    })
    expect(eng.rows[1]).toMatchObject({ pick: 'A', key: 'C', right: false })
    expect(eng.rows[2]).toMatchObject({ pick: '', key: 'B', right: false, blank: true })
  })

  it('keeps placeholder rows when the quiz record was deleted', () => {
    const [rec] = buildStudentReview([
      { id: 'gone', quizId: 'deleted', studentNo: 1, answers: [0, -1], correct: 1, total: 2, percent: 50, createdAt: 1 },
    ], [], student)
    expect(rec.quiz).toBe('Quiz')
    expect(rec.rows).toHaveLength(2)
    expect(rec.rows[0]).toMatchObject({ n: 1, pick: 'A', key: '', right: false })
    expect(rec.rows[1].blank).toBe(true)
  })
})

describe('reviewSummary', () => {
  it('counts correct, incorrect and unanswered across quizzes', () => {
    expect(reviewSummary(buildStudentReview(sheets, quizzes, student))).toEqual({
      total: 4, correct: 2, incorrect: 1, unanswered: 1,
    })
  })
})

describe('filterReview', () => {
  const records = buildStudentReview(sheets, quizzes, student)

  it('returns everything for all', () => {
    expect(filterReview(records, 'all')).toHaveLength(2)
  })

  it('keeps only wrong rows and drops quizzes with none', () => {
    const rows = filterReview(records, 'incorrect')
    expect(rows).toHaveLength(1)
    expect(rows[0].rows.map(r => r.n)).toEqual([2])
  })

  it('keeps only blank rows', () => {
    const rows = filterReview(records, 'blank')
    expect(rows).toHaveLength(1)
    expect(rows[0].rows.map(r => r.n)).toEqual([3])
  })
})
