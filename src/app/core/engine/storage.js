import { openDB } from 'idb'
import { nextState, GRADES } from './srs.js'

/** @typedef {import('./db-types.js').Doc} Doc */
/** @typedef {import('./db-types.js').DocMeta} DocMeta */
/** @typedef {import('./db-types.js').Account} Account */
/** @typedef {import('./db-types.js').Attempt} Attempt */
/** @typedef {import('./db-types.js').Mistake} Mistake */
/** @typedef {import('./db-types.js').SrsRecord} SrsRecord */
/** @typedef {import('./db-types.js').Deck} Deck */
/** @typedef {import('./db-types.js').DocImage} DocImage */
/** @typedef {import('./db-types.js').WeakTerm} WeakTerm */

const dbPromise = openDB('quizard', 11, {
  upgrade(db, oldVersion, _newVersion, transaction) {
    if (oldVersion < 8) {
      // docs gain optional `original` (source file blob) and `visualAnalysis`
      // (cached Gemini document analysis) fields — no structural change needed.
    }
    if (oldVersion < 9) {
      // exams: exam-prep sessions created through the wizard chat
      const exams = db.createObjectStore('exams', { keyPath: 'id' })
      exams.createIndex('accountId', 'accountId')
      exams.createIndex('status', 'status')
    }
    if (oldVersion < 10) {
      // teacher app: class rosters and answer keys
      const classes = db.createObjectStore('classes', { keyPath: 'id' })
      classes.createIndex('accountId', 'accountId')
      const keys = db.createObjectStore('keys', { keyPath: 'id' })
      keys.createIndex('accountId', 'accountId')
    }
    if (oldVersion < 11) {
      // teacher app: generated quizzes (bubble-sheet scans land in Phase 3)
      const quizzes = db.createObjectStore('quizzes', { keyPath: 'id' })
      quizzes.createIndex('accountId', 'accountId')
      db.createObjectStore('sheets', { keyPath: 'id' })
        .createIndex('accountId', 'accountId')
    }
    if (oldVersion < 1) {
      const docs = db.createObjectStore('docs', { keyPath: 'id' })
      docs.createIndex('createdAt', 'createdAt')
      const attempts = db.createObjectStore('attempts', { keyPath: 'id' })
      attempts.createIndex('docId', 'docId')
      attempts.createIndex('date', 'date')
    }
    if (oldVersion < 2) {
      const mistakes = db.createObjectStore('mistakes', { keyPath: 'id' })
      mistakes.createIndex('docId', 'docId')
    }
    if (oldVersion < 3) {
      db.createObjectStore('accounts', { keyPath: 'id' })
    }
    if (oldVersion < 4) {
      const images = db.createObjectStore('images', { keyPath: 'id' })
      images.createIndex('docId', 'docId')
    }
    if (oldVersion < 5) {
      const srs = db.createObjectStore('srs', { keyPath: 'id' })
      srs.createIndex('docId', 'docId')
    }
    if (oldVersion < 6) {
      const srs = transaction.objectStore('srs')
      if (!srs.indexNames.contains('accountId')) srs.createIndex('accountId', 'accountId')
      if (!srs.indexNames.contains('dueAt')) srs.createIndex('dueAt', 'dueAt')
    }
    if (oldVersion < 7) {
      const decks = db.createObjectStore('decks', { keyPath: 'id' })
      decks.createIndex('accountId', 'accountId')
      decks.createIndex('name', 'name')
    }
  },
  async blocked() { /* another tab holds an older connection */ }
})

// Seed the srs store from previously banked mistakes (runs once per db,
// outside the version-upgrade callback so it can be async).
let migrated = false
async function migrateMistakesToSrs() {
  if (migrated) return
  migrated = true
  try {
    const db = await dbPromise
    if (!db.objectStoreNames.contains('srs')) return
    const mistakes = await db.getAll('mistakes')
    if (!mistakes.length) return
    const existingIds = new Set((await db.getAll('srs')).map(s => s.id))
    const now = Date.now()
    for (const m of mistakes) {
      if (existingIds.has(m.id)) continue
      await db.put('srs', {
        id: m.id,
        accountId: m.accountId,
        docId: m.docId,
        term: m.term,
        sentence: m.sentence,
        type: m.type,
        ease: 2.5,
        intervalDays: 0,
        dueAt: now,
        reps: 0,
        lapses: Math.max(0, (m.wrongCount || 1) - 1),
        createdAt: m.createdAt || now,
        lastReviewedAt: m.lastWrongAt || now
      })
    }
  } catch { /* non-fatal */ }
}

let activeAccountId = null

export function setActiveAccount(id) {
  activeAccountId = id
  try {
    if (id) localStorage.setItem('quizard-active-account', id)
    else localStorage.removeItem('quizard-active-account')
  } catch { /* private mode / storage full — the in-memory id still works */ }
}

export function getActiveAccountId() {
  return activeAccountId
}

async function requireAccount() {
  if (activeAccountId) return activeAccountId
  const acc = await ensureDefaultAccount()
  return acc.id
}

const PBKDF2_ITERATIONS = 100000

async function pbkdf2Bits(pin, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  return crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256)
}

function bytesToB64(u8) {
  let s = ''
  for (const b of u8) s += String.fromCharCode(b)
  return btoa(s)
}

