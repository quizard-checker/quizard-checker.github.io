// A class is identified by its real fields, not just the display name. Two
// classes with the same subject, grade, section, and school year are the same
// class even if capitalization or spacing differs.
function text(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function grade(value) {
  return String(value ?? '').replace(/\D/g, '')
}

function schoolYear(value) {
  return String(value ?? '')
    .trim()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, '')
}

/**
 * @param {any} cls
 * @returns {string}
 */
export function classIdentity(cls) {
  return [
    text(cls?.subject),
    grade(cls?.grade),
    text(cls?.section),
    schoolYear(cls?.schoolYear),
  ].join('|')
}

/**
 * @param {any} candidate
 * @param {any[]} classes
 * @param {string|null} [excludeId]
 * @returns {any|null}
 */
export function findDuplicateClass(candidate, classes, excludeId = null) {
  const key = classIdentity(candidate)
  if (!key || key.split('|').some(part => !part)) return null
  return (classes || []).find(cls => cls?.id !== excludeId && classIdentity(cls) === key) || null
}
