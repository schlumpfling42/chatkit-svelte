import { describe, expect, it } from 'vitest';
import { gradeForm } from '../src/grade';

describe('gradeForm', () => {
  it('marks a scalar field correct on an exact match and incorrect otherwise', () => {
    const grade = gradeForm({ moon: 'Titan' }, { moon: 'Titan' });
    expect(grade).toMatchObject({ correctCount: 1, total: 1, fields: { moon: { correct: true } } });

    const wrong = gradeForm({ moon: 'Titan' }, { moon: 'Io' });
    expect(wrong).toMatchObject({ correctCount: 0, total: 1, fields: { moon: { correct: false, expected: 'Titan', actual: 'Io' } } });
  });

  it('grades array (multi-select) fields by set equality, order-independent', () => {
    const grade = gradeForm({ moons: ['Titan', 'Rhea'] }, { moons: ['Rhea', 'Titan'] });
    expect(grade.fields.moons.correct).toBe(true);
  });

  it('marks an array field incorrect when the set of choices differs', () => {
    const grade = gradeForm({ moons: ['Titan', 'Rhea'] }, { moons: ['Titan', 'Io'] });
    expect(grade.fields.moons.correct).toBe(false);

    const missingOne = gradeForm({ moons: ['Titan', 'Rhea'] }, { moons: ['Titan'] });
    expect(missingOne.fields.moons.correct).toBe(false);
  });

  it('only scores fields present in the answer key, leaving ungraded fields out of the total', () => {
    const grade = gradeForm({ moon: 'Titan' }, { moon: 'Titan', comments: 'great quiz' });
    expect(grade.total).toBe(1);
    expect(grade.fields.comments).toBeUndefined();
  });

  it('treats a missing submitted value as incorrect rather than throwing', () => {
    const grade = gradeForm({ moon: 'Titan' }, {});
    expect(grade.fields.moon.correct).toBe(false);
  });

  it('returns a zero-total grade for an empty answer key', () => {
    const grade = gradeForm({}, { moon: 'Titan' });
    expect(grade).toEqual({ correctCount: 0, total: 0, fields: {} });
  });
});
