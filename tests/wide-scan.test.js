import { describe, it, expect } from 'vitest'
import { orientationLockAvailable, wideScanEnterPlan, wideScanExitPlan } from '../src/app/core/engine/wide-scan.js'

const androidLike = { orientation: { lock: () => Promise.resolve() } }
const iosLike = {}
const partial = { orientation: {} }

describe('orientationLockAvailable', () => {
  it('is true when screen.orientation.lock is a function (Android Chrome, installed PWAs)', () => {
    expect(orientationLockAvailable(androidLike)).toBe(true)
  })

  it('is false on platforms without a lock API (iOS Safari)', () => {
    expect(orientationLockAvailable(iosLike)).toBe(false)
    expect(orientationLockAvailable(partial)).toBe(false)
    expect(orientationLockAvailable(null)).toBe(false)
    expect(orientationLockAvailable(undefined)).toBe(false)
  })
})

describe('wideScanEnterPlan', () => {
  it('goes fullscreen and locks landscape where locking works', () => {
    expect(wideScanEnterPlan(androidLike)).toEqual({ fullscreen: true, lockTo: 'landscape', hint: false })
  })

  it('skips fullscreen and asks the teacher to rotate where locking is missing', () => {
    expect(wideScanEnterPlan(iosLike)).toEqual({ fullscreen: false, lockTo: null, hint: true })
    expect(wideScanEnterPlan(partial)).toEqual({ fullscreen: false, lockTo: null, hint: true })
  })
})

describe('wideScanExitPlan', () => {
  it('locks back to portrait and leaves fullscreen where locking works', () => {
    expect(wideScanExitPlan(androidLike)).toEqual({ exitFullscreen: true, lockTo: 'portrait' })
  })

  it('still leaves fullscreen on platforms without a lock API', () => {
    expect(wideScanExitPlan(iosLike)).toEqual({ exitFullscreen: true, lockTo: null })
  })
})
