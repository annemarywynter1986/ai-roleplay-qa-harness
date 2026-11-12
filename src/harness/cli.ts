// Eval scorecard.
//
//   npm run eval                          mock model, offline, free
//   npm run eval:claude                   real Claude (costs money; see README)
//   node src/harness/cli.ts --runs 3      fewer runs per scenario
//   node src/harness/cli.ts --save-baseline
//
// Writes eval-results/latest.json. If eval-results/baseline.json exists, any
// scenario whose pass rate dropped is reported as a regression and the exit code is 1.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PROMPT_VERSION } from '../ai/prompt.ts';
import { loadScenarios, providerFromEnv, runScenario } from './runEval.ts';
import type { ScenarioReport } from './runEval.ts';

const args = process.argv.slice(2);
const runsArg = args.includes('--runs') ? Number(args[args.indexOf('--runs') + 1]) : undefined;
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
const outDir = new URL('../../eval-results/', import.meta.url);

const scenarios = loadScenarios().filter((s) => !only || s.id.startsWith(only));
const factory = providerFromEnv();
const reports: ScenarioReport[] = [];
for (const sc of scenarios) {
  const r = await runScenario(sc, factory, runsArg ?? sc.runs);
  reports.push(r);
  const mark = r.ok ? 'PASS' : 'FAIL';
  console.log(
    `${mark}  ${r.id.padEnd(8)} ${r.priority}  ${String(r.passed).padStart(2)}/${r.runs} (need ${r.minPass})  first-draft ${Math.round(r.firstDraftRate * 100)}%  ${r.title}`,
  );
  for (const g of r.grades.filter((g) => !g.pass)) console.log(`        ✗ ${g.reasons.join('; ')}\n          "${g.output}"`);
}

const summary = {
  promptVersion: PROMPT_VERSION,
  provider: reports[0]?.provider ?? 'none',
  at: new Date().toISOString(),
  passed: reports.filter((r) => r.ok).length,
  total: reports.length,
  reports,
};
mkdirSync(outDir, { recursive: true });
writeFileSync(new URL('latest.json', outDir), JSON.stringify(summary, null, 2));
console.log(`\n${summary.passed}/${summary.total} scenarios passed · ${summary.provider} · prompt ${PROMPT_VERSION}`);

let failed = summary.passed < summary.total;
const baselinePath = new URL('baseline.json', outDir);
if (args.includes('--save-baseline')) {
  writeFileSync(baselinePath, JSON.stringify(summary, null, 2));
  console.log('Saved as baseline.');
} else if (existsSync(baselinePath)) {
  const base = JSON.parse(readFileSync(baselinePath, 'utf8')) as typeof summary;
  const regressions = reports.filter((r) => {
    const b = base.reports.find((x) => x.id === r.id);
    return b && r.passed / r.runs < b.passed / b.runs;
  });
  if (regressions.length) {
    failed = true;
    console.log(`\nRegressions vs baseline (prompt ${base.promptVersion}):`);
    for (const r of regressions) {
      const b = base.reports.find((x) => x.id === r.id)!;
      console.log(`  ${r.id}: ${b.passed}/${b.runs} → ${r.passed}/${r.runs}`);
    }
  } else {
    console.log(`No regressions vs baseline (prompt ${base.promptVersion}).`);
  }
}
process.exit(failed ? 1 : 0);
