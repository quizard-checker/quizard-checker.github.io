import { describe, expect, it } from 'vitest'
import { backDestination } from '../src/app/shared/helpers.js'

describe('Android back destination', () => {
  it('exits only from root screens', () => {
    expect(backDestination('/tabs/home')).toBe('exit')
    expect(backDestination('/tabs/home?welcome=1')).toBe('exit')
    expect(backDestination('/welcome')).toBe('exit')
    expect(backDestination('/accounts')).toBe('exit')
  })

  it('walks subpages back to Home', () => {
    expect(backDestination('/tabs/settings')).toBe('/tabs/home')
    expect(backDestination('/tabs/archive')).toBe('/tabs/home')
    expect(backDestination('/tabs/reports')).toBe('/tabs/home')
    expect(backDestination('/quiz')).toBe('/tabs/home')
    expect(backDestination('/tabs/classes/c1')).toBe('/tabs/home')
  })

  it('returns a student result to its class roster', () => {
    expect(backDestination('/tabs/classes/c1/students/s1')).toBe('/tabs/classes/c1')
    expect(backDestination('/tabs/classes/c1/students/s1?tab=scores')).toBe('/tabs/classes/c1')
  })

  it('normalizes trailing slashes and missing urls', () => {
    expect(backDestination('/tabs/home/')).toBe('exit')
    expect(backDestination('/tabs/settings/')).toBe('/tabs/home')
    expect(backDestination('')).toBe('/tabs/home')
    expect(backDestination(null)).toBe('/tabs/home')
  })
})
