// Quiz ownership helpers. A quiz now belongs to one class, but records made
// before that field existed (or whose class was deleted) still need a label.
// All pure functions so the grouping and fallbacks are unit-testable.

/** The heading a quiz card should use; never fall back to a bare subject. */
export function quizTitle(quiz) {
  const title = String(quiz?.title || '').trim()
  if (title) return title
  const subject = String(quiz?.subject || '').trim()
  return subject ? `${subject} quiz` : 'Untitled quiz'
}

/**
 * The class a quiz is assigned to, preferring the live class (so renames show)
 * and falling back to the snapshotted name when the class was deleted.
 * @returns {{ id: string, name: string, subject?: string, missing?: boolean } | null}
 */
export function resolveQuizClass(quiz, classes = []) {
  if (!quiz?.classId) return null
  const live = classes.find(c => c?.id === quiz.classId)
  if (live) return live
  const name = String(quiz.className || '').trim()
  return name ? { id: quiz.classId, name, subject: '', missing: true } : null
}

export function quizClassLabel(quiz, classes = []) {
  return resolveQuizClass(quiz, classes)?.name || 'No class yet'
}

/**
 * Group quizzes under their class, keeping the caller's class order, then a
 * synthetic group for deleted classes and finally unassigned quizzes.
 * @returns {Array<{ id: string, name: string, subject: string,
 *   quizzes: any[], missing: boolean, unassigned: boolean }>}
 */
export function groupQuizzesByClass(quizzes = [], classes = []) {
  const groups = []
  const byId = new Map()
  for (const c of classes) {
    const group = {
      id: c.id,
      name: c.name || 'Class',
      subject: c.subject || '',
      quizzes: [],
      missing: false,
      unassigned: false,
    }
    groups.push(group)
    byId.set(c.id, group)
  }

  const unassigned = {
    id: '__unassigned__',
    name: 'No class yet',
    subject: '',
    quizzes: [],
    missing: false,
    unassigned: true,
  }
  const missing = new Map()

  for (const q of quizzes) {
    const live = q?.classId ? byId.get(q.classId) : null
    if (live) {
      live.quizzes.push(q)
      continue
    }
    if (q?.classId && String(q.className || '').trim()) {
      let group = missing.get(q.classId)
      if (!group) {
        group = {
          id: `missing:${q.classId}`,
          name: q.className,
          subject: '',
          quizzes: [],
          missing: true,
          unassigned: false,
        }
        missing.set(q.classId, group)
        groups.push(group)
      }
      group.quizzes.push(q)
      continue
    }
    unassigned.quizzes.push(q)
  }

  const out = groups.filter(g => g.quizzes.length)
  if (unassigned.quizzes.length) out.push(unassigned)
  return out
}
