import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'

// storage.js touches localStorage only inside its functions; give node a stub.
const mem = new Map()
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
  clear: () => mem.clear(),
}

import { DEMO_SNAPSHOT } from '../src/app/core/engine/demo-data.js'
import { buildDemoWorld, demoSummary, seedDemoData } from '../src/app/core/engine/demo.js'
import { resolveDemoSheet, DEMO_SHEET } from '../src/app/core/engine/demo-sheet.js'
import {
  accountHasData, clearAllData, createAccount, deleteAccount, deleteDemoData, listClasses, listKeys,
  listQuizzes, listSheets, saveClass, saveKey, saveQuiz, saveSheet, setActiveAccount
} from '../src/app/core/engine/storage.js'

const TOTAL = DEMO_SNAPSHOT.classes.length + DEMO_SNAPSHOT.keys.length
  + DEMO_SNAPSHOT.quizzes.length + DEMO_SNAPSHOT.sheets.length

describe('bundled demo world', () => {
  let accountA

  beforeEach(async () => {
    await clearAllData()
    accountA = await createAccount({ name: 'Demo tester', color: '#6366f1' })
    setActiveAccount(accountA.id)
  })

  it('mirrors the snapshot and remaps every reference to demo ids', () => {
    const world = buildDemoWorld('account-a')
    expect(world.classes).toHaveLength(DEMO_SNAPSHOT.classes.length)
    expect(world.keys).toHaveLength(DEMO_SNAPSHOT.keys.length)
    expect(world.quizzes).toHaveLength(DEMO_SNAPSHOT.quizzes.length)
    expect(world.sheets).toHaveLength(DEMO_SNAPSHOT.sheets.length)

    const classIds = new Set(world.classes.map(c => c.id))
    const quizIds = new Set(world.quizzes.map(q => q.id))
    for (const sheet of world.sheets) {
      expect(classIds.has(sheet.classId)).toBe(true)
      expect(quizIds.has(sheet.quizId)).toBe(true)
      expect(sheet.demo).toBe(true)
    }
    for (const rec of [...world.classes, ...world.keys, ...world.quizzes]) {
      expect(rec.demo).toBe(true)
      expect(rec.id.startsWith('demo-accounta-')).toBe(true)
    }
    for (const rec of world.classes) expect(rec.demoKey).toBeTruthy()
    for (const rec of world.quizzes) expect(rec.demoKey).toBeTruthy()
    expect(world.classes.find(c => c.name === 'English 8-B')?.demoKey).toBe('demo-cls-eng')
    expect(world.quizzes.find(q => q.title === 'Verb Tenses')?.demoKey).toBe('demo-quiz-2')
    const sheetMatch = resolveDemoSheet({ demo: DEMO_SHEET }, world.classes, world.quizzes)
    expect(sheetMatch?.student.name).toBe('Ivan Ramos')
    expect(sheetMatch?.quiz.title).toBe('Verb Tenses')

    // Seeding must never be able to overwrite a real record on the same phone.
    // (Reusing an old demo id is fine — those rows are demo-tagged too.)
    const sourceRealIds = new Set(
      [...DEMO_SNAPSHOT.classes, ...DEMO_SNAPSHOT.keys, ...DEMO_SNAPSHOT.quizzes, ...DEMO_SNAPSHOT.sheets]
        .filter(r => !r.demo).map(r => r.id)
    )
    for (const rec of [...world.classes, ...world.keys, ...world.quizzes, ...world.sheets]) {
      expect(sourceRealIds.has(rec.id)).toBe(false)
    }
  })

  it('seeds, re-seeds without duplicates, and removes only demo records', async () => {
    const realClass = await saveClass({ name: 'My real class', students: [{ name: 'Real Student' }] })
    const realKey = await saveKey({ subject: 'Real', items: [] })
    const realQuiz = await saveQuiz({ subject: 'Real', items: [] })
    await saveSheet({ classId: realClass.id, quizId: realQuiz.id, studentName: 'Real Student', answers: [], total: 0 })

    await seedDemoData()
    await seedDemoData()

    expect(await listClasses()).toHaveLength(DEMO_SNAPSHOT.classes.length + 1)
    expect(await listKeys()).toHaveLength(DEMO_SNAPSHOT.keys.length + 1)
    expect(await listQuizzes()).toHaveLength(DEMO_SNAPSHOT.quizzes.length + 1)
    expect(await listSheets()).toHaveLength(DEMO_SNAPSHOT.sheets.length + 1)

    expect(await deleteDemoData()).toBe(TOTAL)
    expect((await listClasses()).map(c => c.name)).toEqual(['My real class'])
    expect((await listKeys()).map(k => k.subject)).toEqual(['Real'])
    expect((await listQuizzes()).map(q => q.subject)).toEqual(['Real'])
    expect((await listSheets()).map(s => s.studentName)).toEqual(['Real Student'])
  })

  it('summary matches the bundled counts', () => {
    expect(demoSummary()).toBe(
      `${DEMO_SNAPSHOT.classes.length} classes · ${DEMO_SNAPSHOT.keys.length} keys · `
      + `${DEMO_SNAPSHOT.quizzes.length} quizzes · ${DEMO_SNAPSHOT.sheets.length} graded sheets`
    )
  })

  it('keeps each profile’s demo rows separate', async () => {
    await seedDemoData()
    const accountB = await createAccount({ name: 'Second profile', color: '#22c55e' })
    setActiveAccount(accountB.id)
    await seedDemoData()

    const counts = async (id) => {
      setActiveAccount(id)
      return {
        classes: (await listClasses()).length,
        keys: (await listKeys()).length,
        quizzes: (await listQuizzes()).length,
        sheets: (await listSheets()).length,
        quizIds: (await listQuizzes()).map(q => q.id),
      }
    }
    const a = await counts(accountA.id)
    const b = await counts(accountB.id)
    for (const side of [a, b]) {
      expect(side.classes).toBe(DEMO_SNAPSHOT.classes.length)
      expect(side.keys).toBe(DEMO_SNAPSHOT.keys.length)
      expect(side.quizzes).toBe(DEMO_SNAPSHOT.quizzes.length)
      expect(side.sheets).toBe(DEMO_SNAPSHOT.sheets.length)
    }
    expect(a.quizIds.some(id => b.quizIds.includes(id))).toBe(false)

    // removing demo in B leaves A's copy untouched
    setActiveAccount(accountB.id)
    expect(await deleteDemoData()).toBe(TOTAL)
    setActiveAccount(accountA.id)
    expect((await listQuizzes())).toHaveLength(DEMO_SNAPSHOT.quizzes.length)
  })

  it('counts teacher records as profile data', async () => {
    expect(await accountHasData(accountA.id)).toBe(false)
    await saveKey({ subject: 'Science', items: [] })
    expect(await accountHasData(accountA.id)).toBe(true)
  })

  it('removes a profile’s teacher records with the profile', async () => {
    await saveClass({ name: 'Class' })
    await saveKey({ subject: 'Key', items: [] })
    await saveQuiz({ subject: 'Quiz', items: [] })
    await saveSheet({ studentName: 'Student', answers: [], total: 0 })
    await deleteAccount(accountA.id)
    expect(await listClasses()).toHaveLength(0)
    expect(await listKeys()).toHaveLength(0)
    expect(await listQuizzes()).toHaveLength(0)
    expect(await listSheets()).toHaveLength(0)
  })
})
