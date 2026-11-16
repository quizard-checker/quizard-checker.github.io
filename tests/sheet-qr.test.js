import { describe, it, expect } from 'vitest'
import qrModule from 'qrcode-generator'
import { sheetQrPayload, demoSheetQrPayload, demoPinSheetQrPayload, pinSheetQrPayload, parseSheetQr } from '../src/app/core/engine/sheet-spec.js'

const moduleCount = (payload, level) => {
  const qr = (qrModule.default || qrModule)(0, level)
  qr.addData(payload)
  qr.make()
  return qr.getModuleCount()
}

describe('sheetQrPayload / parseSheetQr', () => {
  it('encodes a blank sheet as a quiz-only QZ1 code', () => {
    const p = sheetQrPayload('quiz-1', null)
    expect(p).toBe('QZ1:quiz-1')
    expect(parseSheetQr(p)).toEqual({ quizId: 'quiz-1', studentId: null, studentName: null, quizName: null })
  })

  it('appends the quiz name to a blank-sheet QZ1 code when given', () => {
    const p = sheetQrPayload('quiz-1', null, 'Verb Tenses')
    expect(p).toBe('QZ1:quiz-1|Verb Tenses')
    expect(parseSheetQr(p)).toEqual({ quizId: 'quiz-1', studentId: null, studentName: null, quizName: 'Verb Tenses' })
  })

  it('still parses legacy QZ1 codes printed before quiz names existed', () => {
    expect(parseSheetQr('QZ1:quiz-1')).toEqual({ quizId: 'quiz-1', studentId: null, studentName: null, quizName: null })
  })

  it('round-trips the roster student id and name in a QZ2 code', () => {
    const st = { id: 'stu-1', no: 3, name: 'Juan Dela Cruz' }
    const p = sheetQrPayload('quiz-1', st)
    expect(p).toBe('QZ2:quiz-1|stu-1|Juan Dela Cruz')
    expect(parseSheetQr(p)).toEqual({ quizId: 'quiz-1', studentId: 'stu-1', studentName: 'Juan Dela Cruz', quizName: null })
  })

  it('keeps delimiter characters in names from breaking the parse', () => {
    const p = sheetQrPayload('q', { id: 's', name: 'Ana|Marie' })
    const parsed = parseSheetQr(p)
    expect(parsed.studentId).toBe('s')
    expect(parsed.studentName).toBe('Ana/Marie')
  })

  it('encodes a generic PIN sheet as a quiz-only QZ3 code', () => {
    const p = pinSheetQrPayload('quiz-1')
    expect(p).toBe('QZ3:quiz-1')
    expect(parseSheetQr(p)).toEqual({ quizId: 'quiz-1', studentId: null, studentName: null, quizName: null, pinSheet: true })
    expect(parseSheetQr('QZ3:')).toBeNull()
  })

  it('appends the quiz name to a PIN-sheet QZ3 code when given', () => {
    const p = pinSheetQrPayload('quiz-1', 'Verb Tenses')
    expect(p).toBe('QZ3:quiz-1|Verb Tenses')
    expect(parseSheetQr(p)).toEqual({ quizId: 'quiz-1', studentId: null, studentName: null, quizName: 'Verb Tenses', pinSheet: true })
  })

  it('still parses legacy QZ3 codes printed before quiz names existed', () => {
    expect(parseSheetQr('QZ3:quiz-1')).toEqual({ quizId: 'quiz-1', studentId: null, studentName: null, quizName: null, pinSheet: true })
  })

  it('swaps pipe delimiters out of the quiz name and truncates it', () => {
    expect(pinSheetQrPayload('q', 'Bio|Lab')).toBe('QZ3:q|Bio/Lab')
    const long = pinSheetQrPayload('q', 'A very long quiz name that keeps going')
    expect(long).toBe('QZ3:q|A very long quiz name th')
    expect(parseSheetQr(long).quizName).toBe('A very long quiz name th')
  })

  it('treats a QZ3 code with an empty name after the pipe as nameless', () => {
    expect(parseSheetQr('QZ3:quiz-1|').quizName).toBeNull()
  })

  it('ignores QR codes that are not Quizard sheet codes', () => {
    expect(parseSheetQr('https://example.com')).toBeNull()
    expect(parseSheetQr('QZ2:quiz-only')).toBeNull()
    expect(parseSheetQr('')).toBeNull()
    expect(parseSheetQr(null)).toBeNull()
  })
})

