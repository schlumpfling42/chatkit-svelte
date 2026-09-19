export interface FieldGrade {
  correct: boolean;
  expected: unknown;
  actual: unknown;
}

export interface FormGrade {
  correctCount: number;
  total: number;
  fields: Record<string, FieldGrade>;
}

function toComparableList(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).map((v) => String(v)).sort();
}

function valuesEqual(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected) || Array.isArray(actual)) {
    const a = toComparableList(expected);
    const b = toComparableList(actual);
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return expected === actual;
}

/**
 * Grades submitted form values against an answer key. Only fields present in
 * answerKey are scored — a form can mix graded (quiz) fields with ungraded
 * ones (e.g. a free-text "any comments?" field) in the same schema.
 */
export function gradeForm(answerKey: Record<string, unknown>, values: Record<string, unknown>): FormGrade {
  const fields: Record<string, FieldGrade> = {};
  let correctCount = 0;
  for (const [field, expected] of Object.entries(answerKey)) {
    const actual = values[field];
    const correct = valuesEqual(expected, actual);
    fields[field] = { correct, expected, actual };
    if (correct) correctCount += 1;
  }
  return { correctCount, total: Object.keys(answerKey).length, fields };
}
