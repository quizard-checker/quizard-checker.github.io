// Live scanner state machine: one QR sighting per camera tick in, one decision
// out. Kept pure so the "hold still, then fire once" rules are unit-testable
// without a camera or a DOM.
//
// The scanner must not fire on a single blurry frame, must not re-read the
// sheet the teacher just scanned, and must re-arm once the camera has seen no
// sheet for a moment (so the same paper can be scanned again on purpose).
import { parseSheetQr } from './sheet-spec.js'

export const LIVE_SCAN = {
  tickMs: 260,          // camera sample cadence — ~4 checks a second
  confirmHits: 2,       // same QR twice in a row before capturing
  cooldownMs: 1500,     // pause after a capture while the frame is processed
  rearmTicks: 8,        // ~2s with no sheet re-arms the last scanned QR
}

/**
 * @param {{
 *   text: string | null,       // QR text seen in this frame, null if none
 *   candidate?: string | null, // QR text being confirmed across frames
 *   hits?: number,             // consecutive sightings of `candidate`
 *   absent?: number,           // consecutive ticks with no sheet QR
 *   scannedQr?: string | null, // last QR that was successfully captured
 *   cooldownUntil?: number,
 *   now?: number,
 * }} frame
 * @returns {{
 *   status: 'looking'|'locking'|'waiting',
 *   candidate: string | null,
 *   hits: number,
 *   absent: number,
 *   scan: string | null,       // set when this frame should capture
 * }}
 */
export function liveScanStep({
  text,
  candidate = null,
  hits = 0,
  absent = 0,
  scannedQr = null,
  cooldownUntil = 0,
  now = 0,
}) {
  const sheet = text && parseSheetQr(text) ? text : null
  if (!sheet) {
    return { status: 'looking', candidate: null, hits: 0, absent: absent + 1, scan: null }
  }
  if (scannedQr === sheet) {
    return { status: 'waiting', candidate: null, hits: 0, absent: 0, scan: null }
  }
  if (now < cooldownUntil) {
    return { status: 'locking', candidate: null, hits: 0, absent: 0, scan: null }
  }
  const nextHits = candidate === sheet ? hits + 1 : 1
  if (nextHits < LIVE_SCAN.confirmHits) {
    return { status: 'locking', candidate: sheet, hits: nextHits, absent: 0, scan: null }
  }
  return { status: 'locking', candidate: null, hits: 0, absent: 0, scan: sheet }
}
