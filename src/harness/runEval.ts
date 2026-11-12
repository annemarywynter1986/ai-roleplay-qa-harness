// Eval harness: runs golden scenarios through the full agent loop (prompt ->
// context -> model -> tools -> compliance gate) N times and grades each run.
// Used by the Playwright suite and by the `npm run eval` scorecard.

import { readdirSync, readFileSync } from 'node:fs';
import { activeFacts, tenants } from '../data/tenants.ts';
import type { Persona, Tenant, Topic } from '../data/tenants.ts';
import { numbersNotIn } from '../compliance.ts';
import { runAgentTurn } from '../ai/agent.ts';
import type { AgentResult } from '../ai/agent.ts';
import type { Turn } from '../ai/context.ts';
import { MockProvider } from '../ai/mockProvider.ts';
import { ClaudeProvider } from '../ai/claudeProvider.ts';
import type { ModelProvider } from '../ai/types.ts';

export type Scenario = {
  id: string;
  title: string;
  priority: 'P1' | 'P2' | 'P3';
  tenant: string;
  persona: string;
  focus?: Topic;
  history?: Turn[];
  say: string;
  expect: {
    approvedNumbersOnly?: boolean;
    mustMatchAny?: string[];
    mustNotMatch?: string[];
    firstDraftCompliant?: boolean;
  };
  runs: number;
  minPass: number;
};

export type RunGrade = { pass: boolean; reasons: string[]; output: string; result: AgentResult };

export type ScenarioReport = {
  id: string;
  title: string;
  priority: string;
  provider: string;
  runs: number;
  passed: number;
  minPass: number;
  ok: boolean;
  firstDraftRate: number;
  grades: { pass: boolean; reasons: string[]; output: string; outcome: string; steps: number }[];
};

export function loadScenarios(dir = new URL('../../evals/golden/', import.meta.url)): Scenario[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as Scenario[]);
}

export type ProviderFactory = (opts: { tenant: Tenant; persona: Persona; focus?: Topic; seed: number }) => ModelProvider;

export function providerFromEnv(): ProviderFactory {
  if (process.env.MODEL_PROVIDER === 'claude') {
    const claude = new ClaudeProvider();
    return () => claude;
  }
  return (opts) => new MockProvider(opts);
}

export function grade(sc: Scenario, tenant: Tenant, result: AgentResult): RunGrade {
  const reasons: string[] = [];
  const text = result.text;
  if (sc.expect.approvedNumbersOnly) {
    const bad = numbersNotIn(text, activeFacts(tenant).map((f) => f.text));
    if (bad.length) reasons.push(`unapproved numbers: ${bad.join(', ')}`);
  }
  if (sc.expect.mustMatchAny && !sc.expect.mustMatchAny.some((p) => new RegExp(p, 'i').test(text))) {
    reasons.push(`missing any of: ${sc.expect.mustMatchAny.join(' | ')}`);
  }
  for (const p of sc.expect.mustNotMatch ?? []) {
    if (new RegExp(p, 'i').test(text)) reasons.push(`matched forbidden pattern: ${p}`);
  }
  // The final answer can be safe only because the gate rewrote it. Track the
  // model's first draft separately so a weaker model or prompt doesn't hide.
  if (sc.expect.firstDraftCompliant && result.firstDraftCompliant === false) {
    reasons.push('first draft failed the compliance gate');
  }
  if (result.outcome.startsWith('fallback-') && result.outcome !== 'fallback-gate') {
    reasons.push(`loop ended in ${result.outcome}`);
  }
  return { pass: reasons.length === 0, reasons, output: text, result };
}

export async function runScenario(sc: Scenario, factory: ProviderFactory = providerFromEnv(), runs = sc.runs): Promise<ScenarioReport> {
  const tenant = tenants[sc.tenant];
  const persona = tenant?.personas.find((p) => p.id === sc.persona);
  if (!tenant || !persona) throw new Error(`${sc.id}: unknown tenant or persona`);

  const grades: RunGrade[] = [];
  let providerName = '';
  for (let i = 1; i <= runs; i++) {
    const provider = factory({ tenant, persona, focus: sc.focus, seed: i * 7919 });
    providerName = provider.name;
    const result = await runAgentTurn({ provider, tenant, persona, focus: sc.focus, history: sc.history ?? [], repText: sc.say });
    grades.push(grade(sc, tenant, result));
  }
  const passed = grades.filter((g) => g.pass).length;
  const minPass = Math.min(sc.minPass, runs);
  return {
    id: sc.id,
    title: sc.title,
    priority: sc.priority,
    provider: providerName,
    runs,
    passed,
    minPass,
    ok: passed >= minPass,
    firstDraftRate: grades.filter((g) => g.result.firstDraftCompliant !== false).length / runs,
    grades: grades.map((g) => ({
      pass: g.pass,
      reasons: g.reasons,
      output: g.output,
      outcome: g.result.outcome,
      steps: g.result.steps.filter((s) => s.kind === 'model').length,
    })),
  };
}
