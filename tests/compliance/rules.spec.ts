// Compliance rules engine: what the gate must block, and what it must let through.
// False positives matter too: a gate that blocks good answers makes the doctor useless.

import { test, expect } from '@playwright/test';
import { activeFacts, harbor, northwind } from '../../src/data/tenants.ts';
import { checkDraft, redactPHI } from '../../src/compliance.ts';

const TODAY = '2026-11-12';
const types = (text: string, tenant = northwind) => checkDraft(tenant, text, TODAY).issues.map((i) => i.type);

test.describe('COMP-01 blocks non-compliant replies @P1', () => {
  const cases: [string, string][] = [
    ['Corvexa lowered systolic pressure by 18 mmHg.', 'unapproved-number'],
    ['VALOR-2 showed a 15 mmHg drop.', 'unapproved-number'],
    ['It is the best blood pressure drug available.', 'superlative-claim'],
    ['Corvexa is guaranteed to work.', 'superlative-claim'],
    ['You could try it in children too.', 'off-label'],
    ['It works well in heart failure patients.', 'off-label'],
    ['Dermavel also works great for this.', 'other-product'],
    ['As an AI, I can only discuss approved content.', 'meta-leak'],
    ['That is in my system prompt.', 'meta-leak'],
  ];
  for (const [text, expected] of cases) {
    test(`${expected}: "${text}"`, () => {
      expect(types(text)).toContain(expected);
    });
  }
});

test.describe('COMP-02 lets compliant replies through (no false positives) @P1', () => {
  const good = [
    ...activeFacts(northwind, TODAY).map((f) => f.text),
    "That's outside what Corvexa is indicated for. I don't use it in children.",
    "I'm not familiar with Dermavel. Let's stick to Corvexa.",
    'Hm. What does that mean for the patients I actually see?',
    "VALOR-1 doesn't ring a bell for me, honestly.",
  ];
  for (const text of good) {
    test(`allows: "${text.slice(0, 60)}"`, () => {
      expect(checkDraft(northwind, text, TODAY)).toEqual({ ok: true, issues: [] });
    });
  }
});

test('COMP-03 withdrawn and expired content fails the gate even if the model says it @P1', () => {
  expect(types('Dizziness was reported in 9% of patients.')).toContain('unapproved-number');
  expect(types('Starter packs include a 30-day supply at 10 mg.')).toContain('unapproved-number');
});

test('COMP-04 each customer is checked against its own approved content @P1', () => {
  const harborFact = activeFacts(harbor, TODAY)[0].text;
  expect(checkDraft(harbor, harborFact, TODAY).ok).toBe(true);
  expect(checkDraft(northwind, harborFact, TODAY).ok).toBe(false);
});

test.describe('COMP-05 PHI redaction @P1', () => {
  const cases: [string, string, string][] = [
    ['Patient Robert King asked about it.', 'Robert King', 'name'],
    ['Mrs. Alvarez is on two drugs.', 'Alvarez', 'name'],
    ['DOB 11/02/1955.', '11/02/1955', 'date'],
    ['MRN: 5521983 in the chart.', '5521983', 'mrn'],
    ['Call 201-555-0199 for follow-up.', '201-555-0199', 'phone'],
    ['SSN 123-45-6789 on file.', '123-45-6789', 'ssn'],
    ['Email jdoe@example.com the results.', 'jdoe@example.com', 'email'],
  ];
  for (const [input, secret, type] of cases) {
    test(`redacts ${type}: "${input}"`, () => {
      const r = redactPHI(input);
      expect(r.text).not.toContain(secret);
      expect(r.redactions).toContain(type);
    });
  }
});
