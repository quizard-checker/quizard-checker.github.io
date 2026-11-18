// Quizard's printed sheets and scanner are A–D only. Normalize every quiz
// item at the edit/storage boundary so an imported fifth choice, a stray
// string index, or a malformed option list can never reach the sheet printer
// or the OMR reader.
const OPTION_COUNT = 4

export function normalizeQuizItems(items) {
  return (Array.isArray(items) ? items : []).map(item => {
    const source = item && typeof item === 'object' ? item : {}
    const options = (Array.isArray(source.options) ? source.options : []).slice(0, OPTION_COUNT)
    while (options.length < OPTION_COUNT) options.push('')
    const rawAnswer = source.answerIndex
    const answer = rawAnswer === null || rawAnswer === undefined || rawAnswer === ''
      ? NaN
      : Number(rawAnswer)
    const answerIndex = Number.isInteger(answer) && answer >= 0 && answer < OPTION_COUNT
      ? answer
      : -1
    return {
      ...source,
      options: options.map(option => String(option ?? '')),
      answerIndex,
    }
  })
}
