import { describe, it, expect } from 'vitest'
import { liveScanStep, LIVE_SCAN } from '../src/app/core/engine/live-scan.js'

const sheetA = 'QZD1:demo-cls-eng:demo-quiz-2:1'
const sheetB = 'QZD1:demo-cls-eng:demo-quiz-2:2'

describe('liveScanStep', () => {
  it('ignores frames with no QR and counts the absence', () => {
    const step = liveScanStep({ text: null, absent: 2 })
    expect(step.status).toBe('looking')
    expect(step.absent).toBe(3)
    expect(step.scan).toBeNull()
  })

  it('ignores QR codes that are not Quizard sheets', () => {
    const step = liveScanStep({ text: 'https://example.com', absent: 4 })
    expect(step.status).toBe('looking')
    expect(step.absent).toBe(5)
    expect(step.scan).toBeNull()
  })

  it('needs the same QR on consecutive frames before firing', () => {
    const first = liveScanStep({ text: sheetA })
    expect(first.scan).toBeNull()
    expect(first.status).toBe('locking')
    expect(first.candidate).toBe(sheetA)

    const second = liveScanStep({
      text: sheetA,
      candidate: first.candidate,
      hits: first.hits,
    })
    expect(second.scan).toBe(sheetA)
    expect(second.candidate).toBeNull()
    expect(second.hits).toBe(0)
  })

  it('restarts the confirmation when a different QR appears', () => {
    const first = liveScanStep({ text: sheetA })
    const other = liveScanStep({ text: sheetB, candidate: first.candidate, hits: first.hits })
    expect(other.scan).toBeNull()
    expect(other.candidate).toBe(sheetB)
    expect(other.hits).toBe(1)
  })

  it('does not rescan the sheet that was just captured', () => {
    const step = liveScanStep({ text: sheetA, scannedQr: sheetA, candidate: sheetA, hits: 5 })
    expect(step.status).toBe('waiting')
    expect(step.scan).toBeNull()
  })

  it('scans a different sheet immediately while the last one is still remembered', () => {
    const first = liveScanStep({ text: sheetB, scannedQr: sheetA })
    const second = liveScanStep({
      text: sheetB,
      scannedQr: sheetA,
      candidate: first.candidate,
      hits: first.hits,
    })
    expect(second.scan).toBe(sheetB)
  })

  it('holds captures during the post-scan cooldown', () => {
    const first = liveScanStep({ text: sheetA, cooldownUntil: 5000, now: 1000 })
    const second = liveScanStep({
      text: sheetA,
      cooldownUntil: 5000,
      now: 2000,
      candidate: first.candidate,
      hits: first.hits,
    })
    expect(first.scan).toBeNull()
    expect(second.scan).toBeNull()
    expect(first.status).toBe('locking')
  })

  it('re-arms after enough empty frames', () => {
    let absent = 0
    for (let i = 0; i < LIVE_SCAN.rearmTicks; i++) {
      absent = liveScanStep({ text: null, absent }).absent
    }
    expect(absent).toBeGreaterThanOrEqual(LIVE_SCAN.rearmTicks)
  })
})
