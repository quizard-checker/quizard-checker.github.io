/**
 * Wide-scan decisions — pure, so they test without a device.
 *
 * A wide sheet (PIN half-sheets on long bond, photographed across a desk or
 * off a laptop screen) can outgrow the portrait field of view: the right-hand
 * corner squares fall outside the frame and alignment refuses. Wide scan
 * turns the viewfinder landscape — fullscreen plus an orientation lock where
 * the platform allows it (Android Chrome, installed PWAs), or a plain "turn
 * your phone sideways" hint where it does not (iOS Safari). The reading
 * pipeline needs no changes: QR decode, marker quad and homography are all
 * orientation-agnostic, so a landscape frame reads exactly like a portrait
 * one that happens to be rotated.
 */

/** Can this runtime lock the screen orientation at all? */
export function orientationLockAvailable(screen) {
  return !!(screen && screen.orientation && typeof screen.orientation.lock === 'function')
}

/**
 * What entering wide scan should do here. Where the orientation can be
 * locked, the viewfinder goes fullscreen first (Android Chrome only allows
 * orientation locks inside fullscreen) and snaps to landscape. Elsewhere the
 * wide layout still applies the moment the device actually is landscape —
 * the teacher just has to rotate it by hand, so surface the hint.
 * @returns {{ fullscreen: boolean, lockTo: 'landscape' | null, hint: boolean }}
 */
export function wideScanEnterPlan(screen) {
  if (orientationLockAvailable(screen)) return { fullscreen: true, lockTo: 'landscape', hint: false }
  return { fullscreen: false, lockTo: null, hint: true }
}

/**
 * Leaving wide scan always leaves fullscreen; where locking worked on the
 * way in, lock back to portrait so the rest of the app stays upright.
 * @returns {{ exitFullscreen: boolean, lockTo: 'portrait' | null }}
 */
export function wideScanExitPlan(screen) {
  if (orientationLockAvailable(screen)) return { exitFullscreen: true, lockTo: 'portrait' }
  return { exitFullscreen: true, lockTo: null }
}
