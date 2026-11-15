import { describe, it, expect } from 'vitest'
import { generatePins, resolveStudentByPin, isValidPin, claimPin } from '../src/app/core/engine/roster.js'

const st = (name, pin) => ({ name, ...(pin ? { pin } : {}) })

describe('isValidPin', () => {
  it('accepts exactly five digits', () => {
    expect(isValidPin('12345')).toBe(true)
    expect(isValidPin('00000')).toBe(true)
    expect(isValidPin(' 12345 ')).toBe(true)
    expect(isValidPin('1234')).toBe(false)
    expect(isValidPin('123456')).toBe(false)
    expect(isValidPin('12a45')).toBe(false)
    expect(isValidPin('')).toBe(false)
    expect(isValidPin(null)).toBe(false)
  })
})

describe('generatePins', () => {
  it('assigns a unique 5-digit pin to every student missing one', () => {
    const { students, assigned } = generatePins([st('Ana'), st('Ben'), st('Cara')])
    expect(assigned).toBe(3)
    const pins = students.map(s => s.pin)
    expect(pins.every(p => /^\d{5}$/.test(p))).toBe(true)
    expect(new Set(pins).size).toBe(3)
  })

  it('never touches existing pins', () => {
    const { students, assigned } = generatePins([st('Ana', '11111'), st('Ben')])
    expect(assigned).toBe(1)
    expect(students[0].pin).toBe('11111')
    expect(students[1].pin).toMatch(/^\d{5}$/)
    expect(students[1].pin).not.toBe('11111')
  })

  it('does not mutate the input array', () => {
    const input = [st('Ana')]
    const copy = JSON.parse(JSON.stringify(input))
    generatePins(input)
    expect(input).toEqual(copy)
  })

  it('is collision-free across repeated calls on the same class', () => {
    const first = generatePins([st('Ana'), st('Ben')]).students
    const second = generatePins(first)
    expect(second.assigned).toBe(0)
    const pins = second.students.map(s => s.pin)
    expect(new Set(pins).size).toBe(2)
  })
})

describe('resolveStudentByPin', () => {
  const roster = [st('Ana', '11111'), st('Ben', '22222'), st('Cara')]

  it('matches a unique pin to its student', () => {
    expect(resolveStudentByPin(roster, '11111')?.name).toBe('Ana')
    expect(resolveStudentByPin(roster, '22222')?.name).toBe('Ben')
  })

  it('ignores non-digit noise in the scanned value', () => {
    expect(resolveStudentByPin(roster, '1-1-1-1-1')?.name).toBe('Ana')
    expect(resolveStudentByPin(roster, ' 11111 ')?.name).toBe('Ana')
  })

  it('returns null for unknown, blank and invalid pins', () => {
    expect(resolveStudentByPin(roster, '99999')).toBe(null)
    expect(resolveStudentByPin(roster, '')).toBe(null)
    expect(resolveStudentByPin(roster, null)).toBe(null)
    expect(resolveStudentByPin(roster, '12')).toBe(null)
  })

  it('refuses to guess when two students share a pin', () => {
    const dupes = [st('Ana', '33333'), st('Ben', '33333')]
    expect(resolveStudentByPin(dupes, '33333')).toBe(null)
  })

  it('matches a student who has no pin only when the pin is invalid — never by accident', () => {
    // students without pins must never match any scanned pin
    expect(resolveStudentByPin(roster, '00000')).toBe(null)
  })
})

describe('claimPin — register a shaded PIN to a hand-picked student', () => {
  const roster = [
    { id: 's1', name: 'Ana', pin: '11111' },
    { id: 's2', name: 'Ben' },
    { id: 's3', name: 'Cara' },
  ]

  it('registers an unclaimed PIN to the picked student', () => {
    const res = claimPin(roster, 's2', '48213')
    expect(res.ok).toBe(true)
    expect(res.changed).toBe(true)
    expect(res.students.find(s => s.id === 's2').pin).toBe('48213')
    expect(res.students.find(s => s.id === 's1').pin).toBe('11111')
  })

  it('resolves the registered PIN on the next scan', () => {
    const res = claimPin(roster, 's3', '91537')
    const routed = resolveStudentByPin(res.students, '91537')
    expect(routed?.name).toBe('Cara')
  })

  it('refuses a PIN another student already owns', () => {
    const res = claimPin(roster, 's2', '11111')
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('taken')
    expect(res.students).toBe(roster)
  })

  it('re-picking the same student with the same PIN is a no-op', () => {
    const res = claimPin(roster, 's1', '11111')
    expect(res.ok).toBe(true)
    expect(res.changed).toBe(false)
  })

  it('rejects invalid pins without touching the roster', () => {
    for (const bad of ['12', '', null, 'abcde']) {
      const res = claimPin(roster, 's2', bad)
      expect(res.ok).toBe(false)
      expect(res.reason).toBe('invalid')
      expect(res.students).toBe(roster)
    }
  })

  it('overwrites the student\'s own old pin — the latest paper wins', () => {
    const res = claimPin(roster, 's1', '73590')
    expect(res.ok).toBe(true)
    expect(res.changed).toBe(true)
    expect(resolveStudentByPin(res.students, '73590')?.name).toBe('Ana')
    expect(resolveStudentByPin(res.students, '11111')).toBe(null)
  })
})
