// Persona behavior across a full conversation, where one line isn't enough to judge.

import { test, expect } from '@playwright/test';
import { northwind } from '../../src/data/tenants.ts';
import { respond } from '../../src/persona.ts';
import { seeded } from '../../src/rng.ts';
import { expectPassRate, runN, unapprovedNumbers } from '../helpers/passRate.ts';

const skeptic = northwind.personas.find((p) => p.disposition === 'skeptical')!;
const loyal = northwind.personas.find((p) => p.disposition === 'loyal')!;
const approved = northwind.approvedFacts.map((f) => f.text);

const conversation = [
  'Good morning, doctor. Thanks for seeing me.',
  'What do you think about the efficacy results?',
  'Are you worried about side effects?',
  'How would you dose it?',
  'How does it compare to Amlodrel?',
];

test('PER-01 stays in role and on approved content for a whole conversation @P1', async ({}, testInfo) => {
  const results = await runN(5, (seed) => {
    const replies = conversation.map((line, i) => respond(northwind, skeptic, line, seeded(seed + i)).text);
    const all = replies.join(' | ');
    const problems: string[] = [];
    if (/as an ai|language model|assistant/i.test(all)) problems.push('broke character');
    const bad = unapprovedNumbers(all, approved);
    if (bad.length) problems.push(`unapproved numbers: ${bad.join(', ')}`);
    return { pass: problems.length === 0, output: all, reason: problems.join('; ') || undefined };
  });
  await expectPassRate(results, 5, testInfo);
});

test('PER-02 skeptical and loyal personas respond differently to the same pitch @P2', async ({}, testInfo) => {
  const line = 'What do you think about the efficacy results?';
  const results = await runN(5, (seed) => {
    const s = respond(northwind, skeptic, line, seeded(seed)).text;
    const l = respond(northwind, loyal, line, seeded(seed)).text;
    // The skeptic pushes back with a question; the loyal prescriber accepts the data.
    const pass = s.trim().endsWith('?') && !l.includes('?');
    return { pass, output: `skeptic: ${s}\n  loyal: ${l}`, reason: pass ? undefined : 'dispositions not distinguishable' };
  });
  await expectPassRate(results, 4, testInfo);
});

test('PER-02b the same persona keeps its disposition across runs @P3', () => {
  const replies = [1, 2, 3, 4, 5].map((s) => respond(northwind, skeptic, 'Tell me about the data.', seeded(s)).text);
  expect(replies.every((r) => r.endsWith('?'))).toBe(true);
});
