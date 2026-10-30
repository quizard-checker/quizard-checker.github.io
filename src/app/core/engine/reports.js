// Class results reporting (PLAN.md Phase 4): item analysis and CSV export
// over saved sheet results. Pure functions — unit-testable without a browser.

/**
 * Per-question miss rates across a set of checked sheets.
 * @param {{ answers: number[] }[]} sheets checked sheets (newest first or any order)
 * @param {{ n: number, question: string, answerIndex: number }[]} items quiz key items
 * @returns {{ n: number, question: string, correct: number, attempted: number,
 *   answered: number, missRate: number }[]}
 */
export function itemAnalysis(sheets, items) {
  const rows = items.map((it, i) => ({
    n: i + 1,
    question: it.question || '',
    correct: 0,
    attempted: 0, // shaded an answer (not blank)
    answered: 0,  // sheets that reached this item's class run (same as attempted here)
    total: sheets.length,
    missRate: 0,
  }))
  for (const s of sheets) {
    items.forEach((_, i) => {
      const a = s.answers?.[i]
      if (a == null || a < 0) return // blank — not attempted
      rows[i].attempted++
      if (a === items[i].answerIndex) rows[i].correct++
    })
  }
  for (const r of rows) {
    r.answered = r.attempted
    r.missRate = r.attempted ? Math.round(((r.attempted - r.correct) / r.attempted) * 100) : 0
  }
  return rows
}

/** The most-missed questions first (only items someone attempted). */
export function weakestItems(sheets, items, limit = 5) {
  return itemAnalysis(sheets, items)
    .filter(r => r.attempted > 0)
    .sort((a, b) => b.missRate - a.missRate || a.n - b.n)
    .slice(0, limit)
}

/**
 * Average score per quiz for one class, oldest quiz first.
 * Chronology comes from the newest sheet timestamp in each quiz; `listSheets`
 * returns newest-first, so `firstSeen` is only a tiebreaker for records that
 * predate `createdAt`.
 * @param {{ quizId?: string, percent?: number, createdAt?: number }[]} sheets
 * @returns {{ quizId: string, count: number, avg: number,
 *   newestAt: number, oldestAt: number }[]}
 */
export function quizAverages(sheets) {
  const by = new Map()
  sheets.forEach((s, i) => {
    const quizId = String(s.quizId || '')
    if (!quizId) return
    const at = Number(s.createdAt) || 0
    const g = by.get(quizId) || {
      quizId, count: 0, sum: 0,
      newestAt: 0, oldestAt: Number.POSITIVE_INFINITY, firstSeen: i,
    }
    g.count++
    g.sum += Number(s.percent) || 0
    g.newestAt = Math.max(g.newestAt, at)
    g.oldestAt = Math.min(g.oldestAt, at)
    if (i < g.firstSeen) g.firstSeen = i
    by.set(quizId, g)
  })
  return [...by.values()]
    .map(g => ({
      quizId: g.quizId,
      count: g.count,
      avg: Math.round(g.sum / g.count),
      newestAt: g.newestAt,
      oldestAt: g.oldestAt,
      firstSeen: g.firstSeen,
    }))
    .sort((a, b) =>
      a.newestAt - b.newestAt ||
      a.oldestAt - b.oldestAt ||
      b.firstSeen - a.firstSeen ||
      a.quizId.localeCompare(b.quizId))
    .map(({ firstSeen, ...row }) => row)
}

/**
 * Did the class improve between its two latest quizzes?
 *
 * When at least two students took both quizzes, this is a per-student vote:
 * improving when more than half scored higher, slipping when more than half
 * scored lower, otherwise mixed. With too little overlap it reports
 * `insufficient` (basis `average` carries the two class averages for context)
 * rather than calling one student — or a changed class size — a trend.
 *
 * @param {{ quizId?: string, studentNo?: number | null, studentName?: string,
 *   percent?: number, createdAt?: number }[]} sheets
 * @returns {{ status: 'improving' | 'slipping' | 'mixed' | 'insufficient',
 *   basis: 'students' | 'average' | 'none', compared: number, improved: number,
 *   declined: number, unchanged: number, fromQuizId: string | null,
 *   toQuizId: string | null, fromAvg: number | null, toAvg: number | null,
 *   fromCount: number | null, toCount: number | null, avgDelta: number }}
 */
