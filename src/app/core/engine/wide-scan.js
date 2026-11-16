/**
 * Wide-scan decisions — pure, so they test without a device.
 *
 * A wide sheet (PIN half-sheets on long bond, photographed across a desk or
 * off a laptop screen) can outgrow the portrait field of view: the right-hand
 * corner squares fall outside the frame and alignment refuses. Wide scan
 * turns the viewfinder landscape — fullscreen plus an orientation lock where
 * the platform allows it (Android Chrome, installed PWAs), a native lock
 * through the ScreenOrientation plugin inside the Capacitor app (the WebView
 * exposes the web API but silently rejects it, and the system auto-rotate
 * switch stays off on many phones), or a plain "turn your phone sideways"
 * hint where it does not (iOS Safari). The reading
 * pipeline needs no changes: QR decode, marker quad and homography are all
 * orientation-agnostic, so a landscape frame reads exactly like a portrait
 * one that happens to be rotated.
 */

/** Can this runtime lock the screen orientation at all? */
export function orientationLockAvailable(screen) {
  return !!(screen && screen.orientation && typeof screen.orientation.lock === 'function')
}

/**
 * What entering wide scan should do here. Inside the native app the
 * ScreenOrientation plugin rotates the screen for real (opts.native), no
 * fullscreen needed. Where the web lock works, the viewfinder goes fullscreen
 * first (Android Chrome only allows orientation locks inside fullscreen) and
 * snaps to landscape. Elsewhere the wide layout still applies the moment the
 * device actually is landscape — the teacher just has to rotate it by hand,
 * so surface the hint.
 * @returns {{ fullscreen: boolean, lockTo: 'landscape' | null, hint: boolean, native?: boolean }}
 */
export function wideScanEnterPlan(screen, opts = {}) {
  if (opts.native) return { fullscreen: false, lockTo: 'landscape', native: true, hint: false }
  if (orientationLockAvailable(screen)) return { fullscreen: true, lockTo: 'landscape', hint: false }
  return { fullscreen: false, lockTo: null, hint: true }
}

/**
 * Leaving wide scan always leaves fullscreen; where locking worked on the
 * way in, lock back to portrait so the rest of the app stays upright. Natively
 * the plugin unlocks instead, so the screen follows the system setting again.
 * @returns {{ exitFullscreen: boolean, lockTo: 'portrait' | 'unlock' | null, native?: boolean }}
 */
export function wideScanExitPlan(screen, opts = {}) {
  if (opts.native) return { exitFullscreen: false, lockTo: 'unlock', native: true }
  if (orientationLockAvailable(screen)) return { exitFullscreen: true, lockTo: 'portrait' }
  return { exitFullscreen: true, lockTo: null }
}
