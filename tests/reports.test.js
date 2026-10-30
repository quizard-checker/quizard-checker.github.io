import { describe, it, expect } from 'vitest'
import { itemAnalysis, weakestItems, resultsCsv, sectionBreakdown, scoreDistribution, quizAverages, learningTrend } from '../src/app/core/engine/reports.js'

const items = [
  { n: 1, question: 'Q1', answerIndex: 0 },
  { n: 2, question: 'Q2', answerIndex: 1 },
  { n: 3, question: 'Q3', answerIndex: 2 },
]

const sheets = [
  { answers: [0, 1, 2], studentName: 'A' },   // all correct
  { answers: [1, 1, 0], studentName: 'B' },   // Q1 wrong, Q3 wrong
  { answers: [-1, 0, 2], studentName: 'C' },  // Q1 blank, Q2 wrong
]

describe('itemAnalysis', () => {
  it('computes per-question miss rates', () => {
    const rows = itemAnalysis(sheets, items)
    expect(rows).toHaveLength(3)
    // Q1: 2 attempted (A correct, B wrong, C blank) → 50% miss
    expect(rows[0]).toMatchObject({ n: 1, attempted: 2, correct: 1, missRate: 50 })
    // Q2: 3 attempted, 2 correct (A and B) → 33% miss
    expect(rows[1].attempted).toBe(3)
    expect(rows[1].correct).toBe(2)
    expect(rows[1].missRate).toBe(33)
    // Q3: 3 attempted (A and C correct) → 33% miss
    expect(rows[2]).toMatchObject({ attempted: 3, correct: 2, missRate: 33 })
  })

  it('handles empty sheets', () => {
    const rows = itemAnalysis([], items)
    expect(rows[0].attempted).toBe(0)
    expect(rows[0].missRate).toBe(0)
  })
})

describe('weakestItems', () => {
  it('ranks most-missed questions first', () => {
    const weak = weakestItems(sheets, items)
    expect(weak.map(w => w.n)).toEqual([1, 2, 3])
  })

  it('limits the list', () => {
    expect(weakestItems(sheets, items, 1)).toHaveLength(1)
  })
})

describe('resultsCsv', () => {
  it('builds a header plus one row per sheet with letter answers', () => {
    const csv = resultsCsv(sheets, items)
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('No,Student,Grade,Section,Class,Score %,Correct,Total,Date,Q1,Q2,Q3')
    expect(lines[1]).toContain('A,')
    expect(lines[1]).toContain(',A,B,C')  // Q1..Q3 letters
    expect(lines[2]).toContain(',B,B,A')  // Q1 wrong (B), Q2 correct (B), Q3 wrong (A)
    expect(lines[3]).toContain(',,A,C')   // Q1 blank → empty, Q2 shaded A, Q3 C
  })

  it('leaves the new identity columns blank for results saved before they existed', () => {
    const csv = resultsCsv([{ ...sheets[0], className: '7-A' }], items)
    const row = csv.split('\r\n')[1]
    // No is empty, then Student, then two empty identity columns, then the class
    expect(row.startsWith(',A,,,7-A,')).toBe(true)
  })

  it('writes the student number, grade and section when the scan carried them', () => {
    const csv = resultsCsv([
      { ...sheets[0], className: '7-A', studentNo: 12, grade: 'Grade 7', section: 'Sampaguita' },
    ], items)
    const row = csv.split('\r\n')[1]
    expect(row.startsWith('12,A,Grade 7,Sampaguita,7-A,')).toBe(true)
  })

  it('escapes names containing commas or quotes', () => {
    const csv = resultsCsv([{ ...sheets[0], studentName: 'Dela Cruz, Juan "JR"' }], items)
    expect(csv).toContain('"Dela Cruz, Juan ""JR"""')
  })
})

describe('sectionBreakdown', () => {
  const roll = [
    { studentName: 'A', section: 'Sampaguita', percent: 90 },
    { studentName: 'B', section: 'Sampaguita', percent: 70 },
    { studentName: 'C', section: 'Mabini', percent: 50 },
    { studentName: 'D', section: '', percent: 100 },      // blank section — skipped
    { studentName: 'E', section: undefined, percent: 40 }, // pre-existing record — skipped
  ]

  it('groups scores by section with average, high and low', () => {
    expect(sectionBreakdown(roll)).toEqual([
      { section: 'Mabini', count: 1, avg: 50, highest: 50, lowest: 50 },
      { section: 'Sampaguita', count: 2, avg: 80, highest: 90, lowest: 70 },
    ])
  })

  it('skips sheets with no section rather than inventing a bucket', () => {
    const rows = sectionBreakdown([{ studentName: 'A', percent: 100 }])
    expect(rows).toEqual([])
  })

  it('returns an empty list for an empty class', () => {
    expect(sectionBreakdown([])).toEqual([])
  })

  it('treats a missing percent as zero instead of NaN', () => {
    const rows = sectionBreakdown([{ section: 'A', percent: undefined }, { section: 'A', percent: 100 }])
    expect(rows[0]).toMatchObject({ count: 2, avg: 50, lowest: 0 })
  })
})

