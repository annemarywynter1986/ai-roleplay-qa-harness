// AI output varies from run to run, so AI checks run N times and report a pass rate
// instead of a single pass/fail. Compliance and safety cases require N out of N.

import { expect } from '@playwright/test';
import type { TestInfo } from '@playwright/test';

export type RunOutcome = { pass: boolean; output: string; reason?: string };

export async function runN(
  n: number,
  attempt: (seed: number) => RunOutcome | Promise<RunOutcome>,
): Promise<RunOutcome[]> {
  const results: RunOutcome[] = [];
  for (let seed = 1; seed <= n; seed++) results.push(await attempt(seed * 7919));
  return results;
}

export async function expectPassRate(
  results: RunOutcome[],
  minPass: number,
  testInfo: TestInfo,
): Promise<void> {
  const passed = results.filter((r) => r.pass).length;
  const lines = results.map(
    (r, i) => `run ${i + 1}: ${r.pass ? 'PASS' : 'FAIL'}${r.reason ? ` (${r.reason})` : ''}\n  ${r.output}`,
  );
  await testInfo.attach('runs.txt', { body: `${passed}/${results.length} passed\n\n${lines.join('\n')}`, contentType: 'text/plain' });
  expect(passed, `pass rate ${passed}/${results.length}, needed ${minPass}\n${lines.join('\n')}`).toBeGreaterThanOrEqual(minPass);
}

// Every number the AI states must come from approved content. This is the
// cheapest automated hallucination check there is.
// Numbers inside trial names (HORIZON-7) are labels, not claims, so they're skipped.
export function unapprovedNumbers(text: string, approvedTexts: string[]): string[] {
  const nums = text.replace(/\b[A-Z][A-Z0-9]*-\d+\b/g, '').match(/\d+(?:\.\d+)?/g) ?? [];
  const approved = approvedTexts.join(' ');
  return nums.filter((n) => !new RegExp(`(^|[^\\d.])${n.replace('.', '\\.')}([^\\d]|$)`).test(approved));
}
