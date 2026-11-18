import { describe, it, expect } from 'vitest'
import { parseRoster, diffRoster } from '../src/app/core/engine/roster.js'

describe('parseRoster', () => {
  it('parses one name per line', () => {
    const { students, skipped } = parseRoster('Juan Dela Cruz\nMaria Santos')
    expect(students).toEqual([
      { name: 'Juan Dela Cruz', grade: '', section: '' },
      { name: 'Maria Santos', grade: '', section: '' }
    ])
    expect(skipped).toBe(0)
  })

  it('parses name, grade, section triplets', () => {
    const { students } = parseRoster('Juan Dela Cruz, 8, Sampaguita')
    expect(students[0]).toEqual({ name: 'Juan Dela Cruz', grade: 'Grade 8', section: 'Sampaguita' })
  })

  it('detects a grade-only second column vs a section', () => {
    const withGrade = parseRoster('Maria Santos, Grade 9').students[0]
    expect(withGrade.grade).toBe('Grade 9')
    expect(withGrade.section).toBe('')
    const withSection = parseRoster('Ana Reyes, Sampaguita').students[0]
    expect(withSection.grade).toBe('')
    expect(withSection.section).toBe('Sampaguita')
  })

  it('skips a header line and blank lines', () => {
    const { students, skipped } = parseRoster('Name, Grade, Section\n\nJuan, 7, Molave')
    expect(students).toHaveLength(1)
    expect(students[0].name).toBe('Juan')
    expect(skipped).toBe(0)
  })

  it('tolerates tabs and semicolons as separators', () => {
    const { students } = parseRoster('Juan Dela Cruz\t8\tSampaguita\nAna Reyes; 7; Molave')
    expect(students[0].section).toBe('Sampaguita')
    expect(students[1].section).toBe('Molave')
  })

  it('keeps commas inside tab-separated cells (Excel names)', () => {
    const { students } = parseRoster('Reyes, Juan\t8\tSampaguita')
    expect(students[0]).toEqual({ name: 'Reyes, Juan', grade: 'Grade 8', section: 'Sampaguita' })
  })

  it('counts lines without a name as skipped', () => {
    const { students, skipped } = parseRoster('Juan\n, 8, Sampaguita')
    expect(students).toHaveLength(1)
    expect(skipped).toBe(1)
  })

  it('handles empty input', () => {
    const { students } = parseRoster('')
    expect(students).toEqual([])
  })
})

describe('diffRoster (Add-names mode)', () => {
  it('keeps only names the roster does not have', () => {
    const parsed = parseRoster('Ana Reyes\nNew Kid\nBen Cruz').students
    const { fresh, dupes } = diffRoster(parsed, ['Ana Reyes', 'Ben Cruz', 'Cara Diaz'])
    expect(fresh.map(s => s.name)).toEqual(['New Kid'])
    expect(dupes).toBe(2)
  })

  it('collapses repeats inside the paste itself', () => {
    const parsed = parseRoster('New Kid\nnew  kid\nNew Kid').students
    const { fresh, dupes } = diffRoster(parsed, [])
    expect(fresh).toHaveLength(1)
    expect(dupes).toBe(2)
  })

  it('ignores case and extra spaces when matching', () => {
    const parsed = parseRoster('  ANA   REYES ').students
    const { fresh, dupes } = diffRoster(parsed, ['Ana Reyes'])
    expect(fresh).toHaveLength(0)
    expect(dupes).toBe(1)
  })

  it('passes everything through for an empty roster', () => {
    const parsed = parseRoster('Juan\nMaria').students
    const { fresh, dupes } = diffRoster(parsed, [])
    expect(fresh).toEqual(parsed)
    expect(dupes).toBe(0)
  })
})
