// The agent loop for one rep utterance. The harness, not the model, owns:
//   - a hard step limit (no runaway loops)
//   - tool execution, scoped to one tenant
//   - a compliance gate on every final reply, whether or not the model checked itself
//   - one revision attempt, then a safe in-role fallback
//   - an append-only message history and a full audit record

import type { Persona, Tenant, Topic } from '../data/tenants.ts';
import { checkDraft } from '../compliance.ts';
import type { ComplianceResult, Redaction } from '../compliance.ts';
import { faultOn } from '../faults.ts';
import { buildContext } from './context.ts';
import type { Turn } from './context.ts';
import { PROMPT_VERSION } from './prompt.ts';
import { TOOL_SPECS, executeTool } from './tools.ts';
import { textOf, toolCallsOf } from './types.ts';
import type { ContentBlock, Message, ModelProvider, StopReason } from './types.ts';

export type Step =
  | { kind: 'model'; step: number; stopReason: StopReason; toolCalls: string[]; text: string }
  | { kind: 'tool'; step: number; name: string; input: Record<string, unknown>; isError: boolean; output: string }
  | { kind: 'gate'; step: number; draft: string; result: ComplianceResult };

export type Outcome = 'answered' | 'revised' | 'fallback-max-steps' | 'fallback-refusal' | 'fallback-gate' | 'fallback-error';

export type AgentResult = {
  text: string;
  outcome: Outcome;
  steps: Step[];
  firstDraftCompliant: boolean | null;
  audit: {
    promptVersion: string;
    provider: string;
    retrievedFactIds: string[];
    toolsCalled: string[];
    gateVerdicts: boolean[];
    redactions: Redaction[];
    droppedTurns: number;
    approxContextTokens: number;
    outcome: Outcome;
  };
  // Every request the loop sent, kept for the append-only check.
  requests: Message[][];
  redactedUtterance: string;
};

export const DEFAULT_MAX_STEPS = 6;

export async function runAgentTurn(input: {
  provider: ModelProvider;
  tenant: Tenant;
  persona: Persona;
  focus?: Topic;
  history: Turn[];
  repText: string;
  maxSteps?: number;
  today?: string;
}): Promise<AgentResult> {
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
  const ctx = buildContext(input);
  const messages: Message[] = [...ctx.messages];
  const steps: Step[] = [];
  const requests: Message[][] = [];
  let revisions = 0;
  let firstDraftCompliant: boolean | null = null;
  const fallback = `I need to get to my next patient. Let's pick this up next time you're in.`;

  const finish = (text: string, outcome: Outcome): AgentResult => ({
    text,
    outcome,
    steps,
    firstDraftCompliant,
    requests,
    redactedUtterance: ctx.redactedUtterance,
    audit: {
      promptVersion: PROMPT_VERSION,
      provider: input.provider.name,
      retrievedFactIds: ctx.retrievedFactIds,
      toolsCalled: steps.filter((s) => s.kind === 'tool').map((s) => (s as { name: string }).name),
      gateVerdicts: steps.filter((s) => s.kind === 'gate').map((s) => (s as { result: ComplianceResult }).result.ok),
      redactions: ctx.redactions,
      droppedTurns: ctx.droppedTurns,
      approxContextTokens: ctx.approxTokens,
      outcome,
    },
  });

  for (let step = 1; step <= maxSteps; step++) {
    requests.push(messages.map((m) => ({ ...m })));
    let turn;
    try {
      turn = await input.provider.complete({ system: ctx.system, messages, tools: TOOL_SPECS });
    } catch (err) {
      steps.push({ kind: 'model', step, stopReason: 'other', toolCalls: [], text: `error: ${String(err)}` });
      return finish(fallback, 'fallback-error');
    }
    const calls = toolCallsOf(turn.content);
    const text = textOf(turn.content);
    steps.push({ kind: 'model', step, stopReason: turn.stopReason, toolCalls: calls.map((c) => c.name), text });

    if (turn.stopReason === 'refusal') return finish(fallback, 'fallback-refusal');
    // Append the model's turn exactly as returned (including any thinking blocks).
    if (turn.content.length) messages.push({ role: 'assistant', content: turn.content });

    if (turn.stopReason === 'pause_turn') continue;

    if (calls.length) {
      const results: ContentBlock[] = calls.map((call) => {
        const out = executeTool(input.tenant, call.name, call.input, input.today);
        steps.push({ kind: 'tool', step, name: call.name, input: call.input, isError: out.isError, output: out.content });
        // The model's first self-check counts as its first draft, so a model that
        // drafts badly and then corrects itself still shows up in the metrics.
        if (call.name === 'check_compliance' && !out.isError && firstDraftCompliant === null) {
          firstDraftCompliant = (JSON.parse(out.content) as { ok: boolean }).ok;
        }
        return { type: 'tool_result', tool_use_id: call.id, content: out.content, ...(out.isError ? { is_error: true } : {}) };
      });
      messages.push({ role: 'user', content: results });
      continue;
    }

    if (turn.stopReason === 'max_tokens' || !text) return finish(fallback, 'fallback-error');

    // Final reply: the harness checks it no matter what the model did.
    const verdict = faultOn('no-gate') ? { ok: true, issues: [] } : checkDraft(input.tenant, text, input.today);
    steps.push({ kind: 'gate', step, draft: text, result: verdict });
    if (firstDraftCompliant === null) firstDraftCompliant = verdict.ok;
    if (verdict.ok) return finish(text, revisions ? 'revised' : 'answered');

    if (revisions >= 1) return finish(fallback, 'fallback-gate');
    revisions += 1;
    const issues = verdict.issues.map((i) => `- ${i.type}: ${i.detail}`).join('\n');
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: `<compliance_review>\nYour reply was blocked before the rep heard it:\n${issues}\nRewrite it in character using only approved facts.\n</compliance_review>` }],
    });
  }

  return finish(fallback, 'fallback-max-steps');
}
