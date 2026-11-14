// Sort and filter helpers for the Home class list. Pure functions so the
// behaviour (free-text school years, optional grades) is unit-tested without
// the page. Nothing here mutates the caller's array.

export const NO_YEAR = '__none__'
export const NO_GRADE = '__none__'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const byName = (a, b) => collator.compare(String(a?.name || ''), String(b?.name || ''))
const text = v => String(v == null ? '' : v).trim()

// "SY 2026-2027" / "2026-27" → 2026; anything without a 4-digit year → null.
export function yearOf(cls) {
  const m = /(?:19|20)\d{2}/.exec(text(cls?.schoolYear))
  return m ? Number(m[0]) : null
}

// "Grade 8" / "8th" / "8" → 8, "Kinder"/"K" → 0, blank → null.
export function gradeOf(cls) {
  const raw = text(cls?.grade)
  if (!raw) return null
  const m = /\d{1,2}/.exec(raw)
  if (m) return Number(m[0])
  if (/^(k|kinder(garten)?)$/i.test(raw)) return 0
  return null
}

/**
 * Search + exact year/grade filtering. `NO_YEAR` / `NO_GRADE` pick the
 * classes that have no value at all.
 * @param {any[]} classes
 * @param {{ query?: string, year?: string, grade?: string }} [opts]
 */
export function filterClasses(classes = [], { query = '', year = '', grade = '' } = {}) {
  const q = text(query).toLowerCase()
  return (classes || []).filter(cls => {
    if (year) {
      const value = text(cls?.schoolYear)
      if (year === NO_YEAR ? !!value : value !== year) return false
    }
    if (grade) {
      const value = text(cls?.grade)
      if (grade === NO_GRADE ? !!value : value !== grade) return false
    }
    if (!q) return true
    const hay = [cls?.name, cls?.subject, cls?.section, cls?.grade, cls?.schoolYear]
      .map(v => text(v).toLowerCase())
      .join(' ')
    return hay.includes(q)
  })
}

/**
 * @param {any[]} classes
 * @param {'recent'|'name'|'year'|'grade'} [sort]
 */
export function sortClasses(classes = [], sort = 'recent') {
  const list = [...(classes || [])]
  if (sort === 'name') return list.sort(byName)
  if (sort === 'year') {
    return list.sort((a, b) => {
      const ya = yearOf(a)
      const yb = yearOf(b)
      if (ya == null && yb == null) return byName(a, b)
      if (ya == null) return 1 // classes without a year sink
      if (yb == null) return -1
      return yb - ya || byName(a, b)
    })
  }
  if (sort === 'grade') {
    return list.sort((a, b) => {
      const ga = gradeOf(a)
      const gb = gradeOf(b)
      if (ga == null && gb == null) return byName(a, b)
      if (ga == null) return 1 // classes without a grade sink
      if (gb == null) return -1
      return ga - gb || byName(a, b)
    })
  }
  // recent (default): newest first, name as a stable tie-break
  return list.sort((a, b) =>
    (Number(b?.createdAt) || 0) - (Number(a?.createdAt) || 0) || byName(a, b))
}

/**
 * Distinct chip choices, ordered for display. Missing values get a
 * "No school year" / "No grade" entry only when such classes exist.
 * @param {any[]} classes
 * @returns {{ years: { value: string, label: string }[], grades: { value: string, label: string }[] }}
 */
export function classFilterOptions(classes = []) {
  const years = new Set()
  const grades = new Set()
  let missingYear = false
  let missingGrade = false
  for (const cls of classes || []) {
    const y = text(cls?.schoolYear)
    if (y) years.add(y); else missingYear = true
    const g = text(cls?.grade)
    if (g) grades.add(g); else missingGrade = true
  }
  const yearList = [...years]
    .sort((a, b) => {
      const ya = yearOf({ schoolYear: a })
      const yb = yearOf({ schoolYear: b })
      if (ya == null || yb == null) return collator.compare(a, b)
      return yb - ya || collator.compare(a, b)
    })
    .map(value => ({ value, label: value }))
  if (missingYear) yearList.push({ value: NO_YEAR, label: 'No school year' })
  const gradeList = [...grades]
    .sort((a, b) => {
      const ga = gradeOf({ grade: a })
      const gb = gradeOf({ grade: b })
      if (ga == null || gb == null) return collator.compare(a, b)
      return ga - gb || collator.compare(a, b)
    })
    .map(value => ({ value, label: value }))
  if (missingGrade) gradeList.push({ value: NO_GRADE, label: 'No grade' })
  return { years: yearList, grades: gradeList }
}