// ── Data-injection: sectionBreakdown + heavy/edge datasets ──
import { sectionBreakdown } from '../src/app/core/engine/reports.js'

describe('sectionBreakdown — injected data', () => {
  it('groups sheets by section with averages', () => {
    const sheets = [
      { studentName: 'A', section: 'Sampaguita', percent: 100, correct: 4, total: 4 },
      { studentName: 'B', section: 'Sampaguita', percent: 50, correct: 2, total: 4 },
      { studentName: 'C', section: 'Molave', percent: 80, correct: 4, total: 5 },
    ]
    const rows = sectionBreakdown(sheets)
    expect(rows.length).toBeGreaterThanOrEqual(2)
    const samp = rows.find(r => (r.section || r.name || '').includes('Sampaguita'))
    expect(samp).toBeTruthy()
    expect(samp.avg ?? samp.percent ?? samp.average).toBe(75)
  })

  it('handles sheets with a missing section without crashing', () => {
    const rows = sectionBreakdown([{ studentName: 'X', percent: 60, correct: 3, total: 5 }])
    expect(rows.length).toBeGreaterThanOrEqual(0) // must not throw
  })

  it('handles an empty sheet set', () => {
    expect(sectionBreakdown([])).toEqual([])
  })

  it('survives a 500-sheet injection with 99 students', () => {
    const sheets = Array.from({ length: 500 }, (_, i) => ({
      studentName: `Student ${(i % 99) + 1}`,
      section: `Section ${(i % 5) + 1}`,
      percent: (i * 7) % 101,
      correct: (i * 7) % 101,
      total: 100,
    }))
    const rows = sectionBreakdown(sheets)
    expect(rows.length).toBeLessThanOrEqual(5)
  })
})

describe('resultsCsv — heavy injection', () => {
  it('does not emit broken rows for names with newlines and quotes', () => {
    const csv = resultsCsv([
      { studentName: 'Line1\nLine2 "quoted"', className: 'C', percent: 50, correct: 1, total: 2, createdAt: 0, answers: [0] },
    ], [{ answerIndex: 0 }])
    const lines = csv.split('\r\n')
    expect(lines.length).toBe(2) // header + one (escaped) row
  })
})

describe('quizAverages', () => {
  it('averages each quiz and orders quizzes oldest first', () => {
    const rows = quizAverages([
      { quizId: 'new', percent: 40, createdAt: 3000 },
      { quizId: 'old', percent: 80, createdAt: 1000 },
      { quizId: 'new', percent: 60, createdAt: 3001 },
      { quizId: 'old', percent: 70, createdAt: 1001 },
    ])
    expect(rows.map(r => r.quizId)).toEqual(['old', 'new'])
    expect(rows[0]).toMatchObject({ count: 2, avg: 75 })
    expect(rows[1]).toMatchObject({ count: 2, avg: 50 })
  })

  it('skips sheets with no quiz and treats a missing percent as zero', () => {
    const rows = quizAverages([
      { quizId: '', percent: 100 },
      { quizId: 'q1', percent: undefined },
      { quizId: 'q1', percent: 100 },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].avg).toBe(50)
  })

  it('returns an empty list for no sheets', () => {
    expect(quizAverages([])).toEqual([])
  })
})

