import { describe, expect, it } from 'vitest'
import {
  currentSchoolYearStart,
  parseSchoolYear,
  schoolYearLabel,
  schoolYearOptions,
} from '../src/app/shared/helpers.js'

describe('school year helpers', () => {
  it('starts in June and rolls over to the previous year before June', () => {
    expect(currentSchoolYearStart(new Date(2026, 5, 1))).toBe(2026)
    expect(currentSchoolYearStart(new Date(2026, 4, 31))).toBe(2025)
    expect(currentSchoolYearStart(new Date(2027, 0, 15))).toBe(2026)
  })

  it('labels a start year with the following year', () => {
    expect(schoolYearLabel(2026)).toBe('2026-2027')
    expect(schoolYearLabel(2030)).toBe('2030-2031')
  })

  it('accepts only consecutive YYYY-YYYY years and normalizes dashes', () => {
    expect(parseSchoolYear(' 2026–2027 ')).toBe('2026-2027')
    expect(parseSchoolYear('2026 - 2027')).toBe('2026-2027')
    expect(parseSchoolYear('2026-2028')).toBe('')
    expect(parseSchoolYear('fsjfsdfjsfjs')).toBe('')
    expect(parseSchoolYear('2026')).toBe('')
    expect(parseSchoolYear('')).toBe('')
    expect(parseSchoolYear(null)).toBe('')
  })

  it('builds a rolling window around the current year', () => {
    expect(schoolYearOptions(2026, '', 2)).toEqual([
      '2024-2025', '2025-2026', '2026-2027', '2027-2028', '2028-2029',
    ])
  })

  it('always keeps an existing year outside the window', () => {
    expect(schoolYearOptions(2026, '2015-2016')).toEqual([
      '2015-2016',
      '2023-2024', '2024-2025', '2025-2026', '2026-2027',
      '2027-2028', '2028-2029', '2029-2030',
    ])
  })

  it('does not duplicate a selected year inside the window', () => {
    expect(schoolYearOptions(2026, '2026-2027')).toEqual([
      '2023-2024', '2024-2025', '2025-2026', '2026-2027',
      '2027-2028', '2028-2029', '2029-2030',
    ])
  })
})
