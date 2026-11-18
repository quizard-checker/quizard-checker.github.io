// Validate a pasted answer key before it is allowed to build a quiz.
// The parser in answerkey.js is deliberately forgiving because answer-only
// keys can be just words. Multiple-choice mode is strict: a question, four
// choices A–D, and a matching answer must all be present.
export function validateKey(parsed, mode = 'mcq', raw = '') {
  const items = parsed?.items || []
  if (!items.length) return { ok: false, message: 'No questions or answers detected.' }

  if (mode === 'letters') {
    if (!['letters', 'keyed'].includes(parsed.format)) {
      return { ok: false, message: 'Paste only A–D letters — for example 1.B 2.C 3.A.' }
    }
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const letter = String(item.answerLetter || item.answer || '').trim().toUpperCase()
      const index = Number(item.answerIndex)
      const valid = (Number.isInteger(index) && index >= 0 && index < 4) || /^[A-D]$/.test(letter)
      if (!valid) return { ok: false, message: `Item ${item.n || i + 1} needs a letter A–D.` }
    }
    return { ok: true, message: `${items.length} letters ready.` }
  }

  if (mode === 'answers') {
    if (!['answers', 'qa'].includes(parsed.format)) {
      return { ok: false, message: 'Paste numbered answers or question → answer lines.' }
    }
    for (let i = 0; i < items.length; i++) {
      if (!String(items[i].answer || '').trim()) {
        return { ok: false, message: `Answer ${items[i].n || i + 1} is empty.` }
      }
    }
    return { ok: true, message: `${items.length} answers ready.` }
  }

  // Multiple choice is the strict default.
  if (parsed.format !== 'mcq') {
    return {
      ok: false,
      message: 'This is not a multiple-choice key. Add a numbered question, choices A–D, and the answer.',
    }
  }
  if (/(^|\n)\s*E[\).]\s+\S/i.test(raw) || /(?:answer|key)\s*[:\-]?\s*E\b/i.test(raw)) {
    return { ok: false, message: 'Only choices A–D are supported. Replace E with A–D.' }
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const n = item.n || i + 1
    if (!String(item.question || '').trim()) {
      return { ok: false, message: `Question ${n} is missing its question text.` }
    }
    const options = Array.isArray(item.options) ? item.options : []
    if (options.length !== 4 || options.some(option => !String(option ?? '').trim())) {
      return { ok: false, message: `Question ${n} needs exactly four choices A–D.` }
    }
    const answer = Number(item.answerIndex)
    if (!Number.isInteger(answer) || answer < 0 || answer > 3) {
      return { ok: false, message: `Question ${n} needs a correct answer A–D.` }
    }
  }
  return { ok: true, message: `${items.length} multiple-choice questions ready.` }
}
