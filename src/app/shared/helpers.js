import { icon } from './icons.js'

export function typeIcon(type) {
  return { pdf: 'fileText', docx: 'fileText', pptx: 'fileText', link: 'link', youtube: 'play' }[type] || 'fileText'
}

export function typeLabel(type) {
  return { pdf: 'PDF', docx: 'Word', pptx: 'PowerPoint', txt: 'Text', md: 'Markdown', link: 'Web page', youtube: 'YouTube' }[type] || String(type || '').toUpperCase()
}

export function scorePill(percent) {
  if (percent >= 80) return 'high'
  if (percent >= 50) return 'mid'
  return 'low'
}

// Grade is a number, not free text: keep digits only and cap at two (1–12).
export function normalizeGrade(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, 2)
}

export function fmtDate(ts) {
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// "September 12, 2026" — month spelled out, for quiz creation dates on the
// Classwork and Scores cards so the teacher can tell when a quiz was made.
export function fmtDateLong(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

// Classroom-style banner identity, shared by the Classes cards and the roster
// banner so a class wears the same gradient everywhere it appears. The theme
// is hashed from the id — deterministic, never changes. The avatar shows the
// section ("A"), the mark teachers scan for, falling back to the name initial
// when a class has no section yet.
export function bannerTheme(cls) {
  const id = String(cls?.id || cls?.name || '')
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return 'th-' + (h % 6)
}

export function bannerAvatar(cls) {
  return (String(cls?.section || '').trim().charAt(0)
    || String(cls?.name || '?').trim().charAt(0)
    || '?').toUpperCase()
}

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function dayLabel(ts) {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86400000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

// Recent-activity rollup: attempts on the same document on the same day
// collapse into one row (rounds + best score + time of the last round) so the
// Progress page shows a short summary instead of growing with every attempt.
// Attempts must be newest-first (as listAttempts returns them); the result
// keeps that order and is capped.
export function mergeActivity(attempts, cap = 12) {
  const merged = new Map()
  for (const a of attempts || []) {
    const key = (a.docId || a.docName || 'other') + '|' + dayLabel(a.date)
    const cur = merged.get(key)
    if (!cur) {
      merged.set(key, { ...a, rounds: 1, best: a.percent, lastDate: a.date })
      continue
    }
    cur.rounds++
    cur.best = Math.max(cur.best, a.percent)
    cur.percent = cur.best
    if (a.date > cur.lastDate) {
      cur.lastDate = a.date
      cur.correct = a.correct
      cur.total = a.total
      cur.durationSec = a.durationSec
    }
    cur.date = cur.lastDate
  }
  return [...merged.values()].slice(0, cap)
}

export function esc(s) {
  const div = document.createElement('div')
  div.textContent = String(s ?? '')
  return div.innerHTML
}

export function blankHtml(stem) {
  return esc(stem).replace(/\u0000BLANK\u0000/g, '<span class="blank-slot">&nbsp;</span>')
}

/* ── Component helpers ── */

export function card(content, { style = '', cls = '' } = {}) {
  return `<div class="card ${cls}"${style ? ` style="${style}"` : ''}>${content}</div>`
}

export function statsRow(stats) {
  return `<div class="stats-row">${stats.map(s =>
    `<div class="stat"><div class="num">${s.value}</div><div class="lbl">${s.label}</div></div>`
  ).join('')}</div>`
}

export function chipRow(chips) {
  return `<div class="chip-row">${chips.join('')}</div>`
}

export function chip(label, { active = false, count = null, cls = '' } = {}) {
  const extra = count != null ? ` <span class="chip-count">${count}</span>` : ''
  return `<span class="chip ${active ? 'on' : ''} ${cls}">${label}${extra}</span>`
}

export function sectionTitle(text) {
  return `<div class="section-title">${text}</div>`
}

export function row(content, { tooltip = '', style = '', borderless = false } = {}) {
  const s = borderless ? `${style};border-bottom:none`.replace(/^;/, '') : style
  const tip = tooltip ? ` data-tooltip="${tooltip}"` : ''
  const sty = s ? ` style="${s}"` : ''
  return `<div class="row"${tip}${sty}>${content}</div>`
}

export function muted(text, { style = '', tag = 'p' } = {}) {
  const sty = style ? ` style="${style}"` : ''
  return `<${tag} class="muted"${sty}>${text}</${tag}>`
}

export function btn(label, { icon: iconName = null, cls = 'btn-primary', style = '', tooltip = '', id = '', attrs = '' } = {}) {
  const ico = iconName ? icon(iconName) : ''
  const tip = tooltip ? ` data-tooltip="${tooltip}"` : ''
  const sty = style ? ` style="${style}"` : ''
  const idAttr = id ? ` id="${id}"` : ''
  return `<button class="btn ${cls}"${idAttr}${tip}${sty}${attrs ? ' ' + attrs : ''}>${ico}${label}</button>`
}

// Android back: never let a subpage or a class sheet close the app. The shell
// walks toward Home; "exit" means the double-press guard on the root screens.
export function backDestination(url) {
  const path = String(url || '').split('?')[0].split('#')[0].replace(/\/+$/, '') || '/'
  if (path === '/tabs/home' || path === '/welcome' || path === '/accounts') return 'exit'
  const parts = path.split('/').filter(Boolean)
  if (parts[0] === 'tabs' && parts[1] === 'classes' && parts[2] && parts[3] === 'students' && parts[4]) {
    return `/tabs/classes/${parts[2]}`
  }
  return '/tabs/home'
}

// School years are generated around today, so the list never expires.
export function currentSchoolYearStart(now = new Date()) {
  const year = now.getFullYear()
  return now.getMonth() + 1 >= 6 ? year : year - 1
}

export function schoolYearLabel(startYear) {
  return `${startYear}-${startYear + 1}`
}

// Accept the formats a teacher might paste from Excel ("2026–2027",
// "2026 - 2027") but store one canonical YYYY-YYYY label.
export function parseSchoolYear(value) {
  const text = String(value ?? '').trim().replace(/[–—]/g, '-').replace(/\s+/g, '')
  const match = text.match(/^(\d{4})-(\d{4})$/)
  if (!match) return ''
  const start = Number(match[1])
  const end = Number(match[2])
  return end === start + 1 ? `${start}-${end}` : ''
}

// A rolling window around the current school year; an existing class's year
// is always added, even when it falls outside the window.
export function schoolYearOptions(currentStart, selected = '', span = 3) {
  const starts = new Set()
  for (let start = currentStart - span; start <= currentStart + span; start++) starts.add(start)
  const picked = parseSchoolYear(selected)
  if (picked) starts.add(Number(picked.slice(0, 4)))
  return [...starts].sort((a, b) => a - b).map(schoolYearLabel)
}
