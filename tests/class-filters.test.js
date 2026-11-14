import { describe, it, expect } from 'vitest'
import {
  filterClasses,
  sortClasses,
  classFilterOptions,
  yearOf,
  gradeOf,
  NO_YEAR,
  NO_GRADE,
} from '../src/app/core/engine/class-filters.js'

const cls = (name, extra = {}) => ({ id: name.toLowerCase(), name, students: [], ...extra })

const classes = [
  cls('Science 7-A', { grade: '7', subject: 'Science', section: 'Sampaguita', schoolYear: '2026-2027', createdAt: 3 }),
  cls('English 8-B', { grade: '8', subject: 'English', section: 'Molave', schoolYear: '2026-2027', createdAt: 2 }),
  cls('ICT 9-A', { grade: '9', subject: 'Computer', section: 'Narra', schoolYear: '2025-2026', createdAt: 1 }),
  cls('Math 10-A', { grade: '', subject: 'Math', section: '', schoolYear: 'SY 2024-2025', createdAt: 4 }),
]

describe('yearOf / gradeOf', () => {
  it('reads years from free-text school year values', () => {
    expect(yearOf({ schoolYear: '2026-2027' })).toBe(2026)
    expect(yearOf({ schoolYear: 'SY 2024-2025' })).toBe(2024)
    expect(yearOf({ schoolYear: '26-27' })).toBe(null)
    expect(yearOf({ schoolYear: '' })).toBe(null)
    expect(yearOf({})).toBe(null)
  })

  it('reads grade levels from free-text grade values', () => {
    expect(gradeOf({ grade: '8' })).toBe(8)
    expect(gradeOf({ grade: 'Grade 10' })).toBe(10)
    expect(gradeOf({ grade: 'Kinder' })).toBe(0)
    expect(gradeOf({ grade: 'K' })).toBe(0)
    expect(gradeOf({ grade: '' })).toBe(null)
  })
})

describe('filterClasses', () => {
  it('returns everything with no filters', () => {
    expect(filterClasses(classes, {})).toHaveLength(4)
  })

  it('searches name, subject, section, grade and year', () => {
    expect(filterClasses(classes, { query: 'sci' }).map(c => c.name)).toEqual(['Science 7-A'])
    expect(filterClasses(classes, { query: 'computer' }).map(c => c.name)).toEqual(['ICT 9-A'])
    expect(filterClasses(classes, { query: 'narra' }).map(c => c.name)).toEqual(['ICT 9-A'])
    expect(filterClasses(classes, { query: '2024' }).map(c => c.name)).toEqual(['Math 10-A'])
    expect(filterClasses(classes, { query: '10' }).map(c => c.name)).toEqual(['Math 10-A'])
  })

  it('filters by exact school year and grade', () => {
    expect(filterClasses(classes, { year: '2026-2027' }).map(c => c.name)).toEqual(['Science 7-A', 'English 8-B'])
    expect(filterClasses(classes, { grade: '9' }).map(c => c.name)).toEqual(['ICT 9-A'])
  })

  it('uses the none sentinels for missing values', () => {
    // every class above has a school year, so the "none" filter matches nothing
    expect(filterClasses(classes, { year: NO_YEAR })).toEqual([])
    expect(filterClasses(classes, { grade: NO_GRADE }).map(c => c.name)).toEqual(['Math 10-A'])
  })

  it('combines query, year and grade', () => {
    expect(filterClasses(classes, { query: 'science', year: '2026-2027', grade: '7' }).map(c => c.name)).toEqual(['Science 7-A'])
    expect(filterClasses(classes, { query: 'science', year: '2025-2026' })).toEqual([])
  })
})

describe('sortClasses', () => {
  it('sorts recently added first by default', () => {
    expect(sortClasses(classes).map(c => c.name)).toEqual(['Math 10-A', 'Science 7-A', 'English 8-B', 'ICT 9-A'])
  })

  it('sorts names naturally', () => {
    const list = [cls('Grade 10-A'), cls('Grade 9-A'), cls('Grade 7-A')]
    expect(sortClasses(list, 'name').map(c => c.name)).toEqual(['Grade 7-A', 'Grade 9-A', 'Grade 10-A'])
  })

  it('sorts by school year, newest first, with missing years last', () => {
    const list = [
      cls('Old', { schoolYear: '2024-2025' }),
      cls('New', { schoolYear: '2026-2027' }),
      cls('Mid', { schoolYear: '2025-2026' }),
      cls('NoYear', {}),
    ]
    expect(sortClasses(list, 'year').map(c => c.name)).toEqual(['New', 'Mid', 'Old', 'NoYear'])
  })

  it('sorts grades ascending, with missing grades last', () => {
    const list = [
      cls('Grade 9', { grade: '9' }),
      cls('Grade 7', { grade: '7' }),
      cls('Grade 10', { grade: 'Grade 10' }),
      cls('NoGrade', {}),
    ]
    expect(sortClasses(list, 'grade').map(c => c.name)).toEqual(['Grade 7', 'Grade 9', 'Grade 10', 'NoGrade'])
  })

  it('does not mutate the input array', () => {
    const list = sortClasses(classes, 'name')
    expect(list).not.toBe(classes)
    expect(classes.map(c => c.name)).toEqual(['Science 7-A', 'English 8-B', 'ICT 9-A', 'Math 10-A'])
  })
})

describe('classFilterOptions', () => {
  it('lists distinct years newest-first and grades ascending', () => {
    const opts = classFilterOptions(classes)
    expect(opts.years.map(o => o.label)).toEqual(['2026-2027', '2025-2026', 'SY 2024-2025'])
    expect(opts.grades.map(o => o.label)).toEqual(['7', '8', '9', 'No grade'])
  })

  it('only offers the none entries when such classes exist', () => {
    const opts = classFilterOptions([
      { name: 'A', schoolYear: '2026-2027', grade: '7' },
      { name: 'B', schoolYear: '2026-2027', grade: '8' },
    ])
    expect(opts.years).toHaveLength(1)
    expect(opts.grades.map(o => o.label)).toEqual(['7', '8'])
    const withMissing = classFilterOptions([
      { name: 'A', schoolYear: '2026-2027' },
      { name: 'B', grade: '7' },
    ])
    expect(withMissing.years.map(o => o.value)).toContain(NO_YEAR)
    expect(withMissing.grades.map(o => o.value)).toContain(NO_GRADE)
  })

  it('filters for the none sentinels match blank values', () => {
    const blank = [{ id: 'x', name: 'No year', schoolYear: '', grade: '' }]
    expect(filterClasses(blank, { year: NO_YEAR })).toHaveLength(1)
    expect(filterClasses(blank, { grade: NO_GRADE })).toHaveLength(1)
  })
})
