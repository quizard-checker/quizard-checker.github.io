// Teacher quiz builder — fully offline. The quiz mirrors the teacher's answer
// key ("Anchor to my key"): one item per key entry, the key's answer must
// survive as the correct option. Entries that already carry question + options
// are used VERBATIM; letters-only entries ("1-B 2-D…" / BCADBACD) become a
// scoring grid — the teacher's own paper carries the questions; entries with
// only an answer text stay as placeholder items the teacher completes by hand
// in the review editor. Output items are always MCQ with exactly 4 options
// (bubble sheets are A–D by design). No AI anywhere.

export const MAX_ITEMS = 50

/**
 * @param {{ mode: string, keyItems?: any[], count: number, subject?: string }} opts
 */
export async function generateTeacherQuiz(opts) {
  if (opts.mode !== 'key') {
    const err = new Error('AI quiz modes were removed — anchor the quiz to your answer key.')
    err.code = 'mode_removed'
    throw err
  }
  const count = clampCount(opts.count)
  return generateFromKey(opts, count)
}

export function clampCount(n) {
  const v = Math.round(Number(n) || 0)
  return Math.max(1, Math.min(MAX_ITEMS, v || 10))
}

function emptyResponse() {
  const err = new Error('The key produced no usable entries. Add at least one answer (or a full question with options).')
  err.code = 'empty_response'
  return err
}

// ── 'key' mode: the quiz mirrors the teacher's answer key ────────────────

// "B" is a position on the teacher's own paper, not an answer.
function isBareLetter(answer) {
  return /^[A-Da-d]$/.test(String(answer ?? '').trim())
}

// "E" or "z" as a whole answer is a typo, not a word — bubble sheets have no
// option E, so it can never become a correct answer. Refuse it.
function isOutOfRangeLetter(answer) {
  return /^[A-Za-z]$/.test(String(answer ?? '').trim()) && !isBareLetter(answer)
}

async function generateFromKey(opts, count) {
  const entries = (opts.keyItems || []).slice(0, count)
  if (!entries.length) {
    const err = new Error('Paste your answer key first.')
    err.code = 'no_key'
    throw err
  }
  const typo = entries.find(it => isOutOfRangeLetter(it.answer))
  if (typo) {
    const err = new Error(`Entry ${typo.n ?? '?'} has the answer “${String(typo.answer).trim().toUpperCase()}” — bubble sheets only have options A–D. Fix that entry in your key.`)
    err.code = 'letter_out_of_range'
    throw err
  }

  const isComplete = it => it.options?.length >= 2 && it.answerIndex >= 0
  const verbatim = []
  const bare = []
  const open = []
  entries.forEach((it, keyIndex) => {
    if (isComplete(it)) verbatim.push({ it, keyIndex, keyAnswer: String(it.answer ?? ''), origin: 'teacher', mismatch: false })
    else if (isBareLetter(it.answer)) bare.push({ entry: it, keyIndex })
    else open.push({ entry: it, keyIndex })
  })

  // Letters-only entries ("1-B 2-D…" / BCADBACD): the teacher's own paper
  // carries the questions, so the quiz only needs the scoring grid — an empty
  // row per number whose answerIndex is the letter's position. Bubble sheets
  // print from these and the scanner scores against them.
  const bareRows = bare.map(({ entry, keyIndex }) => ({
    it: { question: '', options: ['', '', '', ''], answerIndex: 'ABCD'.indexOf(String(entry.answer).trim().toUpperCase()) },
    keyIndex,
    keyAnswer: String(entry.answer).trim().toUpperCase(),
    origin: 'teacher',
    mismatch: false,
  }))

  // Entries with the old paper's letter but no choices yet ("1. B. Nucleus"):
  // the correct letter is known, so the scoring grid is already right — the
  // teacher can type the option text in the review editor later.
  const letteredRows = open
    .filter(({ entry }) => /^[A-Da-d]$/.test(String(entry.answerLetter || '').trim()))
    .map(({ entry, keyIndex }) => ({
      it: {
        question: String(entry.question || ''),
        options: ['', '', '', ''],
        answerIndex: 'ABCD'.indexOf(String(entry.answerLetter).trim().toUpperCase()),
      },
      keyIndex,
      keyAnswer: String(entry.answerLetter).trim().toUpperCase(),
      origin: 'teacher',
      mismatch: false,
    }))

  // Entries with only an answer text (question → "Photosynthesis"): nothing
  // to shade yet, so they land as placeholder rows the teacher completes by
  // hand in the review editor — question, four options, then the key answer.
  const openRows = open
    .filter(({ entry }) => !/^[A-Da-d]$/.test(String(entry.answerLetter || '').trim()))
    .map(({ entry, keyIndex }) => ({
      it: {
        question: String(entry.question || ''),
        options: ['', '', '', ''],
        answerIndex: entry.answerIndex >= 0 ? entry.answerIndex : -1,
      },
      keyIndex,
      keyAnswer: String(entry.answer ?? ''),
      origin: 'teacher',
      mismatch: false,
    }))

  const rows = [...verbatim, ...bareRows, ...letteredRows, ...openRows]
  if (!rows.length) throw emptyResponse()
  return finalizeKeyed(rows, entries.length)
}

// Keyed responses carry the entry number they answer, so a dropped or
// duplicated row cannot shift every later entry by one.
function finalizeKeyed(rows, total) {
  return [...rows]
    .sort((a, b) => a.keyIndex - b.keyIndex)
    .slice(0, total)
    .map((r, i) => ({
      n: i + 1,
      question: r.it.question,
      options: r.it.options,
      answerIndex: r.it.answerIndex,
      keyIndex: r.keyIndex,
      keyAnswer: r.keyAnswer,
      keyOrigin: r.origin,
      keyMismatch: !!r.mismatch,
    }))
}
