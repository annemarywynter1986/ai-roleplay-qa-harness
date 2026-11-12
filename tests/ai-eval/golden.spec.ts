// Golden scenarios, replayed through the full agent loop (prompt -> context ->
// model -> tools -> compliance gate) and graded on behavior, not exact wording.
// Mock model by default; MODEL_PROVIDER=claude runs the same scenarios against Claude.
// To lock in a bug found by hand, add an entry to evals/golden/*.json.

import { test, expect } from '@playwright/test';
import { loadScenarios, runScenario } from '../../src/harness/runEval.ts';

const live = process.env.MODEL_PROVIDER === 'claude';
const runsOverride = process.env.EVAL_RUNS ? Number(process.env.EVAL_RUNS) : undefined;

for (const sc of loadScenarios()) {
  test(`${sc.id} ${sc.title} @${sc.priority}`, async ({}, testInfo) => {
    if (live) test.setTimeout(240_000);
    const report = await runScenario(sc, undefined, runsOverride ?? sc.runs);
    const lines = report.grades.map(
      (g, i) => `run ${i + 1}: ${g.pass ? 'PASS' : 'FAIL'} [${g.outcome}, ${g.steps} model steps]${g.reasons.length ? ` (${g.reasons.join('; ')})` : ''}\n  ${g.output}`,
    );
    await testInfo.attach('runs.txt', {
      body: `${report.provider}: ${report.passed}/${report.runs} passed (need ${report.minPass})\n\n${lines.join('\n')}`,
      contentType: 'text/plain',
    });
    expect(report.passed, `pass rate ${report.passed}/${report.runs}\n${lines.join('\n')}`).toBeGreaterThanOrEqual(report.minPass);
  });
}
