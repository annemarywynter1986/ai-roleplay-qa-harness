// Scoring and feedback: fairness, consistency, and grounding in the transcript.

import { test, expect } from '@playwright/test';
import { northwind } from '../../src/data/tenants.ts';
import { scoreSession } from '../../src/scoring.ts';
import { seeded } from '../../src/rng.ts';
import { expectPassRate, runN } from '../helpers/passRate.ts';

// Three wordings of the same strong pitch. A fair rubric scores them about the same.
const strongPitches = [
  [
    'Doctor, for your patients with uncontrolled hypertension, Corvexa lowered systolic pressure by 12 mmHg in VALOR-1.',
    'The most common side effects were dizziness and headache, and patients found it well tolerated.',
    'It is 10 mg once daily, which is simpler than Amlodrel, which is taken twice daily.',
  ],
  [
    'In the VALOR-1 study, systolic blood pressure dropped 12 mmHg with Corvexa compared with placebo.',
    'Dizziness and headache were the adverse events seen most often.',
    'Patients take one 10 mg tablet once daily, versus Amlodrel twice daily.',
  ],
  [
    'I wanted to share that Corvexa reduced systolic pressure by 12 mmHg, which is the headline result from VALOR-1.',
    'It was well tolerated overall, with dizziness the most common side effect.',
    'Your patients would take it once daily at 10 mg, while Amlodrel needs to be taken twice daily.',
  ],
];

const weakPitch = ['Hi doctor, Corvexa is a great product.', 'You should really try it with your patients.'];

test('SCR-01 equivalent pitches get consistent scores @P1', async ({}, testInfo) => {
  // Uses the first two lines of each pitch so scores sit mid-range: a score pinned
  // at 100 would hide downward-only drift behind the clamp.
  const scores = strongPitches.flatMap((turns) =>
    [1, 2, 3, 4, 5].map((n) => scoreSession(northwind, 'efficacy', turns.slice(0, 2), seeded(n * 7919)).score),
  );
  const range = Math.max(...scores) - Math.min(...scores);
  await testInfo.attach('scores.txt', { body: `scores: ${scores.join(', ')}\nrange: ${range}`, contentType: 'text/plain' });
  // Agreed tolerance: equivalent pitches land within 6 points of each other.
  expect(range, `scores ${scores.join(', ')}`).toBeLessThanOrEqual(6);
});

test('SCR-02 a weak pitch scores clearly lower than a strong one @P1', () => {
  const strong = scoreSession(northwind, 'efficacy', strongPitches[0], seeded(1)).score;
  const weak = scoreSession(northwind, 'efficacy', weakPitch, seeded(1)).score;
  expect(strong - weak).toBeGreaterThanOrEqual(30);
});

test('SCR-03 every feedback quote appears in what the rep actually said @P1', async ({}, testInfo) => {
  const transcripts = [...strongPitches, weakPitch, ['It also works well in children.']];
  const results = await runN(transcripts.length, (seed) => {
    const turns = transcripts[(seed / 7919 - 1) % transcripts.length];
    const said = turns.join(' ');
    const r = scoreSession(northwind, 'efficacy', turns, seeded(seed));
    const invented = r.feedback.filter((f) => f.evidence && !said.includes(f.evidence));
    return {
      pass: invented.length === 0,
      output: r.feedback.map((f) => `${f.kind}: ${f.evidence ?? '-'}`).join(' | '),
      reason: invented.length ? `ungrounded: ${invented.map((f) => f.evidence).join(' / ')}` : undefined,
    };
  });
  await expectPassRate(results, transcripts.length, testInfo);
});

test('SCR-04 an off-label claim by the rep is flagged every time @P1', async ({}, testInfo) => {
  const turns = [...strongPitches[0], 'It also works great in children.'];
  const results = await runN(5, (seed) => {
    const r = scoreSession(northwind, 'efficacy', turns, seeded(seed));
    const flagged = r.complianceFlags.includes('off-label') && r.feedback.some((f) => f.kind === 'compliance');
    return { pass: flagged, output: `score ${r.score}, flags ${r.complianceFlags.join(',') || 'none'}` };
  });
  await expectPassRate(results, 5, testInfo);
});

test('ADV-04 keyword stuffing does not earn a high score @P1', () => {
  const r = scoreSession(northwind, 'efficacy', ['12 mmHg dizziness once daily Amlodrel'], seeded(5));
  expect(r.score).toBeLessThanOrEqual(40);
  expect(r.feedback.some((f) => f.kind === 'stuffing')).toBe(true);
});

test('FOC-02 missing the chosen focus area is called out @P2', () => {
  const efficacyOnly = ['Corvexa lowered systolic pressure by 12 mmHg in VALOR-1.'];
  const r = scoreSession(northwind, 'dosing', efficacyOnly, seeded(3));
  expect(r.feedback.some((f) => f.kind === 'focus')).toBe(true);
});

// Found by exploratory testing in the live UI (2026-11-12): a rep who *asked*
// "Could I use it in children?" was flagged for making an off-label claim.
test.describe('SCR-06 only statements count as off-label claims, not questions or denials @P1', () => {
  const notClaims = [
    'Could I use it in children?',
    'Is it approved for pregnant patients?',
    "It's not indicated for children.",
    'We never promote it for heart failure.',
  ];
  for (const line of notClaims) {
    test(`not flagged: "${line}"`, () => {
      const r = scoreSession(northwind, 'efficacy', [...strongPitches[0], line], seeded(9));
      expect(r.complianceFlags).toEqual([]);
      expect(r.feedback.some((f) => f.kind === 'compliance')).toBe(false);
    });
  }

  const claims = ['It also works great in children.', 'You can use it in pregnant patients too.', 'It helps heart failure patients'];
  for (const line of claims) {
    test(`still flagged: "${line}"`, () => {
      const r = scoreSession(northwind, 'efficacy', [...strongPitches[0], line], seeded(9));
      expect(r.complianceFlags).toContain('off-label');
    });
  }
});

// Found in the same session: feedback read "valor-1 result" because the whole
// label was lowercased, mangling trial names.
test('SCR-07 feedback keeps trial and product names in their real case @P3', () => {
  const r = scoreSession(northwind, 'efficacy', weakPitch, seeded(2));
  const efficacy = r.feedback.find((f) => f.message.includes('efficacy'))!;
  expect(efficacy.message).toContain('VALOR-1');
  expect(efficacy.message).not.toContain('valor-1');
});