describe('bundled demo sheet QR', () => {
  it('round-trips the stable demo keys and roster number', () => {
    const p = demoSheetQrPayload('demo-cls-eng', 'demo-quiz-2', 1)
    expect(p).toBe('QZD1:demo-cls-eng:demo-quiz-2:1')
    expect(parseSheetQr(p)).toEqual({
      quizId: null,
      studentId: null,
      studentName: null,
      quizName: null,
      demo: { classKey: 'demo-cls-eng', quizKey: 'demo-quiz-2', studentNo: 1 },
    })
  })

  it('rejects malformed demo codes', () => {
    for (const bad of [
      'QZD1:', 'QZD1:a', 'QZD1:a:b', 'QZD1:a:b:0', 'QZD1:a:b:1000',
      'QZD1:a:b:x', 'QZD1:a:b:1:2',
    ]) {
      expect(parseSheetQr(bad)).toBeNull()
    }
  })

  it('round-trips the demo PIN half-sheet code (QZD2) with no roster number', () => {
    const p = demoPinSheetQrPayload('demo-cls-eng', 'demo-quiz-2')
    expect(p).toBe('QZD2:demo-cls-eng:demo-quiz-2')
    expect(parseSheetQr(p)).toEqual({
      quizId: null,
      studentId: null,
      studentName: null,
      quizName: null,
      demo: { classKey: 'demo-cls-eng', quizKey: 'demo-quiz-2', studentNo: null },
      pinSheet: true,
    })
  })

  it('rejects malformed demo PIN codes', () => {
    for (const bad of ['QZD2:', 'QZD2:a', 'QZD2:a:b:c']) {
      expect(parseSheetQr(bad)).toBeNull()
    }
  })
})

// The QR is a fixed 76pt box, so a long student name must not push the module
// count so high that cells become unreadable in a phone photo. 45 modules is
// the worst case this accepts: 76 / 45 ≈ 1.7pt per cell.
describe('roster QR capacity', () => {
  it('keeps the cell size scannable for the longest realistic payload', () => {
    const payload = sheetQrPayload(
      'b'.repeat(36),
      { id: 'a'.repeat(36), name: 'Maria Cristina Bautista Dela Cruz' },
    )
    expect(moduleCount(payload, 'L')).toBeLessThanOrEqual(45)
  })

  it('stays smaller than level M would for the same payload', () => {
    const payload = sheetQrPayload('b'.repeat(36), { id: 'a'.repeat(36), name: 'Maria Cristina Bautista Dela Cruz' })
    expect(moduleCount(payload, 'L')).toBeLessThan(moduleCount(payload, 'M'))
  })
})

// A quiz name rides along in QZ1/QZ3 codes now. Both print into a fixed box
// (76pt blank sheet, 80pt PIN half-sheet) at level M, so the module count
// must stay well under the 45-module worst case the roster code already
// accepts — otherwise the named codes get harder to scan than the nameless
// ones they replace.
describe('named QZ1/QZ3 QR capacity', () => {
  const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
  const longName = 'Mathematics — Quarterly Exam on Fractions'

  it('keeps a named blank-sheet code at level M scannable', () => {
    const payload = sheetQrPayload(uuid, null, longName)
    expect(moduleCount(payload, 'M')).toBeLessThanOrEqual(45)
  })

  it('keeps a named PIN-sheet code at level M scannable', () => {
    const payload = pinSheetQrPayload(uuid, longName)
    expect(moduleCount(payload, 'M')).toBeLessThanOrEqual(45)
  })
})