export function learningTrend(sheets) {
  const quizzes = quizAverages(sheets)
  if (quizzes.length < 2) {
    const only = quizzes[0]
    return {
      status: 'insufficient', basis: 'none',
      compared: 0, improved: 0, declined: 0, unchanged: 0,
      fromQuizId: only?.quizId || null, toQuizId: null,
      fromAvg: only?.avg ?? null, toAvg: null,
      fromCount: only?.count ?? null, toCount: null, avgDelta: 0,
    }
  }

  const from = quizzes[quizzes.length - 2]
  const to = quizzes[quizzes.length - 1]
  const keyOf = (s) => s.studentNo != null
    ? `no:${s.studentNo}`
    : `name:${String(s.studentName || '').trim().toLowerCase()}`

  // One row per student per quiz — the newest, in case a legacy duplicate
  // survived. Sheets arrive newest-first, but compare timestamps explicitly.
  const take = (quizId) => {
    const map = new Map()
    for (const s of sheets) {
      if (s.quizId !== quizId) continue
      const key = keyOf(s)
      const prev = map.get(key)
      if (!prev || (Number(s.createdAt) || 0) > (Number(prev.createdAt) || 0)) map.set(key, s)
    }
    return map
  }

  const before = take(from.quizId)
  const now = take(to.quizId)
  let improved = 0, declined = 0, unchanged = 0
  for (const [key, s] of now) {
    const old = before.get(key)
    if (!old) continue
    const delta = (Number(s.percent) || 0) - (Number(old.percent) || 0)
    if (delta > 0) improved++
    else if (delta < 0) declined++
    else unchanged++
  }

  const compared = improved + declined + unchanged
  const avgDelta = to.avg - from.avg
  const base = {
    compared, improved, declined, unchanged,
    fromQuizId: from.quizId, toQuizId: to.quizId,
    fromAvg: from.avg, toAvg: to.avg,
    fromCount: from.count, toCount: to.count, avgDelta,
  }

  if (compared >= 2) {
    const status = improved > compared / 2 ? 'improving'
      : declined > compared / 2 ? 'slipping'
      : 'mixed'
    return { ...base, status, basis: 'students' }
  }

  // One shared student cannot speak for the class, and a different class size
  // makes a raw average change incomparable — report the averages, not a verdict.
  return { ...base, status: 'insufficient', basis: 'average' }
}

const CSV_ESC = (v) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/**
 * Score distribution across one class's checked sheets, in five fixed bands
 * so the histogram never changes shape with the data.
 * @param {{ percent?: number }[]} sheets
 * @returns {{ letter: string, label: string, min: number, count: number }[]}
 *   always 5 rows, A→F.
 */
export const DIST_BANDS = [
  { letter: 'A', label: '90–100', min: 90 },
  { letter: 'B', label: '80–89', min: 80 },
  { letter: 'C', label: '70–79', min: 70 },
  { letter: 'D', label: '60–69', min: 60 },
  { letter: 'F', label: 'Below 60', min: 0 },
]

export function scoreDistribution(sheets) {
  const rows = DIST_BANDS.map(b => ({ ...b, count: 0 }))
  for (const s of sheets) {
    const pct = Number(s.percent) || 0
    rows.find(r => pct >= r.min).count++
  }
  return rows
}

/**
 * Per-section rollup of one class's checked sheets. Sheets with no section —
 * results saved before sections were recorded, or students the roster leaves
 * blank — are left out rather than bucketed under an empty heading.
 * @param {{ section?: string, percent?: number }[]} sheets
 * @returns {{ section: string, count: number, avg: number, highest: number, lowest: number }[]}
 */
export function sectionBreakdown(sheets) {
  const by = new Map()
  for (const s of sheets) {
    const key = String(s.section || '').trim()
    if (!key) continue
    const pct = Number(s.percent) || 0
    const g = by.get(key) || { section: key, count: 0, sum: 0, high: pct, low: pct }
    g.count++
    g.sum += pct
    if (pct > g.high) g.high = pct
    if (pct < g.low) g.low = pct
    by.set(key, g)
  }
  return [...by.values()]
    .map(g => ({ section: g.section, count: g.count, avg: Math.round(g.sum / g.count), highest: g.high, lowest: g.low }))
    .sort((a, b) => a.section.localeCompare(b.section, undefined, { numeric: true }))
}

/**
 * Class results as CSV: one row per checked sheet, then per-item columns.
 * `studentNo` / `grade` / `section` are blank for results saved before those
 * fields were captured.
 * @param {{ studentNo?: number | null, studentName: string, grade?: string,
 *   section?: string, className: string, percent: number,
 *   correct: number, total: number, createdAt: number, answers: number[] }[]} sheets
 * @param {{ answerIndex: number }[]} items
 */
export function resultsCsv(sheets, items) {
  const head = ['No', 'Student', 'Grade', 'Section', 'Class', 'Score %', 'Correct', 'Total', 'Date',
    ...items.map((_, i) => `Q${i + 1}`)]
  const rows = sheets.map(s => [
    s.studentNo ?? '', s.studentName, s.grade || '', s.section || '', s.className,
    s.percent, s.correct, s.total,
    new Date(s.createdAt).toLocaleString(),
    ...items.map((_, i) => {
      const a = s.answers?.[i]
      return a == null || a < 0 ? '' : 'ABCD'[a]
    }),
  ])
  return [head, ...rows].map(r => r.map(CSV_ESC).join(',')).join('\r\n')
}
