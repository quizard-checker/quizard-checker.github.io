import { describe, expect, it } from 'vitest';
import { classIdentity, findDuplicateClass } from '../src/app/core/engine/class-identity.js';

const english = {
  id: 'cls-1',
  subject: 'English',
  grade: '7',
  section: 'Rizal',
  schoolYear: '2026-2027',
  archived: false,
};

describe('class identity', () => {
  it('normalizes subject, grade, section, and school year', () => {
    expect(classIdentity({
      subject: '  ENGLISH ',
      grade: 'Grade 7',
      section: '  rizal ',
      schoolYear: ' 2026–2027 ',
    })).toBe(classIdentity(english));
  });

  it('treats the same class as a duplicate', () => {
    expect(findDuplicateClass({
      subject: 'english',
      grade: '7',
      section: 'RIZAL',
      schoolYear: '2026-2027',
    }, [english])).toMatchObject({ id: 'cls-1' });
  });

  it('allows a different subject, grade, section, or school year', () => {
    expect(findDuplicateClass({
      subject: 'Science', grade: '7', section: 'Rizal', schoolYear: '2026-2027',
    }, [english])).toBeNull();
    expect(findDuplicateClass({
      subject: 'English', grade: '8', section: 'Rizal', schoolYear: '2026-2027',
    }, [english])).toBeNull();
    expect(findDuplicateClass({
      subject: 'English', grade: '7', section: 'Bonifacio', schoolYear: '2026-2027',
    }, [english])).toBeNull();
    expect(findDuplicateClass({
      subject: 'English', grade: '7', section: 'Rizal', schoolYear: '2027-2028',
    }, [english])).toBeNull();
  });

  it('ignores the class being edited', () => {
    expect(findDuplicateClass(english, [english], 'cls-1')).toBeNull();
  });

  it('counts archived classes as existing', () => {
    expect(findDuplicateClass({
      subject: 'English', grade: '7', section: 'Rizal', schoolYear: '2026-2027',
    }, [{ ...english, archived: true }])).toMatchObject({ id: 'cls-1' });
  });

  it('does not match an incomplete class', () => {
    expect(findDuplicateClass({
      subject: '', grade: '7', section: 'Rizal', schoolYear: '2026-2027',
    }, [english])).toBeNull();
  });
});
