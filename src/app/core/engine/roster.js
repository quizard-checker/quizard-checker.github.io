// Class-roster parser for the teacher app. Accepts pasted text or the text of
// an uploaded .txt/.csv file — one student per line, forgiving separators.
//
//   Juan Dela Cruz
//   Maria Santos, Grade 8
//   Juan Dela Cruz, 8, Sampaguita
//   Name, Grade, Section        ← header line is skipped

export function parseRoster(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const students = []
  let skipped = 0
  for (const [i, line] of lines.entries()) {
    // a first line that names the columns is a header, not a student
    if (i === 0 && /^(student\s*)?name\b/i.test(line) && /(grade|section|,|\t|;)/i.test(line)) continue
    const parts = line.split(/[\t,;]+/).map(p => p.trim())
    const name = (parts.shift() || '').replace(/\s+/g, ' ').trim()
    if (!name) { skipped++; continue }
    const rest = parts.filter(Boolean).map(p => p.replace(/\s+/g, ' ').trim())
    let grade = '', section = ''
    if (rest.length) {
      const first = rest.shift()
      if (isGrade(first)) { grade = normalizeGrade(first); section = rest.shift() || '' }
      else section = first
    }
    students.push({ name, grade, section: section || '' })
  }
  return { students, skipped }
}

const nameKey = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()

// Split a freshly parsed roster against names already on a class: `fresh` are
// the genuinely new students (in order, with in-paste repeats collapsed so a
// double paste can't create twin students), `dupes` counts every skipped
// repeat — already on the roster, or listed twice in the same text.
export function diffRoster(students, existingNames) {
  const seen = new Set((existingNames || []).map(nameKey))
  const fresh = []
  let dupes = 0
  for (const s of students || []) {
    const key = nameKey(s?.name)
    if (seen.has(key)) { dupes++; continue }
    seen.add(key)
    fresh.push(s)
  }
  return { fresh, dupes }
}

function isGrade(s) {
  return /^(g(rade)?\s*\.?\s*)?\d{1,2}$/i.test(s)
}

function normalizeGrade(s) {
  const m = /(\d{1,2})/.exec(s)
  return m ? `Grade ${m[1]}` : s
}

// ── 5-digit student PINs (for the generic PIN answer sheets) ────────────────
// The teacher hands each student a PIN; the student writes + shades it on
// their sheet and the scanner routes the paper back to them.

const PIN_RE = /^\d{5}$/
const PIN_SOURCE = '0123456789'

export function isValidPin(value) {
  return PIN_RE.test(String(value || '').trim())
}

function randomPin(exclude) {
  for (let tries = 0; tries < 10000; tries++) {
    let pin = ''
    for (let d = 0; d < 5; d++) pin += PIN_SOURCE[Math.floor(Math.random() * 10)]
    if (!exclude.has(pin)) { exclude.add(pin); return pin }
  }
  // 100k pool vs a class roster — practically unreachable; fall back to a
  // sequential pin outside the excluded set
  for (let n = 0; n <= 99999; n += 7) {
    const pin = String(n).padStart(5, '0')
    if (!exclude.has(pin)) { exclude.add(pin); return pin }
  }
  return '00000'
}

/**
 * Fill in a unique 5-digit PIN for every student that doesn't have one.
 * Existing PINs (valid or not) are never touched; new ones are unique across
 * the class and don't collide with any already-assigned pin.
 * @param {Array<{ pin?: string }>} students
 * @returns {{ students: any[], assigned: number }}
 */
export function generatePins(students = []) {
  const taken = new Set()
  for (const s of students || []) {
    const pin = String(s?.pin || '').trim()
    if (PIN_RE.test(pin)) taken.add(pin)
  }
  let assigned = 0
  const out = (students || []).map(s => {
    const pin = String(s?.pin || '').trim()
    if (PIN_RE.test(pin)) return { ...s, pin }
    assigned++
    return { ...s, pin: randomPin(taken) }
  })
  return { students: out, assigned }
}

/**
 * Match a shaded/written 5-digit PIN to a roster student. Duplicate pins in
 * one class can't be resolved (the scan can't tell them apart) — returns null
 * so the teacher attaches the student manually.
 * @param {Array<{ pin?: string }>} students
 * @param {string} pin
 */
export function resolveStudentByPin(students = [], pin) {
  const want = String(pin || '').replace(/\D/g, '')
  if (!PIN_RE.test(want)) return null
  const matches = (students || []).filter(s => String(s?.pin || '') === want)
  return matches.length === 1 ? matches[0] : null
}
