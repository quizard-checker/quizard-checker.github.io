// Bundled demo world for the built-in demo tools. The dataset is a snapshot of
// a real teacher device (classes, answer keys, quizzes and already-checked
// sheets — see demo-data.js), so every screen looks like a live week rather
// than an empty shell.
//
// Records are re-keyed to fixed `demo-*` ids and tagged `demo: true`:
//   - re-loading is idempotent (storage upserts instead of duplicating), and
//   - "Remove demo data" can sweep them without touching the teacher's records.
// The source ids are only used to remap sheet references, so loading the demo
// never overwrites a real class, key or quiz even on the same device.
import { saveClass, saveKey, saveQuiz, saveSheet, getActiveAccountId, ensureDefaultAccount } from './storage.js'
import { DEMO_SNAPSHOT } from './demo-data.js'

const MINUTE = 60_000
const clone = (value) => JSON.parse(JSON.stringify(value))

// Store keys are global, so demo records must be unique per profile too —
// otherwise loading the demo in a second account overwrites the first
// account's demo rows (save() upserts by id).
function demoPrefix(accountId) {
  const tag = String(accountId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)
  return `demo-${tag || 'local'}-`
}

export function demoSummary() {
  const { classes, keys, quizzes, sheets } = DEMO_SNAPSHOT
  return `${classes.length} classes · ${keys.length} keys · ${quizzes.length} quizzes · ${sheets.length} graded sheets`
}

export function buildDemoWorld(accountId = '') {
  const now = Date.now()
  const prefix = demoPrefix(accountId)
  const classIds = new Map(DEMO_SNAPSHOT.classes.map((c, i) => [c.id, `${prefix}cls-${i + 1}`]))
  const keyIds = new Map(DEMO_SNAPSHOT.keys.map((k, i) => [k.id, `${prefix}key-${i + 1}`]))
  const quizIds = new Map(DEMO_SNAPSHOT.quizzes.map((q, i) => [q.id, `${prefix}quiz-${i + 1}`]))

  // Newest-first order is kept from the snapshot: each list sorts by createdAt,
  // so seed at descending offsets.
  const classes = DEMO_SNAPSHOT.classes.map((c, i) => ({
    ...clone(c),
    id: classIds.get(c.id),
    // Stable across profiles and devices: the printed demo sheet can point at
    // this class even though the storage id is re-keyed per account.
    demoKey: c.id,
    students: (c.students || []).map((st, si) => ({
      ...clone(st),
      id: `${prefix}st-${i + 1}-${st.no || si + 1}`,
    })),
    createdAt: now - i * MINUTE,
    demo: true,
  }))

  const keys = DEMO_SNAPSHOT.keys.map((k, i) => ({
    ...clone(k),
    id: keyIds.get(k.id),
    createdAt: now - i * MINUTE,
    demo: true,
  }))

  const quizzes = DEMO_SNAPSHOT.quizzes.map((q, i) => ({
    ...clone(q),
    id: quizIds.get(q.id),
    demoKey: q.id,
    createdAt: now - i * MINUTE,
    demo: true,
  }))

  const sheets = DEMO_SNAPSHOT.sheets.map((s, i) => ({
    ...clone(s),
    id: `${prefix}sheet-${i + 1}`,
    classId: classIds.get(s.classId) || s.classId,
    quizId: quizIds.get(s.quizId) || s.quizId,
    createdAt: now - i * MINUTE,
    demo: true,
  }))

  return { classes, keys, quizzes, sheets }
}

/** Pour the demo world through the real storage layer. Re-runs overwrite. */
export async function seedDemoData() {
  const accountId = getActiveAccountId() || (await ensureDefaultAccount()).id
  const world = buildDemoWorld(accountId)
  for (const k of world.keys) await saveKey(k)
  for (const q of world.quizzes) await saveQuiz(q)
  for (const c of world.classes) await saveClass(c)
  for (const s of world.sheets) await saveSheet(s)
  return world
}
