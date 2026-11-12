// Golden scenarios: saved rep lines replayed as text against the AI doctor,
// judged against rubric-style expectations rather than exact wording.
// To add a regression case for a bug found by hand, add an entry to golden/*.json.

import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { tenants } from '../../src/data/tenants.ts';
import { respond } from '../../src/persona.ts';
import { seeded } from '../../src/rng.ts';
import { expectPassRate, runN, unapprovedNumbers } from '../helpers/passRate.ts';

type Scenario = {
  id: string;
  title: string;
  priority: 'P1' | 'P2' | 'P3';
  tenant: string;
  persona: string;
  say: string;
  expect: { guard?: string; approvedNumbersOnly?: boolean; mustMatchAny?: string[]; mustNotMatch?: string[] };
  runs: number;
  minPass: number;
};

const dir = new URL('./golden/', import.meta.url);
const scenarios: Scenario[] = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));

for (const sc of scenarios) {
  test(`${sc.id} ${sc.title} @${sc.priority}`, async ({}, testInfo) => {
    const tenant = tenants[sc.tenant];
    const persona = tenant.personas.find((p) => p.id === sc.persona);
    expect(persona, `persona ${sc.persona} exists for ${sc.tenant}`).toBeDefined();
    const approved = tenant.approvedFacts.map((f) => f.text);

    const results = await runN(sc.runs, (seed) => {
      const reply = respond(tenant, persona!, sc.say, seeded(seed));
      const problems: string[] = [];
      if (sc.expect.guard && reply.guard !== sc.expect.guard) problems.push(`guard was ${reply.guard}, expected ${sc.expect.guard}`);
      if (sc.expect.approvedNumbersOnly) {
        const bad = unapprovedNumbers(reply.text, approved);
        if (bad.length) problems.push(`unapproved numbers: ${bad.join(', ')}`);
      }
      if (sc.expect.mustMatchAny && !sc.expect.mustMatchAny.some((p) => new RegExp(p, 'i').test(reply.text))) {
        problems.push(`missing any of: ${sc.expect.mustMatchAny.join(' | ')}`);
      }
      for (const p of sc.expect.mustNotMatch ?? []) {
        if (new RegExp(p, 'i').test(reply.text)) problems.push(`matched forbidden pattern: ${p}`);
      }
      return { pass: problems.length === 0, output: reply.text, reason: problems.join('; ') || undefined };
    });

    await expectPassRate(results, sc.minPass, testInfo);
  });
}
