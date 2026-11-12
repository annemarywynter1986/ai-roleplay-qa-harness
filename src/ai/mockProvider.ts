// Offline stand-in for the model. It speaks the same protocol as Claude
// (tool_use / tool_result / end_turn) and is stateless: every decision is derived
// from the messages it's given, exactly like a real API call.
//
// Normal flow:  lookup_approved_facts -> check_compliance(draft) -> end_turn(draft)
// Guarded input (injection, off-label, unknown trial...): answers in role right away.
//
// Behaviors simulate model failures so the loop's safety nets can be tested:
//   unsafe-draft  drafts an unsupported superlative claim and skips its own check
//   runaway       keeps calling tools and never finishes
//   bad-tool      calls a tool that doesn't exist on its first step
//   refusal       returns stop_reason "refusal"

import type { Persona, Tenant, Topic } from '../data/tenants.ts';
import { detectTopic, respond } from '../persona.ts';
import { seeded } from '../rng.ts';
import { unwrapRepUtterance } from './prompt.ts';
import type { ContentBlock, Message, ModelProvider, ModelTurn, ToolResultBlock, ToolUseBlock } from './types.ts';

export type MockBehavior = 'normal' | 'unsafe-draft' | 'runaway' | 'bad-tool' | 'refusal';

let ids = 0;
const toolUse = (name: string, input: Record<string, unknown>): ToolUseBlock => ({
  type: 'tool_use',
  id: `toolu_mock_${++ids}`,
  name,
  input,
});

export class MockProvider implements ModelProvider {
  readonly name = 'mock';
  private tenant: Tenant;
  private persona: Persona;
  private focus?: Topic;
  private seed: number;
  private behavior: MockBehavior;

  constructor(opts: { tenant: Tenant; persona: Persona; focus?: Topic; seed?: number; behavior?: MockBehavior }) {
    this.tenant = opts.tenant;
    this.persona = opts.persona;
    this.focus = opts.focus;
    this.seed = opts.seed ?? 1;
    this.behavior = opts.behavior ?? 'normal';
  }

  async complete(req: { messages: Message[] }): Promise<ModelTurn> {
    const { messages } = req;
    const last = messages[messages.length - 1];
    const lastBlocks: ContentBlock[] = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content;
    const repText = this.currentUtterance(messages);
    const end = (text: string): ModelTurn => ({ stopReason: 'end_turn', content: [{ type: 'text', text }] });
    const safe = `Let me stick to what's on the label. What else did you want to cover about ${this.tenant.drug.brand}?`;

    if (this.behavior === 'refusal') return { stopReason: 'refusal', content: [] };
    if (this.behavior === 'runaway') {
      return { stopReason: 'tool_use', content: [toolUse('lookup_approved_facts', { topic: 'efficacy' })] };
    }

    // The harness's compliance gate sent the reply back: fall back to safe, fact-free wording.
    if (lastBlocks.some((b) => b.type === 'text' && /<compliance_review>/.test(String(b.text)))) return end(safe);

    const toolResults = lastBlocks.filter((b): b is ToolResultBlock => b.type === 'tool_result');
    if (toolResults.length) {
      const prevAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
      const prevCall = Array.isArray(prevAssistant?.content)
        ? (prevAssistant!.content.find((b) => b.type === 'tool_use') as ToolUseBlock | undefined)
        : undefined;

      if (prevCall?.name === 'check_compliance') {
        const verdict = JSON.parse(String(toolResults[0].content)) as { ok: boolean };
        return end(verdict.ok ? String(prevCall.input.draft) : safe);
      }
      // After a lookup (or a failed call): draft a reply, then check it.
      const draft = this.draft(repText);
      if (this.behavior === 'unsafe-draft') return end(draft);
      return { stopReason: 'tool_use', content: [toolUse('check_compliance', { draft })] };
    }

    // A fresh rep utterance.
    if (this.behavior === 'bad-tool' && !messages.some((m) => m.role === 'assistant' && Array.isArray(m.content))) {
      return { stopReason: 'tool_use', content: [toolUse('delete_patient_records', { all: true })] };
    }
    const reply = respond(this.tenant, this.persona, repText, seeded(this.seed), this.focus);
    if (reply.guard) return end(reply.text); // guardrails answer in role without tools
    const topic = detectTopic(repText) ?? this.focus ?? 'efficacy';
    return { stopReason: 'tool_use', content: [toolUse('lookup_approved_facts', { topic })] };
  }

  private draft(repText: string): string {
    if (this.behavior === 'unsafe-draft') {
      return `Honestly, ${this.tenant.drug.brand} is the best option out there and it's guaranteed to work.`;
    }
    return respond(this.tenant, this.persona, repText, seeded(this.seed), this.focus).text;
  }

  private currentUtterance(messages: Message[]): string {
    for (const m of [...messages].reverse()) {
      if (m.role !== 'user') continue;
      const text = typeof m.content === 'string' ? m.content : m.content.map((b) => (b.type === 'text' ? String(b.text) : '')).join('\n');
      const u = unwrapRepUtterance(text);
      if (u !== null) return u.replace(/‹/g, '<').replace(/›/g, '>');
    }
    return '';
  }
}
