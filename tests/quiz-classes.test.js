import { describe, it, expect } from 'vitest'
import {
  quizTitle,
  resolveQuizClass,
  quizClassLabel,
  groupQuizzesByClass,
} from '../src/app/core/engine/quiz-classes.js'

const classes = [
  { id: 'c-eng', name: 'English 8-B', subject: 'English' },
  { id: 'c-sci', name: 'Science 7-A', subject: 'Science' },
]

const q = (id, extra = {}) => ({ id, subject: 'English', title: '', items: [], ...extra })

describe('quizTitle', () => {
  it('uses the real title when there is one', () => {
    expect(quizTitle(q('1', { title: 'Verb Tenses' }))).toBe('Verb Tenses')
  })

  it('never leaves an untitled quiz showing only its subject', () => {
    expect(quizTitle(q('1'))).toBe('English quiz')
    expect(quizTitle(q('1', { subject: 'Computer' }))).toBe('Computer quiz')
  })

  it('falls back for a quiz with neither title nor subject', () => {
    expect(quizTitle(q('1', { subject: '' }))).toBe('Untitled quiz')
  })
})

describe('resolveQuizClass / quizClassLabel', () => {
  it('resolves the live class so renames show', () => {
    const quiz = q('1', { classId: 'c-eng', className: 'Old name' })
    expect(resolveQuizClass(quiz, classes)?.name).toBe('English 8-B')
  })

  it('keeps working with the snapshotted name after the class is deleted', () => {
    const quiz = q('1', { classId: 'c-gone', className: 'Removed 9-C' })
    expect(resolveQuizClass(quiz, classes)).toMatchObject({ name: 'Removed 9-C', missing: true })
    expect(quizClassLabel(quiz, classes)).toBe('Removed 9-C')
  })

  it('labels an unassigned quiz', () => {
    expect(quizClassLabel(q('1'), classes)).toBe('No class yet')
  })
})

describe('groupQuizzesByClass', () => {
  it('groups in class order and puts unassigned quizzes last', () => {
    const groups = groupQuizzesByClass([
      q('u1'),
      q('s1', { classId: 'c-sci', className: 'Science 7-A' }),
      q('e1', { classId: 'c-eng', className: 'English 8-B' }),
      q('e2', { classId: 'c-eng', className: 'English 8-B' }),
    ], classes)
    expect(groups.map(g => g.name)).toEqual(['English 8-B', 'Science 7-A', 'No class yet'])
    expect(groups[0].quizzes.map(x => x.id)).toEqual(['e1', 'e2'])
    expect(groups[2].unassigned).toBe(true)
  })

  it('omits classes with no quizzes', () => {
    const groups = groupQuizzesByClass([q('e1', { classId: 'c-eng', className: 'English 8-B' })], classes)
    expect(groups.map(g => g.id)).toEqual(['c-eng'])
  })

  it('groups a deleted class by its stored name', () => {
    const groups = groupQuizzesByClass([
      q('x1', { classId: 'c-gone', className: 'Removed 9-C' }),
      q('x2', { classId: 'c-gone', className: 'Removed 9-C' }),
    ], classes)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ name: 'Removed 9-C', missing: true })
    expect(groups[0].quizzes).toHaveLength(2)
  })

  it('treats a missing class with no stored name as unassigned', () => {
    const groups = groupQuizzesByClass([q('x', { classId: 'c-gone' })], classes)
    expect(groups).toHaveLength(1)
    expect(groups[0].unassigned).toBe(true)
    expect(groups[0].quizzes[0].id).toBe('x')
  })
})