function b64ToBytes(b64) {
  const bin = atob(b64)
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return u8
}

function timingSafeEq(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// Salted PBKDF2-SHA256 (100k iterations). Format: pbkdf2$<iters>$<saltB64>$<hashB64>
export async function hashPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const bits = await pbkdf2Bits(pin, salt, PBKDF2_ITERATIONS)
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToB64(salt)}$${bytesToB64(new Uint8Array(bits))}`
}

async function legacySha256Hex(pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('quizard:' + pin))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// Verifies pin against a stored hash. Returns { ok } and — when the stored
// hash is the legacy unsalted format and the pin matches — { upgrade }
// carrying the new pbkdf2 hash so the caller can persist it.
export async function verifyPin(pin, stored) {
  if (!stored) return { ok: false }
  if (stored.startsWith('pbkdf2$')) {
    const [, itersStr, saltB64, hashB64] = stored.split('$')
    const iters = Number(itersStr)
    if (!iters || !saltB64 || !hashB64) return { ok: false }
    const bits = await pbkdf2Bits(pin, b64ToBytes(saltB64), iters)
    return { ok: timingSafeEq(bytesToB64(new Uint8Array(bits)), hashB64) }
  }
  if ((await legacySha256Hex(pin)) === stored) {
    return { ok: true, upgrade: await hashPin(pin) }
  }
  return { ok: false }
}

export async function listAccounts() {
  const db = await dbPromise
  const all = await db.getAll('accounts')
  return all.sort((a, b) => a.createdAt - b.createdAt)
}

/** @param {{ name: string, pinHash?: string | null, color: string }} data */
export async function createAccount({ name, pinHash = null, color }) {
  const db = await dbPromise
  const acc = { id: uid(), name: name.trim(), pinHash, color, createdAt: Date.now() }
  await db.put('accounts', acc)
  return acc
}

/** @param {string} id @returns {Promise<Account | undefined>} */
export async function getAccount(id) {
  if (!id) return undefined
  const db = await dbPromise
  return db.get('accounts', id)
}

/** @param {string} id @param {Partial<Account>} patch @returns {Promise<Account | null>} */
export async function updateAccount(id, patch) {
  if (!id) return null
  const db = await dbPromise
  const acc = await db.get('accounts', id)
  if (!acc) return null
  const updated = { ...acc, ...patch }
  await db.put('accounts', updated)
  return updated
}

export async function deleteAccount(id) {
  if (!id) return
  const db = await dbPromise
  const stores = ['accounts', 'docs', 'attempts', 'mistakes', 'images', 'srs', 'decks', 'exams', 'classes', 'keys', 'quizzes', 'sheets']
  const tx = db.transaction(stores, 'readwrite')
  tx.objectStore('accounts').delete(id)
  for (const storeName of stores.slice(1)) {
    const store = tx.objectStore(storeName)
    let cursor = await store.openCursor()
    while (cursor) {
      if (cursor.value.accountId === id) cursor.delete()
      cursor = await cursor.continue()
    }
  }
  await tx.done
}

export async function accountHasData(accountId) {
  const db = await dbPromise
  // Includes the teacher stores: a profile with classes, keys, quizzes or
  // checked sheets is NOT an empty auto-created account and must never be
  // swept when another profile is added.
  for (const storeName of ['docs', 'attempts', 'mistakes', 'images', 'srs', 'decks', 'exams', 'classes', 'keys', 'quizzes', 'sheets']) {
    const store = db.transaction(storeName).objectStore(storeName)
    let cursor = await store.openCursor()
    while (cursor) {
      if (cursor.value.accountId === accountId) return true
      cursor = await cursor.continue()
    }
  }
  return false
}

export async function ensureDefaultAccount() {
  const db = await dbPromise
  let accounts = await db.getAll('accounts')
  if (accounts.length) return accounts[0]
  const acc = { id: uid(), name: 'My account', pinHash: null, color: '#C4713B', createdAt: Date.now() }
  await db.put('accounts', acc)
  const tx = db.transaction(['docs', 'attempts', 'mistakes'], 'readwrite')
  for (const storeName of ['docs', 'attempts', 'mistakes']) {
    const store = tx.objectStore(storeName)
    let cursor = await store.openCursor()
    while (cursor) {
      if (!cursor.value.accountId) {
        const updated = { ...cursor.value, accountId: acc.id }
        cursor.update(updated)
      }
      cursor = await cursor.continue()
    }
  }
  await tx.done
  return acc
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2)
}

const DOC_TRASH_TTL_MS = 60_000

function mistakeId(docId, term, sentence) {
  let h = 5381 >>> 0
  for (let i = 0; i < sentence.length; i++) h = ((h << 5) + h + sentence.charCodeAt(i)) | 0
  return `${docId}__${term.toLowerCase().replace(/\s+/g, '-')}__${h >>> 0}`
}

/** @param {{ name: string, type: string, text: string, topics?: unknown[], folder?: string | null, tags?: string[], original?: Blob | null }} opts @returns {Promise<Doc>} */
export async function saveDoc({ name, type, text, topics, folder = null, tags = [], original = null }) {
  const db = await dbPromise
  const accountId = await requireAccount()
  const doc = {
    id: uid(),
    accountId,
    name,
    type,
    text,
    original: original instanceof Blob ? original : null,
    visualAnalysis: null,
    topics: Array.isArray(topics) ? topics : [],
    folder: folder && String(folder).trim() ? String(folder).trim() : null,
    tags: Array.isArray(tags) ? tags.map(t => String(t).trim()).filter(Boolean) : [],
    wordCount: (text.match(/\S+/g) || []).length,
    createdAt: Date.now(),
    bestScore: null,
    attempts: 0
  }
  await db.put('docs', doc)
  return doc
}

export { deriveFolders, deriveTags } from './taxonomy.js'

/** @param {string} id @returns {Promise<Doc | null>} */
export async function getDoc(id) {
  if (!id) return null
  const db = await dbPromise
  const doc = await db.get('docs', id)
  if (doc?.deletedAt) return null
  if (doc && activeAccountId && doc.accountId !== activeAccountId) return null
  return doc
}

/** @returns {Promise<DocMeta[]>} */
export async function listDocs() {
  const db = await dbPromise
  const accountId = await requireAccount()
  // Project out the (potentially huge) `text` field — listings only need
  // metadata, so we avoid pulling megabytes of prose into memory on every
  // Library / History / Import render.
  const out = []
  const stale = []
  let cursor = await db.transaction('docs').store.openCursor()
  while (cursor) {
    const d = cursor.value
    if (d.accountId === accountId) {
      if (d.deletedAt) {
        if (Date.now() - d.deletedAt >= DOC_TRASH_TTL_MS) stale.push(d.id)
      } else {
        const { text, original, visualAnalysis, ...meta } = d
        out.push(meta)
      }
    }
    cursor = await cursor.continue()
  }
  if (stale.length) await Promise.all(stale.map(id => purgeDocRecords(id)))
  out.sort((a, b) => b.createdAt - a.createdAt)
  return out
}

// ── Teacher app: class rosters and answer keys ────────────────────────────

/**
 * @typedef {{ id?: string, no?: number, name: string, grade: string, section: string }} RosterStudent
 */
/**
 * @typedef {{ id: string, accountId: string, name: string, grade: string,
 *   section: string, subject?: string, students: RosterStudent[],
 *   createdAt: number }} TeacherClass
 */
/**
 * @typedef {{ id: string, accountId: string, subject: string, title: string,
 *   format: 'qa'|'answers'|'letters'|'mcq', items: { n: number, question: string,
 *   answer?: string, options?: string[], answerIndex?: number }[],
 *   createdAt: number }} AnswerKey
 */

// Classes saved before student numbering existed get id/no assigned on
// first read (and persisted), so scans can always resolve the number.
function migrateClassStudents(c) {
  if (!c.students?.length) return c
  if (c.students.every(st => st.id && st.no)) return c
  let nextNo = Math.max(0, ...c.students.map(st => st.no || 0)) + 1
  const students = c.students.map(st => {
    const out = { ...st }
    if (!out.id) out.id = uid()
    if (!out.no) out.no = nextNo++
    return out
  })
  return { ...c, students }
}

/** @returns {Promise<TeacherClass[]>} */
export async function listClasses() {
  const db = await dbPromise
  const accountId = await requireAccount()
  const all = await db.getAll('classes')
  const out = []
  for (const raw of all.filter(c => c.accountId === accountId)) {
    const c = migrateClassStudents(raw)
    if (c !== raw) await db.put('classes', c)
    out.push(c)
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

/** @param {Partial<TeacherClass>} data @returns {Promise<TeacherClass>} */
export async function saveClass(data) {
  const db = await dbPromise
  const accountId = await requireAccount()
  const existing = data.id ? await db.get('classes', data.id) : null
  const record = {
    id: existing?.id || data.id || uid(), accountId, name: '', grade: '', section: '', subject: '',
    students: [], createdAt: existing?.createdAt || Date.now(), ...data, accountId
  }
  if (!record.id) record.id = uid()
  // every student needs a stable id AND a stable number: the number is what
  // students shade on the bubble sheet, and it belongs to the student — not
  // to their position in the list — so roster edits never shift it.
  // Re-parsed rosters are matched back by name so editing keeps numbers.
  const prev = existing?.students || []
  let nextNo = Math.max(0, ...prev.map(st => st.no || 0), ...((record.students || []).map(st => st.no || 0))) + 1
  record.students = (record.students || []).map(st => {
    if (st.id && st.no) return st
    const prior = prev.find(p => p.id === st.id) || prev.find(p => p.name === st.name)
    if (prior) return { ...st, id: prior.id, no: prior.no }
    return { ...st, id: st.id || uid(), no: st.no || nextNo++ }
  })
  await db.put('classes', record)
  return record
}

/** @param {string} id @returns {Promise<TeacherClass | null>} */
export async function getClass(id) {
  if (!id) return null
  const db = await dbPromise
  const accountId = await requireAccount()
  let c = await db.get('classes', id)
  if (!c || c.accountId !== accountId) return null
  c = migrateClassStudents(c)
  await db.put('classes', c)
  return c
}

/** @param {string} id */
export async function deleteClass(id) {
  if (!id) return
  const db = await dbPromise
  await db.delete('classes', id)
}

/** @returns {Promise<AnswerKey[]>} */
export async function listKeys() {
  const db = await dbPromise
  const accountId = await requireAccount()
  const all = await db.getAll('keys')
  return all.filter(k => k.accountId === accountId).sort((a, b) => b.createdAt - a.createdAt)
}

/** @param {Partial<AnswerKey>} data @returns {Promise<AnswerKey>} */
export async function saveKey(data) {
  const db = await dbPromise
  const accountId = await requireAccount()
  const existing = data.id ? await db.get('keys', data.id) : null
  const record = {
    id: existing?.id || data.id || uid(), accountId, subject: '', title: '', format: 'answers',
    items: [], createdAt: existing?.createdAt || Date.now(), ...data, accountId
  }
  if (!record.id) record.id = uid()
  await db.put('keys', record)
  return record
}

/** @param {string} id @returns {Promise<AnswerKey | null>} */
export async function getKey(id) {
  if (!id) return null
  const db = await dbPromise
  const accountId = await requireAccount()
  const k = await db.get('keys', id)
  return k && k.accountId === accountId ? k : null
}

/** @param {string} id */
export async function deleteKey(id) {
  if (!id) return
  const db = await dbPromise
  await db.delete('keys', id)
}

/**
 * @typedef {{ id: string, accountId: string, subject: string, title: string,
 *   source: 'ai'|'key'|'format', keyOnly?: boolean,
 *   classId?: string, className?: string,
 *   items: { n: number,
 *   question: string, options: string[], answerIndex: number }[],
 *   createdAt: number }} TeacherQuiz
 */

/** @returns {Promise<TeacherQuiz[]>} */
export async function listQuizzes() {
  const db = await dbPromise
  const accountId = await requireAccount()
  const all = await db.getAll('quizzes')
  return all.filter(q => q.accountId === accountId).sort((a, b) => b.createdAt - a.createdAt)
}

/** @param {Partial<TeacherQuiz>} data @returns {Promise<TeacherQuiz>} */
export async function saveQuiz(data) {
  const db = await dbPromise
  const accountId = await requireAccount()
  const existing = data.id ? await db.get('quizzes', data.id) : null
  const record = {
    id: existing?.id || data.id || uid(), accountId, subject: '', title: '',
    source: 'ai', items: [], createdAt: existing?.createdAt || Date.now(),
    ...data, accountId
  }
  if (!record.id) record.id = uid()
  await db.put('quizzes', record)
  return record
}

/** @param {string} id @returns {Promise<TeacherQuiz | null>} */
export async function getQuiz(id) {
  if (!id) return null
  const db = await dbPromise
  const accountId = await requireAccount()
  const q = await db.get('quizzes', id)
  return q && q.accountId === accountId ? q : null
}

/** @param {string} id */
export async function deleteQuiz(id) {
  if (!id) return
  const db = await dbPromise
  await db.delete('quizzes', id)
}

/**
 * A checked sheet. `studentNo` / `grade` / `section` are a snapshot taken from
 * the roster entry at scan time — the same reason `className` is stored: a
 * report must stay accurate after the roster is later edited. Results saved
 * before these fields existed simply have them blank.
 * @typedef {{ id: string, accountId: string, classId: string, className: string,
 *   quizId: string, studentNo?: number | null, studentName: string,
 *   grade?: string, section?: string,
 *   answers: number[], flags: string[],
 *   correct: number, total: number, percent: number, photo?: string,
 *   createdAt: number }} SheetResult
 */

/** @param {Partial<SheetResult>} data @returns {Promise<SheetResult>} */
export async function saveSheet(data) {
  const db = await dbPromise
  const accountId = await requireAccount()
  const record = {
    id: data.id || uid(), accountId, classId: '', className: '', quizId: '',
    studentNo: null, studentName: '', grade: '', section: '',
    answers: [], flags: [], correct: 0, total: 0, percent: 0,
    createdAt: Date.now(), ...data, accountId
  }
  if (!record.id) record.id = uid()
  await db.put('sheets', record)
  return record
}

/** @param {{ classId?: string, quizId?: string }} [opts] @returns {Promise<SheetResult[]>} */
export async function listSheets(opts = {}) {
  const db = await dbPromise
  const accountId = await requireAccount()
  const all = await db.getAll('sheets')
  let out = all.filter(s => s.accountId === accountId)
  if (opts.classId) out = out.filter(s => s.classId === opts.classId)
  if (opts.quizId) out = out.filter(s => s.quizId === opts.quizId)
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

/** @param {string} id */
export async function deleteSheet(id) {
  if (!id) return
  const db = await dbPromise
  await db.delete('sheets', id)
}

/** @param {string} id @param {Partial<Doc>} patch @returns {Promise<Doc | null>} */
export async function updateDoc(id, patch) {
  if (!id) return null
  const db = await dbPromise
  const doc = await db.get('docs', id)
  if (!doc) return null
  const updated = { ...doc, ...patch }
  await db.put('docs', updated)
  return updated
}

export async function deleteDoc(id) {
  if (!id) return
  const db = await dbPromise
  const doc = await db.get('docs', id)
  if (!doc || (activeAccountId && doc.accountId !== activeAccountId)) return
  await db.put('docs', { ...doc, deletedAt: Date.now() })
}

export async function restoreDoc(id) {
  if (!id) return null
  const db = await dbPromise
  const doc = await db.get('docs', id)
  if (!doc || (activeAccountId && doc.accountId !== activeAccountId)) return null
  if (!doc.deletedAt) return doc
  const { deletedAt, ...restored } = doc
  await db.put('docs', restored)
  return restored
}

export async function purgeDeletedDoc(id) {
  if (!id) return
  await purgeDocRecords(id)
}

async function purgeDocRecords(id) {
  const db = await dbPromise
  const tx = db.transaction(['docs', 'attempts', 'images', 'srs', 'mistakes'], 'readwrite')
  const current = await tx.objectStore('docs').get(id)
  if (!current?.deletedAt) {
    await tx.done
    return false
  }
  tx.objectStore('docs').delete(id)
  const idx = tx.objectStore('attempts').index('docId')
  let cursor = await idx.openCursor(IDBKeyRange.only(id))
  while (cursor) {
    cursor.delete()
    cursor = await cursor.continue()
  }
  const imgIdx = tx.objectStore('images').index('docId')
  let imgCursor = await imgIdx.openCursor(IDBKeyRange.only(id))
  while (imgCursor) {
    imgCursor.delete()
    imgCursor = await imgCursor.continue()
  }
  const srsIdx = tx.objectStore('srs').index('docId')
  let srsCursor = await srsIdx.openCursor(IDBKeyRange.only(id))
  while (srsCursor) {
    srsCursor.delete()
    srsCursor = await srsCursor.continue()
  }
  const mIdx = tx.objectStore('mistakes').index('docId')
  let mCursor = await mIdx.openCursor(IDBKeyRange.only(id))
  while (mCursor) {
    mCursor.delete()
    mCursor = await mCursor.continue()
  }
  await tx.done
  return true
}

export async function saveDocImages(docId, images) {
  const db = await dbPromise
  const accountId = await requireAccount()
  const tx = db.transaction('images', 'readwrite')
  for (const img of images) {
    tx.store.put({
      id: uid(),
      docId,
      accountId,
      blob: img.blob,
      mime: img.mime,
      slideNumber: img.slideNumber ?? null,
      index: img.index
    })
  }
  await tx.done
}

export async function listDocImages(docId) {
  const db = await dbPromise
  const accountId = await requireAccount()
  const all = await db.getAllFromIndex('images', 'docId', docId)
  return all
    .filter(img => img.accountId === accountId)
    .sort((a, b) => a.index - b.index)
}

export async function countDocImages(docId) {
  const db = await dbPromise
  return db.countFromIndex('images', 'docId', docId)
}

/** @param {string} id @returns {Promise<DocImage | undefined>} */
export async function getImageById(id) {
  if (!id) return undefined
  const db = await dbPromise
  return db.get('images', id)
}

export async function saveAttempt(data) {
  const db = await dbPromise
  const accountId = await requireAccount()
  const attempt = { id: uid(), accountId, date: Date.now(), ...data }
  await db.put('attempts', attempt)

  if (!attempt.docId) return attempt
  const doc = await db.get('docs', attempt.docId)
  if (doc) {
    const patch = { attempts: (doc.attempts || 0) + 1 }
    if (attempt.percent != null && (doc.bestScore == null || attempt.percent > doc.bestScore)) {
      patch.bestScore = attempt.percent
    }
    await db.put('docs', { ...doc, ...patch })
  }
  return attempt
}

/** @param {string | null} docId @returns {Promise<Attempt[]>} */
export async function listAttempts(docId = null) {
  const db = await dbPromise
  const accountId = await requireAccount()
  if (docId) {
    const arr = await db.getAllFromIndex('attempts', 'docId', docId)
    return arr.filter(a => a.accountId === accountId).sort((a, b) => b.date - a.date)
  }
  const all = await db.getAll('attempts')
  return all.filter(a => a.accountId === accountId).sort((a, b) => b.date - a.date)
}

/** @param {{ docId: string, sentence: string, term: string, type: string }} opts @returns {Promise<Mistake>} */
export async function bankMistake({ docId, sentence, term, type }) {
  const db = await dbPromise
  const accountId = await requireAccount()
  const id = mistakeId(docId, term, sentence)
  const existing = await db.get('mistakes', id)
  if (existing) {
    existing.wrongCount = (existing.wrongCount || 1) + 1
    existing.lastWrongAt = Date.now()
    await db.put('mistakes', existing)
    return existing
  }
  const mistake = { id, accountId, docId, sentence, term, type, wrongCount: 1, createdAt: Date.now(), lastWrongAt: Date.now() }
  await db.put('mistakes', mistake)
  return mistake
}

/** Clears every banked miss for a term in a document. Knowing the term on ANY
 *  question is proof enough — the old sentence-exact match let weak spots
 *  survive correct answers, since drills re-ask from a different sentence. */
export async function resolveMistake(docId, term) {
  if (!docId || !term) return
  const db = await dbPromise
  const accountId = await requireAccount()
  const t = String(term).toLowerCase()
  const arr = await db.getAllFromIndex('mistakes', 'docId', docId)
  await Promise.all(arr
    .filter(m => m.accountId === accountId && String(m.term || '').toLowerCase() === t)
    .map(m => db.delete('mistakes', m.id)))
}

/** @param {string | null} [docId] */
export async function listMistakes(docId = null) {
  const db = await dbPromise
  const accountId = await requireAccount()
  if (docId) {
    const arr = await db.getAllFromIndex('mistakes', 'docId', docId)
    return arr.filter(m => m.accountId === accountId).sort((a, b) => b.lastWrongAt - a.lastWrongAt)
  }
  const all = await db.getAll('mistakes')
  return all.filter(m => m.accountId === accountId).sort((a, b) => b.lastWrongAt - a.lastWrongAt)
}

export async function countMistakes() {
  const all = await listMistakes()
  return all.length
}

// Aggregate the account's weakest terms across the mistake bank and the SRS
// schedule. A term only earns the weak-spot label after repeated failure
// (2+ misses across its banked records) — a single miss is already covered
// by Review answers and the term's SRS card. Returns
// [{ term, docId, sentence, type, weight }] sorted by weight (highest first).
// Used by the weak-spot drill, adaptive generation and the results card.
/** @param {string | null} accountId @param {string | null} docId @returns {Promise<WeakTerm[]>} */
export async function getWeakTerms(accountId = null, docId = null) {
  const acc = accountId || (await requireAccount())
  const db = await dbPromise
  const mistakes = (docId ? await listMistakes(docId) : await listMistakes())
    .filter(m => m.accountId === acc)
  const srs = (await db.getAllFromIndex('srs', 'accountId', acc))
    .filter(r => (docId ? r.docId === docId : true))
  const byTerm = new Map()
  const bump = (term, docId2, sentence, type, w, misses = 0) => {
    if (!term) return
    const key = `${docId2}__${term.toLowerCase()}`
    const cur = byTerm.get(key) || { term, docId: docId2, sentence, type, weight: 0, misses: 0 }
    cur.weight += w
    cur.misses += misses
    byTerm.set(key, cur)
  }
  for (const m of mistakes) bump(m.term, m.docId, m.sentence, m.type, 2 * (m.wrongCount || 1), m.wrongCount || 1)
  for (const r of srs) {
    // lapses hurt most; low ease and items already due add weight too
    const lapseW = (r.lapses || 0) * 2
    const easeW = r.ease != null && r.ease < 2.5 ? 1 : 0
    const dueW = (r.dueAt ?? 0) <= Date.now() ? 1 : 0
    bump(r.term, r.docId, r.sentence, r.type, lapseW + easeW + dueW)
  }
  return [...byTerm.values()]
    .filter(t => t.misses >= 2)
    .sort((a, b) => b.weight - a.weight)
}

// ── Saved decks (shared/challenge quizzes kept in the library) ──

/** @param {{ name?: string, questions: unknown[], source?: string, docId?: string | null }} opts @returns {Promise<Deck>} */
export async function saveDeck({ name, questions, source = 'shared', docId = null }) {
  const db = await dbPromise
  const accountId = await requireAccount()
  const deck = {
    id: uid(),
    accountId,
    name: (name || 'Shared Quiz').trim().slice(0, 120),
    questions: Array.isArray(questions) ? questions : [],
    source,
    docId,
    createdAt: Date.now()
  }
  await db.put('decks', deck)
  return deck
}

/** @param {string} id @returns {Promise<Deck | null>} */
export async function getDeck(id) {
  if (!id) return null
  const db = await dbPromise
  const deck = await db.get('decks', id)
  if (deck && activeAccountId && deck.accountId !== activeAccountId) return null
  return deck
}

export async function listDecks() {
  const db = await dbPromise
  const accountId = await requireAccount()
  return (await db.getAllFromIndex('decks', 'accountId', accountId))
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function deleteDeck(id) {
  const db = await dbPromise
  await db.delete('decks', id)
}

// ── Exams (exam-prep sessions from the wizard chat) ──

/** @param {import('./db-types.js').Exam} exam @returns {Promise<import('./db-types.js').Exam>} */
export async function saveExam(exam) {
  const db = await dbPromise
  const accountId = await requireAccount()
  const rec = { ...exam, accountId }
  await db.put('exams', rec)
  return rec
}

export async function getExam(id) {
  const db = await dbPromise
  const rec = await db.get('exams', id)
  const accountId = await requireAccount()
  return rec && rec.accountId === accountId ? rec : null
}

/** @returns {Promise<Array<import('./db-types.js').Exam>>} upcoming first, then by createdAt desc */
export async function listExams() {
  const db = await dbPromise
  const accountId = await requireAccount()
  const now = Date.now()
  return (await db.getAllFromIndex('exams', 'accountId', accountId))
    .filter(e => (e.status || 'upcoming') === 'upcoming' || now - (e.examDate || 0) < 7 * 86400000)
    .sort((a, b) => {
      const au = (a.status || 'upcoming') === 'upcoming'
      const bu = (b.status || 'upcoming') === 'upcoming'
      if (au !== bu) return au ? -1 : 1
      return (b.createdAt || 0) - (a.createdAt || 0)
    })
}

export async function deleteExam(id) {
  const db = await dbPromise
  await db.delete('exams', id)
}

export function srsIdFor(docId, term, sentence) {
  return mistakeId(docId, term, sentence)
}

// ── Spaced repetition (srs store) ──

/** @param {{ docId: string, sentence: string, term: string, type: string }} opts @returns {Promise<SrsRecord | null>} */
export async function upsertSrsFromMistake({ docId, sentence, term, type }) {
  if (!docId || !term) return null
  await migrateMistakesToSrs()
  const db = await dbPromise
  const accountId = await requireAccount()
  const id = mistakeId(docId, term, sentence)
  const existing = await db.get('srs', id)
  if (existing) return existing
  const now = Date.now()
  const rec = {
    id,
    accountId,
    docId,
    term,
    sentence,
    type,
    ease: 2.5,
    intervalDays: 0,
    dueAt: now,
    reps: 0,
    lapses: 0,
    createdAt: now,
    lastReviewedAt: now
  }
  await db.put('srs', rec)
  return rec
}

/** @param {string} id @returns {Promise<SrsRecord | undefined>} */
export async function getSrsItem(id) {
  if (!id) return undefined
  await migrateMistakesToSrs()
  const db = await dbPromise
  return db.get('srs', id)
}

export async function listDueCards(limit = 50) {
  await migrateMistakesToSrs()
  const db = await dbPromise
  const accountId = await requireAccount()
  const now = Date.now()
  return (await db.getAllFromIndex('srs', 'accountId', accountId))
    .filter(r => (r.dueAt ?? 0) <= now)
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, limit)
}

export async function countDueCards() {
  await migrateMistakesToSrs()
  const db = await dbPromise
  const accountId = await requireAccount()
  const now = Date.now()
  return (await db.getAllFromIndex('srs', 'accountId', accountId))
    .filter(r => (r.dueAt ?? 0) <= now)
    .length
}

// grade: 'again' | 'hard' | 'good' | 'easy'
/** @param {string} id @param {'again'|'hard'|'good'|'easy'} grade @returns {Promise<SrsRecord | null>} */
/** Finds the account's existing SRS card for a term in a document, preferring
 *  one that is currently due. Review drills re-ask from a different sentence,
 *  so the sentence-hashed id alone can miss the term's real card. */
export async function findSrsForTerm(docId, term) {
  if (!docId || !term) return null
  await migrateMistakesToSrs()
  const db = await dbPromise
  const accountId = await requireAccount()
  const t = String(term).toLowerCase()
  const all = await db.getAllFromIndex('srs', 'docId', docId)
  const cards = all.filter(r => r.accountId === accountId && String(r.term || '').toLowerCase() === t)
  const now = Date.now()
  return cards.find(r => (r.dueAt ?? 0) <= now) || cards[0] || null
}

export async function gradeSrsItem(id, grade) {
  if (!id) return null
  await migrateMistakesToSrs()
  const db = await dbPromise
  const item = await db.get('srs', id)
  if (!item) return null
  const updated = { ...item, ...nextState(item, GRADES[grade] ?? GRADES.good) }
  await db.put('srs', updated)
  // scheduled cards leave the raw mistake bank; failed ones stay banked
  if (grade !== 'again') await db.delete('mistakes', id).catch(() => {})
  return updated
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** @returns {Promise<ExportData>} */
export async function exportAll() {
  const db = await dbPromise
  const [accounts, docs, attempts, mistakes, images, srs, decks, exams] = await Promise.all([
    db.getAll('accounts'),
    db.getAll('docs'),
    db.getAll('attempts'),
    db.getAll('mistakes'),
    db.getAll('images'),
    db.getAll('srs'),
    db.getAll('decks'),
    db.getAll('exams')
  ])
  saveSettings({ lastBackupAt: Date.now() })
  // embed slide images as data urls so restores are complete (backup v3)
  const imageRecords = []
  for (const img of images) {
    const rec = {
      id: img.id,
      docId: img.docId,
      accountId: img.accountId,
      mime: img.mime,
      slideNumber: img.slideNumber ?? null,
      index: img.index
    }
    if (img.blob instanceof Blob) {
      rec.dataUrl = await blobToDataUrl(img.blob).catch(() => null)
    }
    imageRecords.push(rec)
  }
  return {
    app: 'quizard',
    version: 3,
    exportedAt: new Date().toISOString(),
    accounts,
    docs,
    attempts,
    mistakes,
    imageRecords,
    srs,
    decks,
    exams,
    settings: loadSettings()
  }
}

/** @param {ExportData} data @param {'merge'|'replace'} mode @returns {Promise<{ added: number, docs: number, attempts: number }>} */
export async function importAll(data, mode = 'merge') {
  const db = await dbPromise
  if (data?.app !== 'quizard' || !Array.isArray(data.docs)) {
    throw new Error('Not a valid Quizard backup file.')
  }
  await ensureDefaultAccount()

  // decode incoming image blobs BEFORE opening the write transaction —
  // awaiting fetch inside an active idb transaction would auto-commit it
  const decodedImages = []
  for (const rec of data.imageRecords || []) {
    if (!rec?.id) continue
    let blob = null
    if (rec.dataUrl) {
      try { blob = await (await fetch(rec.dataUrl)).blob() } catch { blob = null }
    }
    decodedImages.push({ rec, blob })
  }

  const tx = db.transaction(['accounts', 'docs', 'attempts', 'mistakes', 'images', 'srs', 'decks'], 'readwrite')
  if (mode === 'replace') {
    tx.objectStore('accounts').clear()
    tx.objectStore('docs').clear()
    tx.objectStore('attempts').clear()
    tx.objectStore('mistakes').clear()
    tx.objectStore('images').clear()
    tx.objectStore('srs').clear()
    tx.objectStore('decks').clear()
  }
  let added = 0
  const putUnique = async (storeName, items) => {
    for (const item of items) {
      if (mode === 'merge') {
        const exists = await tx.objectStore(storeName).get(item.id)
        if (exists) continue
      }
      tx.objectStore(storeName).put(item)
      added++
    }
  }
  await putUnique('accounts', data.accounts || [])
  await putUnique('docs', data.docs || [])
  await putUnique('attempts', data.attempts || [])
  await putUnique('mistakes', data.mistakes || [])
  await putUnique('srs', data.srs || [])
  await putUnique('decks', data.decks || [])
  await putUnique('exams', data.exams || [])
  for (const { rec, blob } of decodedImages) {
    if (mode === 'merge') {
      const exists = await tx.objectStore('images').get(rec.id)
      if (exists) continue
    }
    tx.objectStore('images').put({
      id: rec.id,
      docId: rec.docId,
      accountId: rec.accountId,
      mime: rec.mime,
      slideNumber: rec.slideNumber ?? null,
      index: rec.index ?? 0,
      ...(blob ? { blob } : {})
    })
    added++
  }
  await tx.done
  if (data.settings && typeof data.settings === 'object') {
    const clean = { ...data.settings }
    delete clean.configs
    saveSettings(clean)
  }
  const accountsNow = await db.getAll('accounts')
  if (!accountsNow.some(a => a.id === activeAccountId)) {
    setActiveAccount(accountsNow[0]?.id || null)
  } else {
    // Fresh-device restore: the active account was just auto-created and owns
    // nothing, while the import brought a library under another (local)
    // account id — adopt that account so the restored docs are visible.
    const activeDocCount = await countDocsFor(activeAccountId)
    if (activeDocCount === 0) {
      const counts = new Map()
      let c = await db.transaction('docs').store.openCursor()
      while (c) {
        const v = c.value
        if (!v.deletedAt && v.accountId) counts.set(v.accountId, (counts.get(v.accountId) || 0) + 1)
        c = await c.continue()
      }
      let best = null, bestN = 0
      for (const [accId, n] of counts) if (n > bestN) { best = accId; bestN = n }
      if (best && best !== activeAccountId) setActiveAccount(best)
    }
  }
  return { added, docs: data.docs.length, attempts: (data.attempts || []).length }
}

async function countDocsFor(accountId) {
  if (!accountId) return 0
  const db = await dbPromise
  let n = 0
  let cursor = await db.transaction('docs').store.openCursor()
  while (cursor) {
    const v = cursor.value
    if (v.accountId === accountId && !v.deletedAt) n++
    cursor = await cursor.continue()
  }
  return n
}

export async function clearAllData() {
  const db = await dbPromise
  const tx = db.transaction(['accounts', 'docs', 'attempts', 'mistakes', 'images', 'srs', 'decks', 'exams', 'classes', 'keys', 'quizzes', 'sheets'], 'readwrite')
  tx.objectStore('accounts').clear()
  tx.objectStore('docs').clear()
  tx.objectStore('attempts').clear()
  tx.objectStore('mistakes').clear()
  tx.objectStore('images').clear()
  tx.objectStore('srs').clear()
  tx.objectStore('decks').clear()
  tx.objectStore('exams').clear()
  // teacher stores too — "erase all data" previously left classes and results behind
  tx.objectStore('classes').clear()
  tx.objectStore('keys').clear()
  tx.objectStore('quizzes').clear()
  tx.objectStore('sheets').clear()
  await tx.done
  localStorage.removeItem('quizard-settings')
  localStorage.removeItem('quizard-active-account')
  activeAccountId = null
}

// Sweep only the demo records (everything tagged `demo: true`), leaving the
// teacher's own classes, keys, quizzes and results untouched.
export async function deleteDemoData() {
  const db = await dbPromise
  const accountId = await requireAccount()
  const stores = ['classes', 'keys', 'quizzes', 'sheets']
  // read pass: collect the demo ids for this account
  const doomed = []
  for (const store of stores) {
    const rows = await db.getAll(store)
    for (const r of rows) if (r.accountId === accountId && r.demo) doomed.push([store, r.id])
  }
  if (!doomed.length) return 0
  // write pass: one transaction, then wait for it to commit
  const tx = db.transaction(stores, 'readwrite')
  for (const [store, id] of doomed) tx.objectStore(store).delete(id)
  await tx.done
  return doomed.length
}

export async function storageUsage() {
  if (!navigator.storage?.estimate) return null
  const { usage, quota } = await navigator.storage.estimate()
  return { usage, quota }
}

const SETTINGS_KEY = 'quizard-settings'

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}
  } catch {
    return {}
  }
}

/** @param {import('./db-types.js').AppSettings} patch @returns {import('./db-types.js').AppSettings} */
export function saveSettings(patch) {
  const merged = { ...loadSettings(), ...patch }
  try {
    // iOS private mode throws on localStorage writes — settings are optional,
    // never let them break a flow (e.g. onboarding's Skip button)
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged))
  } catch { /* private mode / storage full */ }
  return merged
}
