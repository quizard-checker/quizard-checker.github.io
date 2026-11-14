// CLI: full Chrome E2E for the PIN sheet scan flow. Run with the app serving on :4310.
// usage: node tests/helpers/pin-photo.mjs --e2e  (kept separate; see run-e2e steps in session)
import { renderPinHalf } from './pin-render.js'
import { PIN_SHEET, pinSheetQrPayload } from '../../src/app/core/engine/sheet-spec.js'
import fs from 'node:fs'
import zlib from 'node:zlib'

const [out, quizId, pin, keyLetters, half, rotate, noise] = process.argv.slice(2)
const answers = (keyLetters || 'ABCD').toUpperCase().split('').map(ch => 'ABCD'.indexOf(ch))
const img = renderPinHalf({
  half: Number(half) || 0,
  answers,
  pin: pin || '',
  qrPayload: quizId ? pinSheetQrPayload(quizId) : '',
  rotateDeg: Number(rotate) || 0,
  noise: Number(noise) || 0,
})
const W = PIN_SHEET.W * 3 + 120, H = (PIN_SHEET.H / 2) * 3 + 120

function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf)
  let c = 0xFFFFFFFF
  for (const byte of buf) {
    c >>>= 0
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    c = c >>> 0
  }
  return (c ^ 0xFFFFFFFF) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function pngEncode(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  const src = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    src.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

if (out) fs.writeFileSync(out, pngEncode(W, H, img))
console.log(`photo: ${out || '(none)'} ${W}x${H} quiz=${quizId} pin=${pin} key=${keyLetters} half=${half}`)
