// One student's answer review: the latest scan per quiz, every question
// resolved to the student's pick, the keyed answer and the full choice list.
// Pure functions so the per-quiz grouping and filters are unit-testable.
import { isStudentSheet, quizName } from './gradebook.js'

const LETTERS = 'ABCDEFGHIJ'

/**
 * The latest saved sheet per quiz for one roster student, newest quiz first.
 * Rescanning a paper corrects the old row, so only the latest attempt is shown.
 * @param {Array<{ quizId?: string, studentNo?: number|null, studentName?: string,
 *   createdAt?: number }>} sheets
 * @param {{ no?: number, name?: string }} student
 */
export function latestStudentSheets(sheets, student) {
  const seen = new Set()
  return sheets
    .filter(s => isStudentSheet(s, student))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .filter(s => {
      if (!s.quizId || seen.has(s.quizId)) return false
      seen.add(s.quizId)
      return true
    })
}

/**
 * @param {Array} sheets every sheet saved for the class
 * @param {Array<{ id: string, subject?: string, title?: string,
 *   items?: Array<{ n?: number, question?: string, options?: string[],
 *   answerIndex?: number }> }>} quizzes
 * @param {{ no?: number, name?: string }} student
 * @returns {Array<{ id: string, quizId: string, quiz: string, percent: number,
 *   correct: number, total: number, date: number, rows: Array<{
 *     n: number, question: string, options: string[], pickIndex: number|null,
 *     pick: string, keyIndex: number|null, key: string,
 *     right: boolean, blank: boolean }> }>}
 */
export function buildStudentReview(sheets, quizzes, student) {
  const byId = new Map(quizzes.map(q => [q.id, q]))
  return latestStudentSheets(sheets, student).map(s => {
    const quiz = byId.get(s.quizId)
    const items = quiz?.items || []
    // A saved sheet knows how many questions it had even if the quiz record
    // was deleted; keep those rows visible instead of dropping the attempt.
    const count = items.length || Math.max(Number(s.total) || 0, s.answers?.length || 0)
    const rows = Array.from({ length: count }, (_, i) => {
      const item = items[i] || {}
      const pick = s.answers?.[i]
      const has = pick != null && pick >= 0
      const keyIndex = item.answerIndex != null && item.answerIndex >= 0 ? item.answerIndex : null
      return {
        n: item.n || i + 1,
        question: item.question || '',
        options: Array.isArray(item.options) ? item.options : [],
        pickIndex: has ? pick : null,
        pick: has ? LETTERS[pick] || '' : '',
        keyIndex,
        key: keyIndex != null ? LETTERS[keyIndex] || '' : '',
        right: has && keyIndex != null && pick === keyIndex,
        blank: !has,
      }
    })
    return {
      id: s.id,
      quizId: s.quizId,
      quiz: quizName(quiz) || 'Quiz',
      percent: Number(s.percent) || 0,
      correct: Number(s.correct) || 0,
      total: Number(s.total) || rows.length,
      date: s.createdAt || 0,
      rows,
    }
  })
}

/** Counts across every question in every quiz attempt. */
export function reviewSummary(records) {
  let total = 0, correct = 0, incorrect = 0, unanswered = 0
  for (const rec of records) {
    for (const row of rec.rows) {
      total++
      if (row.blank) unanswered++
      else if (row.right) correct++
      else incorrect++
    }
  }
  return { total, correct, incorrect, unanswered }
}

/**
 * Filter the review by question state. Quizzes with no matching questions are
 * dropped entirely, so the Incorrect view never shows an empty card.
 * @param {Array} records
 * @param {'all'|'incorrect'|'blank'} filter
 */
export function filterReview(records, filter) {
  if (filter === 'all') return records
  return records
    .map(rec => ({
      ...rec,
      rows: rec.rows.filter(row => filter === 'incorrect' ? (!row.blank && !row.right) : row.blank),
    }))
    .filter(rec => rec.rows.length)
}

export { LETTERS }
