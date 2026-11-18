import { describe, expect, it } from 'vitest'
import { normalizeGrade } from '../src/app/shared/helpers.js'

describe('normalizeGrade', () => {
  it('keeps only digits', () => {
    expect(normalizeGrade('Grade 8')).toBe('8')
    expect(normalizeGrade(' 7 ')).toBe('7')
    expect(normalizeGrade('8-B')).toBe('8')
    expect(normalizeGrade('abc')).toBe('')
  })

  it('caps the value at two digits', () => {
    expect(normalizeGrade('123')).toBe('12')
    expect(normalizeGrade('12')).toBe('12')
  })

  it('handles numbers and empty values', () => {
    expect(normalizeGrade(8)).toBe('8')
    expect(normalizeGrade(null)).toBe('')
    expect(normalizeGrade(undefined)).toBe('')
    expect(normalizeGrade('')).toBe('')
  })
})
