// Resolve the bundled demo sheet against the local demo data. The sheet's QR
// uses stable snapshot keys, not the per-account storage ids, so one printed
// demo sheet links correctly on any device that has loaded the demo world.
//
// Old demo data (seeded before demoKey existed) still resolves by the known
// class name and quiz subject/title; re-loading demo data adds the keys.

const CLASS_FALLBACK = {
  'demo-cls-eng': 'English 8-B',
  'demo-cls-sci': 'Science 7-A',
}

const QUIZ_FALLBACK = {
  'demo-quiz-2': { subject: 'English', title: 'Verb Tenses' },
  'demo-quiz-3': { subject: 'Science', title: 'Plate Tectonics — quick check' },
  'demo-quiz-1': { subject: 'Science', title: 'Cell Basics' },
}

/** The sheet bundled with the app and docs, and the record it links to. */
export const DEMO_SHEET = {
  classKey: 'demo-cls-eng',
  quizKey: 'demo-quiz-2',
  studentNo: 1,
}

/**
 * @param {{ demo?: { classKey: string, quizKey: string, studentNo: number } } | null} claim
 * @param {Array} classes
 * @param {Array} quizzes
 * @returns {{ cls: any, quiz: any, student: any } | null}
 */
export function resolveDemoSheet(claim, classes = [], quizzes = []) {
  const demo = claim?.demo
  if (!demo) return null

  const cls = classes.find(c => c?.demo && (
    c.demoKey === demo.classKey ||
    (!c.demoKey && c.name === CLASS_FALLBACK[demo.classKey])
  ))
  const quiz = quizzes.find(q => q?.demo && (
    q.demoKey === demo.quizKey ||
    (!q.demoKey && matches(q, QUIZ_FALLBACK[demo.quizKey]))
  ))
  if (!cls || !quiz) return null

  const student = (cls.students || []).find(s => s.no === demo.studentNo)
  if (!student) return null
  return { cls, quiz, student }
}

function matches(quiz, signature) {
  return !!signature && quiz.subject === signature.subject && quiz.title === signature.title
}
