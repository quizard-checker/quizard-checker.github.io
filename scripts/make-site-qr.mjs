// Static QR codes for the docs site. Run: node scripts/make-site-qr.mjs
import qrcode from 'qrcode-generator'
import { writeFileSync, mkdirSync } from 'node:fs'

const OUT = 'site/assets/qr'
mkdirSync(OUT, { recursive: true })

const targets = {
  'web.svg': 'https://quizard-checker.github.io/',
  'apk.svg': 'https://github.com/quizard-checker/quizard-checker.github.io/releases/download/v2.0.10/Quizard.apk',
}

for (const [name, url] of Object.entries(targets)) {
  const qr = qrcode(0, 'M')
  qr.addData(url)
  qr.make()
  const svg = qr.createSvgTag({ cellSize: 7, margin: 2, scalable: true })
  writeFileSync(`${OUT}/${name}`, svg)
  console.log('wrote', `${OUT}/${name}`, svg.length, 'bytes —', url)
}
