// Minimal .xlsx reader for roster uploads. An .xlsx is a zip of XML parts;
// we only need the text of the first worksheet, so there is no spreadsheet
// dependency here — JSZip is already used by the PPTX extractor.
//
// The output is tab-separated lines (one spreadsheet row per line) so the
// existing parseRoster() can take it unchanged. Tabs also win over commas
// inside parseRoster, which keeps names like "Reyes, Juan" in one cell.

let JSZip = null

function decodeXml(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

// "A1" → 0, "C7" → 2. Spreadsheet columns are base-26 letters.
function colIndex(ref) {
  const letters = /^([A-Z]+)/i.exec(ref || '')?.[1]?.toUpperCase() || ''
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return Math.max(0, n - 1)
}

function sharedStrings(xml) {
  if (!xml) return []
  const out = []
  for (const si of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    // Rich text splits a string across several <t> runs.
    let text = ''
    for (const t of si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += decodeXml(t[1])
    out.push(text)
  }
  return out
}

function cellValue(attrs, body, shared) {
  const type = /\bt="([^"]+)"/.exec(attrs)?.[1] || ''
  if (type === 'inlineStr') {
    let text = ''
    for (const t of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += decodeXml(t[1])
    return text
  }
  const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)
  if (!v) return ''
  const raw = decodeXml(v[1])
  if (type === 's') return shared[Number(raw)] ?? ''
  return raw
}

function sheetRows(xml, shared) {
  const rows = []
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = []
    for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1] || ''
      const body = cell[2] || ''
      const ref = /\br="([A-Z]+)\d+"/i.exec(attrs)?.[1]
      const idx = ref ? colIndex(ref) : cells.length
      while (cells.length < idx) cells.push('')
      cells[idx] = cellValue(attrs, body, shared)
    }
    rows.push(cells)
  }
  return rows
}

/** Turn worksheet rows into roster text: one row per line, cells tab-separated. */
export function rowsToText(rows) {
  return (rows || [])
    .map(cells => {
      const clean = (cells || []).map(c => String(c ?? '').replace(/\s+/g, ' ').trim())
      while (clean.length && !clean[clean.length - 1]) clean.pop()
      return clean.join('\t')
    })
    .filter(Boolean)
    .join('\n')
}

/**
 * Read the first worksheet of an .xlsx file as rows of cell strings.
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {Promise<string[][]>}
 */
export async function xlsxToRows(buffer) {
  if (!JSZip) JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buffer)

  const sheets = Object.keys(zip.files)
    .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/sheet(\d+)\.xml/i)[1], 10)
      const nb = parseInt(b.match(/sheet(\d+)\.xml/i)[1], 10)
      return na - nb
    })
  if (!sheets.length) throw new Error('No worksheet found in this spreadsheet.')

  const shared = sharedStrings(
    zip.files['xl/sharedStrings.xml']
      ? await zip.files['xl/sharedStrings.xml'].async('string')
      : ''
  )
  return sheetRows(await zip.files[sheets[0]].async('string'), shared)
}

/**
 * Read the first worksheet of an .xlsx file as tab-separated roster text.
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {Promise<string>}
 */
export async function xlsxToText(buffer) {
  const text = rowsToText(await xlsxToRows(buffer))
  if (!text.trim()) throw new Error('No rows found in this spreadsheet.')
  return text
}