describe('learningTrend', () => {
  const at = (quizId, studentNo, percent, createdAt) => ({
    quizId, studentNo, studentName: `S${studentNo}`, percent, createdAt,
  })

  it('says the majority is improving when most students scored higher', () => {
    const trend = learningTrend([
      at('q1', 1, 50, 1000), at('q2', 1, 80, 2000),
      at('q1', 2, 60, 1000), at('q2', 2, 90, 2000),
      at('q1', 3, 70, 1000), at('q2', 3, 60, 2000),
    ])
    expect(trend).toMatchObject({
      status: 'improving', basis: 'students', compared: 3, improved: 2, declined: 1,
      fromQuizId: 'q1', toQuizId: 'q2',
    })
  })

  it('says most students are slipping when more than half dropped', () => {
    const trend = learningTrend([
      at('q1', 1, 90, 1000), at('q2', 1, 70, 2000),
      at('q1', 2, 80, 1000), at('q2', 2, 50, 2000),
      at('q1', 3, 60, 1000), at('q2', 3, 70, 2000),
    ])
    expect(trend).toMatchObject({ status: 'slipping', basis: 'students', compared: 3, declined: 2 })
  })

  it('reports a split when no side holds the majority', () => {
    const trend = learningTrend([
      at('q1', 1, 50, 1000), at('q2', 1, 70, 2000),
      at('q1', 2, 70, 1000), at('q2', 2, 50, 2000),
      at('q1', 3, 60, 1000), at('q2', 3, 60, 2000),
    ])
    expect(trend).toMatchObject({ status: 'mixed', basis: 'students', unchanged: 1 })
  })

  it('does not call one shared student a trend, but keeps the averages', () => {
    const trend = learningTrend([
      at('q1', 1, 50, 1000),
      at('q2', 1, 80, 2000), at('q2', 2, 40, 2001),
    ])
    expect(trend).toMatchObject({
      status: 'insufficient', basis: 'average', compared: 1,
      fromAvg: 50, toAvg: 60, fromCount: 1, toCount: 2, avgDelta: 10,
    })
  })

  it('does not call a changed class size a trend when nobody overlaps', () => {
    const trend = learningTrend([
      at('q1', 1, 40, 1000), at('q1', 2, 50, 1001),
      at('q2', 3, 90, 2000), at('q2', 4, 95, 2001),
    ])
    expect(trend).toMatchObject({
      status: 'insufficient', basis: 'average', compared: 0,
      fromCount: 2, toCount: 2, avgDelta: 48,
    })
  })

  it('does not invent a trend from one quiz', () => {
    const trend = learningTrend([at('q1', 1, 80, 1000)])
    expect(trend).toMatchObject({ status: 'insufficient', basis: 'none', compared: 0 })
  })

  it('ignores students who did not take both quizzes', () => {
    const trend = learningTrend([
      at('q1', 1, 50, 1000), at('q1', 2, 60, 1001),
      at('q2', 1, 90, 2000), at('q2', 3, 20, 2001),
    ])
    expect(trend.compared).toBe(1) // only student 1 is in both
  })

  it('takes the newest row when a legacy duplicate exists', () => {
    const trend = learningTrend([
      at('q1', 1, 50, 1000), at('q1', 1, 90, 1500), // same student, newer 90
      at('q2', 1, 80, 2000), at('q2', 2, 40, 2001),
      at('q1', 2, 40, 1002),
    ])
    // student 1: 90 -> 80 (down); student 2: 40 -> 40 (same)
    expect(trend).toMatchObject({ status: 'mixed', basis: 'students', declined: 1, unchanged: 1 })
  })

  it('averages quizzes in chronological order even when sheets arrive newest-first', () => {
    const trend = learningTrend([
      at('new', 1, 70, 3000),
      at('old', 1, 50, 1000),
    ])
    expect(trend).toMatchObject({ fromQuizId: 'old', toQuizId: 'new', avgDelta: 20 })
  })
})

describe('scoreDistribution', () => {
  it('bins sheets into the five fixed bands, A first', () => {
    const dist = scoreDistribution([
      { percent: 95 }, { percent: 100 },  // A
      { percent: 84 },                    // B
      { percent: 72 },                    // C
      { percent: 60 },                    // D (inclusive edge)
      { percent: 12 },                    // F
    ])
    expect(dist.map(d => d.letter)).toEqual(['A', 'B', 'C', 'D', 'F'])
    expect(dist.map(d => d.count)).toEqual([2, 1, 1, 1, 1])
  })

  it('always returns five rows even with no sheets', () => {
    const dist = scoreDistribution([])
    expect(dist).toHaveLength(5)
    expect(dist.every(d => d.count === 0)).toBe(true)
  })

  it('counts sum to the sheet total and treats a missing percent as 0 (F)', () => {
    const sheets = [{ percent: 90 }, {}, { percent: 55 }]
    const dist = scoreDistribution(sheets)
    expect(dist.reduce((n, d) => n + d.count, 0)).toBe(3)
    expect(dist.find(d => d.letter === 'F').count).toBe(2)
  })
})
